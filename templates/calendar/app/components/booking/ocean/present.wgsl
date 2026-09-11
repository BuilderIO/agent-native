// Edited from the upstream fft-ocean example. Upstream emitted the HDR sum
// directly, which only reads correctly on a black page. The hero sits on
// --b-bg-page in two themes, so this pass collapses the scene to a single tone
// and resolves it between the brand's background and foreground instead.

struct PresentUniforms {
  fgColor: vec4f,
  bgColor: vec4f,
  // How far the brightest tone is pushed past fgColor. 1.0 is a plain mix.
  brightness: f32,
  _pad: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: PresentUniforms;
@group(0) @binding(1) var sceneHDR: texture_2d<f32>;
@group(0) @binding(2) var bloomTexture: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

fn LinearTosRGB(value: vec4f) -> vec4f {
  let lt = value.rgb * 12.92;
  let gt = 1.055 * pow(value.rgb, vec3f(0.41666)) - vec3f(0.055);
  let rgb = select(gt, lt, value.rgb <= vec3f(0.0031308));
  return vec4f(rgb, value.a);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let scene = textureSample(sceneHDR, linearSampler, uv);
  let bloom = textureSample(bloomTexture, linearSampler, uv);
  let hdr = scene.rgb + bloom.rgb;

  // The ocean is already monochrome by construction (near-black water, white
  // crests and foam), so luminance loses nothing and gives one tone to drive
  // both tokens from.
  let tone = clamp(dot(hdr, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);

  // Extrapolate away from bg *along the fg/bg contrast direction* rather than
  // toward literal white: in dark mode fg is lighter than bg so bright tones
  // push toward white, in light mode fg is darker so they push toward black.
  // A mix toward white would invert the whole composition in light mode.
  var color = mix(uniforms.bgColor.rgb, uniforms.fgColor.rgb, tone);
  color += (uniforms.fgColor.rgb - uniforms.bgColor.rgb) * tone * tone
    * (uniforms.brightness - 1.0);

  return LinearTosRGB(vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0));
}
