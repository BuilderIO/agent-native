const SEED: u32 = 0x6f636561u;
const RESOLUTION: u32 = 512u;

// Random-access form of front's mulberry32. `callIndex` is the number of
// preceding PRNG calls, so each texel reproduces the CPU upload without state.
fn mulberryAt(callIndex: u32) -> f32 {
  let state = SEED + 0x6d2b79f5u * (callIndex + 1u);
  var t = state;
  t = (t ^ (t >> 15u)) * (t | 1u);
  t = t ^ (t + ((t ^ (t >> 7u)) * (t | 61u)));
  return f32(t ^ (t >> 14u)) / 4294967296.0;
}
fn gaussianPair(callIndex: u32) -> vec2f {
  let u1 = max(mulberryAt(callIndex), 1.17549435e-38);
  let u2 = mulberryAt(callIndex + 1u);
  let magnitude = sqrt(-2.0 * log(u1));
  let angle = 6.283185307179586 * u2;
  return magnitude * vec2f(cos(angle), sin(angle));
}
@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let coord = vec2u(position.xy - vec2f(0.5));
  let base = (coord.y * RESOLUTION + coord.x) * 4u;
  return vec4f(gaussianPair(base), gaussianPair(base + 2u));
}
