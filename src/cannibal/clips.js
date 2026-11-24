import * as T from 'three';

// Keyframe clips from the Animation Studio (k2_*) are made on the studio's reference
// skeleton: same bone names and rest rotations as kannibale.glb (< 2 degrees apart), but
// shorter arms and slightly different bone offsets. Only rotations transfer one to one.
// Hips translation is mapped onto our hips rest; all other translation and scale tracks
// are dropped so the clips never stretch the limbs of our mesh.
const HIPS = 'mixamorigHips';

export function adaptClips(model, sources) {
  const ourHips = model.scene.getObjectByName(HIPS);
  if (!ourHips) return [];
  const ourRest = ourHips.position.clone();
  const clips = [];
  for (const gltf of sources) {
    const theirHips = gltf.scene.getObjectByName(HIPS);
    const theirRest = theirHips ? theirHips.position.clone() : ourRest.clone();
    const ratio = theirRest.y > .1 ? ourRest.y / theirRest.y : 1;
    for (const source of gltf.animations) {
      const tracks = [];
      for (const track of source.tracks) {
        const [node, property] = track.name.split('.');
        if (property === 'quaternion') { tracks.push(track.clone()); continue; }
        if (property !== 'position' || node !== HIPS) continue;
        const values = track.values.slice();
        for (let i = 0; i < values.length; i += 3) {
          values[i] = ourRest.x + (values[i] - theirRest.x) * ratio;
          values[i + 1] = ourRest.y + (values[i + 1] - theirRest.y) * ratio;
          values[i + 2] = ourRest.z + (values[i + 2] - theirRest.z) * ratio;
        }
        tracks.push(new T.VectorKeyframeTrack(track.name, track.times.slice(), values));
      }
      clips.push(new T.AnimationClip(source.name, source.duration, tracks));
    }
  }
  return clips;
}

// Which of the model's clips the game uses: the keyframe clips replace the old mocap ones
// with the same role (k2_stalk replaces k_stalk ...), the rest stay.
export const clipKey = name => name.replace(/^k2_/, '').replace(/^k_/, '').replace(/^f_death_fall$/, 'death');
