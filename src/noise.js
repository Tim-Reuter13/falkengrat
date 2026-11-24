export const TAU = Math.PI * 2;
export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const mix = (a, b, fraction) => a + (b - a) * fraction;
export const smooth = (a, b, value) => {
  const x = clamp((value - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

export function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  const u = smooth(0, 1, x - i), v = smooth(0, 1, y - j);
  return mix(mix(hash(i, j), hash(i + 1, j), u), mix(hash(i, j + 1), hash(i + 1, j + 1), u), v);
}

export function fbm(x, y) {
  return noise(x, y) * .56 + noise(x * 2.07 + 13, y * 2.07) * .28
    + noise(x * 4.22, y * 4.22 - 16) * .11 + noise(x * 8.51, y * 8.51) * .05;
}

export function pathX(z) {
  return Math.sin(-z * .034) * 5.8 + Math.sin(-z * .078) * 1.85 + z * .04;
}

