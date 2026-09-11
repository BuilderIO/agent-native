struct BrightUniforms {
  luminosityThreshold: f32,
  smoothWidth: f32,
  _pad0: vec2f,
};
@group(0) @binding(0) var<uniform> uniforms: BrightUniforms;
@group(0) @binding(1) var tDiffuse: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // LuminosityHighPassShader.js @ three 0.184.0, with defaultColor=0 and defaultOpacity=0.
  let texel = textureSample(tDiffuse, linearSampler, uv);
  let v = luminance(texel.xyz);
  let outputColor = vec4f(vec3f(0.0), 0.0);
  let alpha = smoothstep(uniforms.luminosityThreshold, uniforms.luminosityThreshold + uniforms.smoothWidth, v);
  return mix(outputColor, texel, alpha);
}
