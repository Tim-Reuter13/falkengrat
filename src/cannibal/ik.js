import * as T from 'three';

// Two-bone IK in world space. It only rotates bones, so it works with any local bone
// axes (the studio's mocap rig keeps Mixamo names but SOMA-derived rest frames).
const qa = new T.Quaternion(), qb = new T.Quaternion(), qc = new T.Quaternion(), qKeep = new T.Quaternion();
const qIdentity = new T.Quaternion();
const va = new T.Vector3(), vb = new T.Vector3();
const tA = new T.Vector3(), tB = new T.Vector3(), tC = new T.Vector3(), tWant = new T.Vector3();
const tDir = new T.Vector3(), tBend = new T.Vector3(), tKnee = new T.Vector3(), tEnd = new T.Vector3();
const tFrom = new T.Vector3(), tTo = new T.Vector3();

// Rotate a bone in world space so that direction `from` turns into `to` (both world vectors).
export function turnBone(bone, from, to, weight = 1) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  qa.setFromUnitVectors(va.copy(from).normalize(), vb.copy(to).normalize());
  if (weight < 1) qa.slerp(qIdentity, 1 - weight);
  bone.getWorldQuaternion(qb);
  qb.premultiply(qa);
  bone.parent.getWorldQuaternion(qc).invert();
  bone.quaternion.copy(qc.multiply(qb));
  bone.updateMatrixWorld(true);
}

// Rotate a bone so its world orientation becomes `world`.
export function setWorldQuaternion(bone, world) {
  bone.parent.getWorldQuaternion(qc).invert();
  bone.quaternion.copy(qc.multiply(world));
  bone.updateMatrixWorld(true);
}

// upper -> lower -> end: thigh/shin/foot or arm/forearm/hand. The middle joint bends
// towards the world point `pole`. The end bone keeps its world orientation (or `endWorld`).
// Returns how far the target lies beyond the limb's reach (0 when reachable).
export function solveTwoBone(upper, lower, end, target, pole, weight = 1, endWorld = null) {
  if (weight <= 0.001) return 0;
  upper.getWorldPosition(tA); lower.getWorldPosition(tB); end.getWorldPosition(tC);
  qKeep.copy(endWorld ?? end.getWorldQuaternion(qKeep));
  const lab = tA.distanceTo(tB), lbc = tB.distanceTo(tC);
  tWant.copy(tC).lerp(target, weight);
  tDir.subVectors(tWant, tA);
  const raw = tDir.length();
  const overstretch = Math.max(0, raw - (lab + lbc));
  const distance = T.MathUtils.clamp(raw, Math.abs(lab - lbc) + 1e-3, (lab + lbc) * .999);
  tDir.multiplyScalar(1 / Math.max(raw, 1e-6));
  tBend.subVectors(pole, tA);
  tBend.addScaledVector(tDir, -tBend.dot(tDir));
  if (tBend.lengthSq() < 1e-8) {
    tBend.subVectors(tB, tA);
    tBend.addScaledVector(tDir, -tBend.dot(tDir));
  }
  tBend.normalize();
  const x = (lab * lab - lbc * lbc + distance * distance) / (2 * distance);
  const h = Math.sqrt(Math.max(0, lab * lab - x * x));
  tKnee.copy(tA).addScaledVector(tDir, x).addScaledVector(tBend, h);
  tEnd.copy(tA).addScaledVector(tDir, distance);
  turnBone(upper, tFrom.subVectors(tB, tA), tTo.subVectors(tKnee, tA));
  lower.getWorldPosition(tB); end.getWorldPosition(tC);
  turnBone(lower, tFrom.subVectors(tC, tB), tTo.subVectors(tEnd, tB));
  setWorldQuaternion(end, qKeep);
  return overstretch;
}

// Turn a chain (e.g. neck, head) so that a facing axis points at `target`. `facing(bone, out)`
// returns that bone's current world facing direction; each bone takes its share of the turn.
export function aimChain(bones, shares, facing, target, weight, maxAngle) {
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    facing(bone, tFrom);
    bone.getWorldPosition(tA);
    tTo.subVectors(target, tA).normalize();
    const angle = tFrom.angleTo(tTo);
    if (angle < 1e-4) continue;
    turnBone(bone, tFrom, tTo, weight * shares[i] * Math.min(1, maxAngle / angle));
  }
}
