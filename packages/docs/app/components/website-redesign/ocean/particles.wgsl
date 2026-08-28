struct ParticleUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewport: vec4f,
  world: vec4f,
  fade: vec4f,
  // Cursor deformation. pointer is (world x, world z, strength, sigma) and
  // changes every frame -- sigma included, because it scales with how far the
  // cursor is from the camera. pointerShape is (steepness, push, rim, unused).
  pointer: vec4f,
  pointerShape: vec4f,
  // Adaptive thinning: (continuous level, max level, unused, unused).
  density: vec4f,
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
  // The simulation always runs at full resolution; a stride above 1 thins only
  // the draw, and the instance count on the CPU side uses the same floored
  // division. Disagree there and the field grows a seam.
  let stride = max(1u, u32(u.world.w));
  let gridSize = max(1u, resolution / stride);
  let i = (instanceIndex % gridSize) * stride;
  let j = (instanceIndex / gridSize) * stride;
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
  var pos = base + disp;
  var normal = nf.xyz;
  var height = disp.y;

  // A stateless per-vertex deformation, not a force in the simulation: the FFT
  // stays untouched, so this cannot destabilize it and costs nothing per frame.
  //
  // It deforms the surface in y and bends the normal to match, rather than
  // sliding particles sideways. Lateral motion alone moves the geometry while
  // the sampled lighting stays put, which is what reads as a flat warp laid over
  // the field instead of a hand pressing into water.
  let pointerStrength = u.pointer.z;
  if (pointerStrength > 0.0) {
    // Sigma arrives already scaled by camera distance, and the depth is a fixed
    // fraction of it, so the well is the same shape on screen wherever the
    // cursor is rather than flattening out toward the horizon.
    let sigma = max(0.001, u.pointer.w);
    let invSigma2 = 1.0 / (sigma * sigma);
    let rim = u.pointerShape.z;
    let depth = sigma * u.pointerShape.x * pointerStrength;

    // Outward from the cursor, and a Gaussian rather than an inverse-square
    // falloff: the long tail of an inverse square touches the whole field at
    // once, which is the other half of why this looked like an overlay.
    let offset = pos.xz - u.pointer.xy;
    let d2 = dot(offset, offset);
    let g = exp(-0.5 * d2 * invSigma2);

    // A well with a raised ring around it, the shape water actually takes when
    // something presses into it: -depth at the centre, positive around sigma.
    let well = depth * g * (d2 * invSigma2 * rim - 1.0);
    pos.y += well;
    height += well;

    // Closed-form slope of that same well, folded into the sampled normal. This
    // is the part that makes it read as three-dimensional: the fresnel rim and
    // the crest tint bend around the cursor instead of staying flat.
    let slope = depth * g * invSigma2 * (1.0 + 2.0 * rim - d2 * invSigma2 * rim);
    let grad = offset * slope;
    normal = normalize(normal + vec3f(-grad.x, 0.0, -grad.y));

    // A slight parting on top of the well. Kept small on purpose: wave features
    // here are about one world unit tall, so a lateral push of more than that
    // smears the pattern rather than displacing water.
    pos.x += offset.x * g * pointerStrength * u.pointerShape.y;
    pos.z += offset.y * g * pointerStrength * u.pointerShape.y;
  }

  let mv = u.view * vec4f(pos, 1.0);
  let viewDir = -mv.xyz;
  let dist = -mv.z;
  let f = 1.0 - smoothstep(u.fade.x, u.fade.y, dist);
  let fade = pow(clamp(f, 0.0, 1.0), u.fade.z);

  let projected = u.projection * mv;
  let ndc = projected.xy / projected.w;

  // How long this particle survives the thinning. A stride of 2^k keeps exactly
  // the texels whose index has k trailing zeros on both axes, so ranking by that
  // count makes the particles that fade out here the same ones the next whole
  // level stops drawing -- the instance count then falls with nothing visible
  // changing. countTrailingZeros(0) is 32, which is why index 0 outlives
  // everything rather than being the first to go.
  let dropOrder = min(
    min(countTrailingZeros(i), countTrailingZeros(j)),
    u32(max(0.0, u.density.y)),
  );
  // Full while the level is at or below this particle's rank, gone one level
  // later. Point size is deliberately left alone: growing the survivors to hold
  // the painted area constant is the change a viewer actually notices.
  let thinning = clamp(1.0 + f32(dropOrder) - u.density.x, 0.0, 1.0);

  let corner = quadCorner(vertexIndex);
  // A zero-size quad is degenerate and rasterizes no fragments, so a particle
  // that has finished fading costs a vertex and nothing more.
  let pointSizePx = select(2.0 * u.world.z * u.viewport.z, 0.0, thinning <= 0.0);
  let clipOffset = corner * (pointSizePx / u.viewport.xy) * projected.w;
  let clip = vec4f(ndc * projected.w + clipOffset, projected.z, projected.w);

  var out: VertexOut;
  out.position = clip;
  out.pointCoord = corner * 0.5 + vec2f(0.5);
  out.foam = nf.w;
  out.normal = normal;
  out.viewDir = viewDir;
  out.height = height;
  out.fade = fade * thinning;
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
