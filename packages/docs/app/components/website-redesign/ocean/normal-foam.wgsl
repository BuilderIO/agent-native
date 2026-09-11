import { wrapLoad } from "./ocean-common.wgsl";

struct NormalFoamUniforms {
  resolution: f32,
  worldSize: f32,
  displacementScale: f32,
  foamThreshold: f32,
};
@group(0) @binding(0) var<uniform> u: NormalFoamUniforms;
@group(0) @binding(1) var u_displacement: texture_2d<f32>;

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let N = i32(u.resolution);
  let coord = vec2i(position.xy - vec2f(0.5));
  let dx = u.worldSize / u.resolution;

  let r = wrapLoad(u_displacement, coord + vec2i(1, 0), N).xyz * u.displacementScale;
  let l = wrapLoad(u_displacement, coord - vec2i(1, 0), N).xyz * u.displacementScale;
  let t = wrapLoad(u_displacement, coord + vec2i(0, 1), N).xyz * u.displacementScale;
  let b = wrapLoad(u_displacement, coord - vec2i(0, 1), N).xyz * u.displacementScale;

  let dhdx = (r.y - l.y) / (2.0 * dx);
  let dhdz = (t.y - b.y) / (2.0 * dx);
  let normal = normalize(vec3f(-dhdx, 1.0, -dhdz));

  let dDxdx = (r.x - l.x) / (2.0 * dx);
  let dDzdz = (t.z - b.z) / (2.0 * dx);
  let dDxdz = (t.x - b.x) / (2.0 * dx);
  let dDzdx = (r.z - l.z) / (2.0 * dx);
  let J = (1.0 + dDxdx) * (1.0 + dDzdz) - dDxdz * dDzdx;

  let foam = 1.0 - smoothstep(u.foamThreshold, u.foamThreshold + 0.8, J);
  return vec4f(normal, foam);
}
