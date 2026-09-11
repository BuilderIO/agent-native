// Evolves the FFT ocean spectrum each frame.
//
// `initial-spectrum.wgsl` seeds h0(k) and h0(-k) from the Phillips-style
// wind spectrum. This pass applies deep-water dispersion over time to produce
// the frequency-domain height and horizontal displacement channels consumed by
// the IFFT passes; later passes transform them into spatial displacement,
// normals/foam, and particles.

import { PI, G, cmul } from "./ocean-common.wgsl";

struct SpectrumUniforms {
  resolution: f32,
  size: f32,
  time: f32,
  choppiness: f32,
};
@group(0) @binding(0) var<uniform> u: SpectrumUniforms;
@group(0) @binding(1) var u_initialSpectrum: texture_2d<f32>;

@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let coord = position.xy - vec2f(0.5);
  let n = select(coord.x - u.resolution, coord.x, coord.x < u.resolution * 0.5);
  let m = select(coord.y - u.resolution, coord.y, coord.y < u.resolution * 0.5);
  let k = (2.0 * PI / u.size) * vec2f(n, m);
  let kLen = length(k);

  let h0 = textureLoad(u_initialSpectrum, vec2u(coord), 0);
  let w = sqrt(G * kLen) * u.time;
  let expp = vec2f(cos(w),  sin(w));
  let expm = vec2f(cos(w), -sin(w));

  let h = cmul(h0.rg, expp) + cmul(h0.ba, expm);

  // Convert the evolved height spectrum into slope/height and choppy
  // horizontal displacement spectra before the inverse FFT stages.
  var kn = vec2f(0.0);
  if (kLen > 0.0) { kn = k / kLen; }
  let negI_h = vec2f(h.y, -h.x);
  let hx = negI_h * kn.x * u.choppiness;
  let hz = negI_h * kn.y * u.choppiness;

  let cA = vec2f(hx.x - h.y, hx.y + h.x);
  let cB = hz;
  return vec4f(cA, cB);
}
