import { PI, G } from "./ocean-common.wgsl";

struct InitialSpectrumUniforms {
  resolution: f32,
  size: f32,
  windSpeed: f32,
  windAngle: f32,
  amplitude: f32,
};
@group(0) @binding(0) var<uniform> u: InitialSpectrumUniforms;
@group(0) @binding(1) var u_noise: texture_2d<f32>;

fn phillips(k: vec2f) -> f32 {
  let kk = dot(k, k);
  if (kk < 1e-8) { return 0.0; }
  let w = vec2f(cos(u.windAngle), sin(u.windAngle));
  let L = (u.windSpeed * u.windSpeed) / G;
  let kdotw = dot(normalize(k), w);
  var ph = u.amplitude * exp(-1.0 / (kk * L * L)) / (kk * kk) * (kdotw * kdotw);
  let l = L * 0.001;
  ph *= exp(-kk * l * l);
  if (kdotw < 0.0) { ph *= 0.07; }
  return ph;
}

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let coord = position.xy - vec2f(0.5);
  let n = select(coord.x - u.resolution, coord.x, coord.x < u.resolution * 0.5);
  let m = select(coord.y - u.resolution, coord.y, coord.y < u.resolution * 0.5);
  let k = (2.0 * PI / u.size) * vec2f(n, m);

  let rnd = textureLoad(u_noise, vec2u(coord), 0);

  let h0k    = (1.0 / sqrt(2.0)) * vec2f(rnd.x, rnd.y) * sqrt(phillips(k));
  let h0negk = (1.0 / sqrt(2.0)) * vec2f(rnd.z, rnd.w) * sqrt(phillips(-k));

  return vec4f(h0k, h0negk.x, -h0negk.y);
}
