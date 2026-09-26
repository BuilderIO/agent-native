


struct PresentUniforms {
  fgColor: vec4f,
  bgColor: vec4f,

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




  let tone = clamp(dot(hdr, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);





  var color = mix(uniforms.bgColor.rgb, uniforms.fgColor.rgb, tone);
  color += (uniforms.fgColor.rgb - uniforms.bgColor.rgb) * tone * tone
    * (uniforms.brightness - 1.0);

  return LinearTosRGB(vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0));
}
