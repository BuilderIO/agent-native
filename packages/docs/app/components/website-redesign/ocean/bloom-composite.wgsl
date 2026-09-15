struct CompositeUniforms {
  bloomStrength: f32,
  bloomRadius: f32,
  _pad0: vec2f,
  bloomFactors0: vec4f,
  bloomFactors1: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: CompositeUniforms;
@group(0) @binding(1) var blurTexture1: texture_2d<f32>;
@group(0) @binding(2) var blurTexture2: texture_2d<f32>;
@group(0) @binding(3) var blurTexture3: texture_2d<f32>;
@group(0) @binding(4) var blurTexture4: texture_2d<f32>;
@group(0) @binding(5) var blurTexture5: texture_2d<f32>;
@group(0) @binding(6) var linearSampler: sampler;

fn factor(i: u32) -> f32 {
  let v = array<f32, 8>(
    uniforms.bloomFactors0.x, uniforms.bloomFactors0.y, uniforms.bloomFactors0.z, uniforms.bloomFactors0.w,
    uniforms.bloomFactors1.x, uniforms.bloomFactors1.y, uniforms.bloomFactors1.z, uniforms.bloomFactors1.w
  );
  return v[i];
}

fn lerpBloomFactor(f: f32) -> f32 {
  let mirrorFactor = 1.2 - f;
  return mix(f, mirrorFactor, uniforms.bloomRadius);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // UnrealBloomPass._getCompositeMaterial @ three 0.184.0. Tint colors are all white.
  let bloom = 3.0 * uniforms.bloomStrength * (
    lerpBloomFactor(factor(0u)) * textureSample(blurTexture1, linearSampler, uv).rgb +
    lerpBloomFactor(factor(1u)) * textureSample(blurTexture2, linearSampler, uv).rgb +
    lerpBloomFactor(factor(2u)) * textureSample(blurTexture3, linearSampler, uv).rgb +
    lerpBloomFactor(factor(3u)) * textureSample(blurTexture4, linearSampler, uv).rgb +
    lerpBloomFactor(factor(4u)) * textureSample(blurTexture5, linearSampler, uv).rgb
  );
  let bloomAlpha = max(bloom.r, max(bloom.g, bloom.b));
  return vec4f(bloom, bloomAlpha);
}
