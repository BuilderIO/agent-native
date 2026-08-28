struct ParticleUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewport: vec4f,
  world: vec4f,
  fade: vec4f,
  oceanColor: vec4f,
  neonColor: vec4f,
  foamColor: vec4f,
};

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) pointCoord: vec2f,
  @location(1) foam: f32,
  @location(2) normal: vec3f,
  @location(3) viewDir: vec3f,
  @location(4) height: f32,
  @location(5) fade: f32,
};

@group(0) @binding(0) var<uniform> u: ParticleUniforms;
@group(0) @binding(1) var u_displacement: texture_2d<f32>;
@group(0) @binding(2) var u_normalFoam: texture_2d<f32>;

fn quadCorner(vertexIndex: u32) -> vec2f {
  let cornerIndex = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u)[vertexIndex % 6u];
  switch (cornerIndex) {
    case 0u: { return vec2f(-1.0, -1.0); }
    case 1u: { return vec2f( 1.0, -1.0); }
    case 2u: { return vec2f(-1.0,  1.0); }
    default: { return vec2f( 1.0,  1.0); }
  }
}

@vertex fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let resolution = max(1u, u32(u.viewport.w));
  let i = instanceIndex % resolution;
  let j = instanceIndex / resolution;
  let particleRef = vec2f(f32(i), f32(j)) / f32(resolution);
  let texCoord = vec2u(i, j);

  let disp = textureLoad(u_displacement, texCoord, 0).xyz * u.world.y;
  let nf = textureLoad(u_normalFoam, texCoord, 0);

  let halfWorld = u.world.x * 0.5;
  let base = vec3f(
    particleRef.x * u.world.x - halfWorld,
    0.0,
    particleRef.y * u.world.x - halfWorld,
  );
  let pos = base + disp;

  let mv = u.view * vec4f(pos, 1.0);
  let viewDir = -mv.xyz;
  let dist = -mv.z;
  let f = 1.0 - smoothstep(u.fade.x, u.fade.y, dist);
  let fade = pow(clamp(f, 0.0, 1.0), u.fade.z);

  let projected = u.projection * mv;
  let ndc = projected.xy / projected.w;

  let corner = quadCorner(vertexIndex);
  let pointSizePx = 2.0 * u.world.z * u.viewport.z;
  let clipOffset = corner * (pointSizePx / u.viewport.xy) * projected.w;
  let clip = vec4f(ndc * projected.w + clipOffset, projected.z, projected.w);

  var out: VertexOut;
  out.position = clip;
  out.pointCoord = corner * 0.5 + vec2f(0.5);
  out.foam = nf.w;
  out.normal = nf.xyz;
  out.viewDir = viewDir;
  out.height = disp.y;
  out.fade = fade;
  return out;
}

@fragment fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let cc = in.pointCoord - vec2f(0.5);
  let d2 = dot(cc, cc);
  if (d2 > 0.25) {
    discard;
  }

  let n = normalize(in.normal);
  let v = normalize(in.viewDir);
  let fresnel = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);

  let foam = clamp(in.foam, 0.0, 1.0);
  let crest = smoothstep(-0.5, 1.5, in.height);

  var color = u.oceanColor.rgb * 0.5;
  color += u.neonColor.rgb * crest * 0.5;
  color += u.neonColor.rgb * fresnel * 0.15;
  color = mix(color, u.foamColor.rgb, foam);
  var alpha = 0.02 + crest * 0.06 + fresnel * 0.04;
  alpha = mix(alpha, 1.0, foam);
  color *= in.fade;
  alpha *= in.fade;
  return vec4f(color, clamp(alpha, 0.0, 1.0));
}
