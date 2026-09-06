// Coefficients after each level's canonical radius are zero, so one fixed
// 22-tap loop reproduces front's 6/10/14/18/22 specialized pipelines.
const KERNEL_RADIUS: u32 = 22u;
struct BlurUniforms {
  direction: vec2f,
  invSize: vec2f,
  gaussianCoefficients0: vec4f,
  gaussianCoefficients1: vec4f,
  gaussianCoefficients2: vec4f,
  gaussianCoefficients3: vec4f,
  gaussianCoefficients4: vec4f,
  gaussianCoefficients5: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: BlurUniforms;
@group(0) @binding(1) var colorTexture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

fn coefficient(i: u32) -> f32 {
  let packed = array<vec4f, 6>(
    uniforms.gaussianCoefficients0,
    uniforms.gaussianCoefficients1,
    uniforms.gaussianCoefficients2,
    uniforms.gaussianCoefficients3,
    uniforms.gaussianCoefficients4,
    uniforms.gaussianCoefficients5
  );
  return packed[i / 4u][i % 4u];
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // UnrealBloomPass._getSeparableBlurMaterial @ three 0.184.0.
  var weightSum = coefficient(0u);
  var diffuseSum = textureSample(colorTexture, linearSampler, uv).rgb * weightSum;
  for (var i = 1u; i < KERNEL_RADIUS; i = i + 1u) {
    let x = f32(i);
    let w = coefficient(i);
    let uvOffset = uniforms.direction * uniforms.invSize * x;
    let sample1 = textureSample(colorTexture, linearSampler, uv + uvOffset).rgb;
    let sample2 = textureSample(colorTexture, linearSampler, uv - uvOffset).rgb;
    diffuseSum = diffuseSum + (sample1 + sample2) * w;
  }
  return vec4f(diffuseSum, 1.0);
}
