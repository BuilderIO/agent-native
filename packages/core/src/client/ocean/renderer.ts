// Vendored from the vgpu `fft-ocean` example ("Particles ocean").
//   revision 8ca322aa1cf0bc25aff3d38389d48090bf065c6baf14bea858fd9b8e4bceea96
//   npx vgpu examples pull fft-ocean
// Diff against that revision before pulling upstream changes: this copy is
// edited (see present.wgsl's token-driven colouring and setPresentColors).

import {
  clock,
  draw,
  effect,
  frame,
  frameLoop,
  sampler,
  surface,
  target,
  type Draw,
  type Effect,
  type Frame,
  type FrameLoopHandle,
  type Gpu,
  type ShaderSource,
  type Surface,
  type Target,
} from "vgpu";

const bloomBlurWgsl =
  "// Coefficients after each level's canonical radius are zero, so one fixed\n// 22-tap loop reproduces front's 6/10/14/18/22 specialized pipelines.\nconst KERNEL_RADIUS: u32 = 22u;\nstruct BlurUniforms {\n  direction: vec2f,\n  invSize: vec2f,\n  gaussianCoefficients0: vec4f,\n  gaussianCoefficients1: vec4f,\n  gaussianCoefficients2: vec4f,\n  gaussianCoefficients3: vec4f,\n  gaussianCoefficients4: vec4f,\n  gaussianCoefficients5: vec4f,\n};\n@group(0) @binding(0) var<uniform> uniforms: BlurUniforms;\n@group(0) @binding(1) var colorTexture: texture_2d<f32>;\n@group(0) @binding(2) var linearSampler: sampler;\n\nfn coefficient(i: u32) -> f32 {\n  let packed = array<vec4f, 6>(\n    uniforms.gaussianCoefficients0,\n    uniforms.gaussianCoefficients1,\n    uniforms.gaussianCoefficients2,\n    uniforms.gaussianCoefficients3,\n    uniforms.gaussianCoefficients4,\n    uniforms.gaussianCoefficients5\n  );\n  return packed[i / 4u][i % 4u];\n}\n\n@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {\n  // UnrealBloomPass._getSeparableBlurMaterial @ three 0.184.0.\n  var weightSum = coefficient(0u);\n  var diffuseSum = textureSample(colorTexture, linearSampler, uv).rgb * weightSum;\n  for (var i = 1u; i < KERNEL_RADIUS; i = i + 1u) {\n    let x = f32(i);\n    let w = coefficient(i);\n    let uvOffset = uniforms.direction * uniforms.invSize * x;\n    let sample1 = textureSample(colorTexture, linearSampler, uv + uvOffset).rgb;\n    let sample2 = textureSample(colorTexture, linearSampler, uv - uvOffset).rgb;\n    diffuseSum = diffuseSum + (sample1 + sample2) * w;\n  }\n  return vec4f(diffuseSum, 1.0);\n}\n";
const bloomBrightWgsl =
  "struct BrightUniforms {\n  luminosityThreshold: f32,\n  smoothWidth: f32,\n  _pad0: vec2f,\n};\n@group(0) @binding(0) var<uniform> uniforms: BrightUniforms;\n@group(0) @binding(1) var tDiffuse: texture_2d<f32>;\n@group(0) @binding(2) var linearSampler: sampler;\n\nfn luminance(rgb: vec3f) -> f32 {\n  return dot(rgb, vec3f(0.299, 0.587, 0.114));\n}\n\n@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {\n  // LuminosityHighPassShader.js @ three 0.184.0, with defaultColor=0 and defaultOpacity=0.\n  let texel = textureSample(tDiffuse, linearSampler, uv);\n  let v = luminance(texel.xyz);\n  let outputColor = vec4f(vec3f(0.0), 0.0);\n  let alpha = smoothstep(uniforms.luminosityThreshold, uniforms.luminosityThreshold + uniforms.smoothWidth, v);\n  return mix(outputColor, texel, alpha);\n}\n";
const bloomCompositeWgsl =
  "struct CompositeUniforms {\n  bloomStrength: f32,\n  bloomRadius: f32,\n  _pad0: vec2f,\n  bloomFactors0: vec4f,\n  bloomFactors1: vec4f,\n};\n@group(0) @binding(0) var<uniform> uniforms: CompositeUniforms;\n@group(0) @binding(1) var blurTexture1: texture_2d<f32>;\n@group(0) @binding(2) var blurTexture2: texture_2d<f32>;\n@group(0) @binding(3) var blurTexture3: texture_2d<f32>;\n@group(0) @binding(4) var blurTexture4: texture_2d<f32>;\n@group(0) @binding(5) var blurTexture5: texture_2d<f32>;\n@group(0) @binding(6) var linearSampler: sampler;\n\nfn factor(i: u32) -> f32 {\n  let v = array<f32, 8>(\n    uniforms.bloomFactors0.x, uniforms.bloomFactors0.y, uniforms.bloomFactors0.z, uniforms.bloomFactors0.w,\n    uniforms.bloomFactors1.x, uniforms.bloomFactors1.y, uniforms.bloomFactors1.z, uniforms.bloomFactors1.w\n  );\n  return v[i];\n}\n\nfn lerpBloomFactor(f: f32) -> f32 {\n  let mirrorFactor = 1.2 - f;\n  return mix(f, mirrorFactor, uniforms.bloomRadius);\n}\n\n@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {\n  // UnrealBloomPass._getCompositeMaterial @ three 0.184.0. Tint colors are all white.\n  let bloom = 3.0 * uniforms.bloomStrength * (\n    lerpBloomFactor(factor(0u)) * textureSample(blurTexture1, linearSampler, uv).rgb +\n    lerpBloomFactor(factor(1u)) * textureSample(blurTexture2, linearSampler, uv).rgb +\n    lerpBloomFactor(factor(2u)) * textureSample(blurTexture3, linearSampler, uv).rgb +\n    lerpBloomFactor(factor(3u)) * textureSample(blurTexture4, linearSampler, uv).rgb +\n    lerpBloomFactor(factor(4u)) * textureSample(blurTexture5, linearSampler, uv).rgb\n  );\n  let bloomAlpha = max(bloom.r, max(bloom.g, bloom.b));\n  return vec4f(bloom, bloomAlpha);\n}\n";
import { oceanCamera } from "./camera.js";
const ifftStageWgsl =
  "const PI: f32 = 3.141592653589793;\nconst G: f32 = 9.81;\n\nfn cmul(a: vec2f, b: vec2f) -> vec2f {\n  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);\n}\n\nfn wrapCoord(coord: vec2i, N: i32) -> vec2u {\n  let wrapped = (coord % vec2i(N) + vec2i(N)) % vec2i(N);\n  return vec2u(wrapped);\n}\n\nfn wrapLoad(tex: texture_2d<f32>, coord: vec2i, N: i32) -> vec4f {\n  return textureLoad(tex, wrapCoord(coord, N), 0);\n}\nstruct IfftStageUniforms {\n  resolution: f32,\n  subtransformSize: f32,\n  horizontal: f32,\n};\n@group(0) @binding(0) var<uniform> u: IfftStageUniforms;\n@group(0) @binding(1) var u_input: texture_2d<f32>;\n\n@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let N = i32(u.resolution);\n  let horizontal = u.horizontal > 0.5;\n  let index = select(position.y - 0.5, position.x - 0.5, horizontal);\n\n  let evenIndex = floor(index / u.subtransformSize) * (u.subtransformSize * 0.5)\n                + (index % (u.subtransformSize * 0.5));\n\n  let evenCoord = select(\n    vec2i(i32(position.x - 0.5), i32(evenIndex)),\n    vec2i(i32(evenIndex), i32(position.y - 0.5)),\n    horizontal,\n  );\n  let oddCoord = select(\n    vec2i(i32(position.x - 0.5), i32(evenIndex + u.resolution * 0.5)),\n    vec2i(i32(evenIndex + u.resolution * 0.5), i32(position.y - 0.5)),\n    horizontal,\n  );\n  let even = wrapLoad(u_input, evenCoord, N);\n  let odd = wrapLoad(u_input, oddCoord, N);\n\n  let twiddleArg = 2.0 * PI * (index / u.subtransformSize);\n  let twiddle = vec2f(cos(twiddleArg), sin(twiddleArg));\n\n  let outA = even.xy + cmul(twiddle, odd.xy);\n  let outB = even.zw + cmul(twiddle, odd.zw);\n  return vec4f(outA, outB);\n}\n";
const initialSpectrumWgsl =
  "const PI: f32 = 3.141592653589793;\nconst G: f32 = 9.81;\n\nfn cmul(a: vec2f, b: vec2f) -> vec2f {\n  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);\n}\n\nfn wrapCoord(coord: vec2i, N: i32) -> vec2u {\n  let wrapped = (coord % vec2i(N) + vec2i(N)) % vec2i(N);\n  return vec2u(wrapped);\n}\n\nfn wrapLoad(tex: texture_2d<f32>, coord: vec2i, N: i32) -> vec4f {\n  return textureLoad(tex, wrapCoord(coord, N), 0);\n}\nstruct InitialSpectrumUniforms {\n  resolution: f32,\n  size: f32,\n  windSpeed: f32,\n  windAngle: f32,\n  amplitude: f32,\n};\n@group(0) @binding(0) var<uniform> u: InitialSpectrumUniforms;\n@group(0) @binding(1) var u_noise: texture_2d<f32>;\n\nfn phillips(k: vec2f) -> f32 {\n  let kk = dot(k, k);\n  if (kk < 1e-8) { return 0.0; }\n  let w = vec2f(cos(u.windAngle), sin(u.windAngle));\n  let L = (u.windSpeed * u.windSpeed) / G;\n  let kdotw = dot(normalize(k), w);\n  var ph = u.amplitude * exp(-1.0 / (kk * L * L)) / (kk * kk) * (kdotw * kdotw);\n  let l = L * 0.001;\n  ph *= exp(-kk * l * l);\n  if (kdotw < 0.0) { ph *= 0.07; }\n  return ph;\n}\n\n@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let coord = position.xy - vec2f(0.5);\n  let n = select(coord.x - u.resolution, coord.x, coord.x < u.resolution * 0.5);\n  let m = select(coord.y - u.resolution, coord.y, coord.y < u.resolution * 0.5);\n  let k = (2.0 * PI / u.size) * vec2f(n, m);\n\n  let rnd = textureLoad(u_noise, vec2u(coord), 0);\n\n  let h0k    = (1.0 / sqrt(2.0)) * vec2f(rnd.x, rnd.y) * sqrt(phillips(k));\n  let h0negk = (1.0 / sqrt(2.0)) * vec2f(rnd.z, rnd.w) * sqrt(phillips(-k));\n\n  return vec4f(h0k, h0negk.x, -h0negk.y);\n}\n";
const noiseWgsl =
  "const SEED: u32 = 0x6f636561u;\nconst RESOLUTION: u32 = 512u;\n\n// Random-access form of front's mulberry32. `callIndex` is the number of\n// preceding PRNG calls, so each texel reproduces the CPU upload without state.\nfn mulberryAt(callIndex: u32) -> f32 {\n  let state = SEED + 0x6d2b79f5u * (callIndex + 1u);\n  var t = state;\n  t = (t ^ (t >> 15u)) * (t | 1u);\n  t = t ^ (t + ((t ^ (t >> 7u)) * (t | 61u)));\n  return f32(t ^ (t >> 14u)) / 4294967296.0;\n}\nfn gaussianPair(callIndex: u32) -> vec2f {\n  let u1 = max(mulberryAt(callIndex), 1.17549435e-38);\n  let u2 = mulberryAt(callIndex + 1u);\n  let magnitude = sqrt(-2.0 * log(u1));\n  let angle = 6.283185307179586 * u2;\n  return magnitude * vec2f(cos(angle), sin(angle));\n}\n@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let coord = vec2u(position.xy - vec2f(0.5));\n  let base = (coord.y * RESOLUTION + coord.x) * 4u;\n  return vec4f(gaussianPair(base), gaussianPair(base + 2u));\n}\n";
const normalFoamWgsl =
  "const PI: f32 = 3.141592653589793;\nconst G: f32 = 9.81;\n\nfn cmul(a: vec2f, b: vec2f) -> vec2f {\n  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);\n}\n\nfn wrapCoord(coord: vec2i, N: i32) -> vec2u {\n  let wrapped = (coord % vec2i(N) + vec2i(N)) % vec2i(N);\n  return vec2u(wrapped);\n}\n\nfn wrapLoad(tex: texture_2d<f32>, coord: vec2i, N: i32) -> vec4f {\n  return textureLoad(tex, wrapCoord(coord, N), 0);\n}\nstruct NormalFoamUniforms {\n  resolution: f32,\n  worldSize: f32,\n  displacementScale: f32,\n  foamThreshold: f32,\n};\n@group(0) @binding(0) var<uniform> u: NormalFoamUniforms;\n@group(0) @binding(1) var u_displacement: texture_2d<f32>;\n\n@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let N = i32(u.resolution);\n  let coord = vec2i(position.xy - vec2f(0.5));\n  let dx = u.worldSize / u.resolution;\n\n  let r = wrapLoad(u_displacement, coord + vec2i(1, 0), N).xyz * u.displacementScale;\n  let l = wrapLoad(u_displacement, coord - vec2i(1, 0), N).xyz * u.displacementScale;\n  let t = wrapLoad(u_displacement, coord + vec2i(0, 1), N).xyz * u.displacementScale;\n  let b = wrapLoad(u_displacement, coord - vec2i(0, 1), N).xyz * u.displacementScale;\n\n  let dhdx = (r.y - l.y) / (2.0 * dx);\n  let dhdz = (t.y - b.y) / (2.0 * dx);\n  let normal = normalize(vec3f(-dhdx, 1.0, -dhdz));\n\n  let dDxdx = (r.x - l.x) / (2.0 * dx);\n  let dDzdz = (t.z - b.z) / (2.0 * dx);\n  let dDxdz = (t.x - b.x) / (2.0 * dx);\n  let dDzdx = (r.z - l.z) / (2.0 * dx);\n  let J = (1.0 + dDxdx) * (1.0 + dDzdz) - dDxdz * dDzdx;\n\n  let foam = 1.0 - smoothstep(u.foamThreshold, u.foamThreshold + 0.8, J);\n  return vec4f(normal, foam);\n}\n";
import { DEFAULT_OCEAN_COLORS, type OceanColors } from "./ocean-colors.js";
import {
  createIfftStageTable,
  OCEAN_RESOLUTION,
  type IfftStage,
  type SimulationTargetName,
} from "./ocean-graph.js";
const particlesWgsl =
  "struct ParticleUniforms {\n  view: mat4x4f,\n  projection: mat4x4f,\n  viewport: vec4f,\n  world: vec4f,\n  fade: vec4f,\n  oceanColor: vec4f,\n  neonColor: vec4f,\n  foamColor: vec4f,\n  cursor: vec4f,\n};\n\nstruct VertexOut {\n  @builtin(position) position: vec4f,\n  @location(0) pointCoord: vec2f,\n  @location(1) foam: f32,\n  @location(2) normal: vec3f,\n  @location(3) viewDir: vec3f,\n  @location(4) height: f32,\n  @location(5) fade: f32,\n};\n\n@group(0) @binding(0) var<uniform> u: ParticleUniforms;\n@group(0) @binding(1) var u_displacement: texture_2d<f32>;\n@group(0) @binding(2) var u_normalFoam: texture_2d<f32>;\n\nfn particleHash(p: vec2u) -> f32 {\n  var n = p.x * 374761393u + p.y * 668265263u;\n  n = (n ^ (n >> 13u)) * 1274126177u;\n  n = n ^ (n >> 16u);\n  return f32(n) / 4294967295.0;\n}\n\nfn quadCorner(vertexIndex: u32) -> vec2f {\n  let cornerIndex = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u)[vertexIndex % 6u];\n  switch (cornerIndex) {\n    case 0u: { return vec2f(-1.0, -1.0); }\n    case 1u: { return vec2f( 1.0, -1.0); }\n    case 2u: { return vec2f(-1.0,  1.0); }\n    default: { return vec2f( 1.0,  1.0); }\n  }\n}\n\n@vertex fn vs_main(\n  @builtin(vertex_index) vertexIndex: u32,\n  @builtin(instance_index) instanceIndex: u32,\n) -> VertexOut {\n  let resolution = max(1u, u32(u.viewport.w));\n  let i = instanceIndex % resolution;\n  let j = instanceIndex / resolution;\n  let particleRef = vec2f(f32(i), f32(j)) / f32(resolution);\n  let texCoord = vec2u(i, j);\n\n  let disp = textureLoad(u_displacement, texCoord, 0).xyz * u.world.y;\n  let nf = textureLoad(u_normalFoam, texCoord, 0);\n\n  let halfWorld = u.world.x * 0.5;\n  let base = vec3f(\n    particleRef.x * u.world.x - halfWorld,\n    0.0,\n    particleRef.y * u.world.x - halfWorld,\n  );\n  let pos = base + disp;\n\n  let mv = u.view * vec4f(pos, 1.0);\n  let viewDir = -mv.xyz;\n  let dist = -mv.z;\n  let f = 1.0 - smoothstep(u.fade.x, u.fade.y, dist);\n  let fade = pow(clamp(f, 0.0, 1.0), u.fade.z);\n\n  let projected = u.projection * mv;\n  var ndc = projected.xy / projected.w;\n\n  let aspect = u.viewport.x / max(u.viewport.y, 1.0);\n  if (u.cursor.z > 0.0) {\n    let cursorDelta = u.cursor.xy - ndc;\n    let fieldDelta = cursorDelta * vec2f(aspect, 1.0);\n    let cursorDistance = length(fieldDelta);\n    let rangeFalloff = 1.0 - smoothstep(0.0, 1.7, cursorDistance);\n    let particleId = vec2u(i, j);\n    let particleSeed = particleHash(particleId);\n    let detached = smoothstep(0.76, 0.998, particleSeed);\n    let phase = particleHash(particleId + vec2u(37u, 71u)) * 6.2831855;\n    let activity = 0.55 + 0.45 * (0.5 + 0.5 * sin(u.cursor.w * 0.45 + phase));\n    let trailProgress = clamp(cursorDistance / 1.7, 0.0, 1.0);\n    let trailWidth = mix(0.025, 0.28, trailProgress);\n    let jitter = vec2f(\n      particleHash(particleId + vec2u(17u, 53u)) - 0.5,\n      particleHash(particleId + vec2u(41u, 29u)) - 0.5,\n    ) * vec2f(trailWidth / aspect, trailWidth);\n    let nearFalloff = 1.0 - smoothstep(0.0, 1.0, cursorDistance);\n    let baselineResponse = mix(0.004, 0.014, nearFalloff) *\n      mix(0.6, 1.0, particleSeed);\n    let particleResponse = baselineResponse +\n      detached * activity * mix(0.11, 0.82, nearFalloff);\n    let attraction = rangeFalloff * particleResponse * u.cursor.z;\n    ndc += (u.cursor.xy + jitter - ndc) * attraction;\n  }\n\n  let corner = quadCorner(vertexIndex);\n  let pointSizePx = 2.0 * u.world.z * u.viewport.z;\n  let clipOffset = corner * (pointSizePx / u.viewport.xy) * projected.w;\n  let clip = vec4f(ndc * projected.w + clipOffset, projected.z, projected.w);\n\n  var out: VertexOut;\n  out.position = clip;\n  out.pointCoord = corner * 0.5 + vec2f(0.5);\n  out.foam = nf.w;\n  out.normal = nf.xyz;\n  out.viewDir = viewDir;\n  out.height = disp.y;\n  out.fade = fade;\n  return out;\n}\n\n@fragment fn fs_main(in: VertexOut) -> @location(0) vec4f {\n  let cc = in.pointCoord - vec2f(0.5);\n  let d2 = dot(cc, cc);\n  if (d2 > 0.25) {\n    discard;\n  }\n\n  let n = normalize(in.normal);\n  let v = normalize(in.viewDir);\n  let fresnel = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);\n\n  let foam = clamp(in.foam, 0.0, 1.0);\n  let crest = smoothstep(-0.5, 1.5, in.height);\n\n  var color = u.oceanColor.rgb * 0.5;\n  color += u.neonColor.rgb * crest * 0.5;\n  color += u.neonColor.rgb * fresnel * 0.15;\n  color = mix(color, u.foamColor.rgb, foam);\n  var alpha = 0.02 + crest * 0.06 + fresnel * 0.04;\n  alpha = mix(alpha, 1.0, foam);\n  color *= in.fade;\n  alpha *= in.fade;\n  return vec4f(color, clamp(alpha, 0.0, 1.0));\n}\n";
const presentWgsl =
  "// Edited from the upstream fft-ocean example. Upstream emitted the HDR sum\n// directly, which only reads correctly on a black page. The hero sits on\n// --b-bg-page in two themes, so this pass collapses the scene to a single tone\n// and resolves it between the brand's background and foreground instead.\n\nstruct PresentUniforms {\n  fgColor: vec4f,\n  bgColor: vec4f,\n  // How far the brightest tone is pushed past fgColor. 1.0 is a plain mix.\n  brightness: f32,\n  _pad: vec3f,\n};\n\n@group(0) @binding(0) var<uniform> uniforms: PresentUniforms;\n@group(0) @binding(1) var sceneHDR: texture_2d<f32>;\n@group(0) @binding(2) var bloomTexture: texture_2d<f32>;\n@group(0) @binding(3) var linearSampler: sampler;\n\nfn LinearTosRGB(value: vec4f) -> vec4f {\n  let lt = value.rgb * 12.92;\n  let gt = 1.055 * pow(value.rgb, vec3f(0.41666)) - vec3f(0.055);\n  let rgb = select(gt, lt, value.rgb <= vec3f(0.0031308));\n  return vec4f(rgb, value.a);\n}\n\n@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {\n  let scene = textureSample(sceneHDR, linearSampler, uv);\n  let bloom = textureSample(bloomTexture, linearSampler, uv);\n  let hdr = scene.rgb + bloom.rgb;\n\n  // The ocean is already monochrome by construction (near-black water, white\n  // crests and foam), so luminance loses nothing and gives one tone to drive\n  // both tokens from.\n  let tone = clamp(dot(hdr, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);\n\n  // Extrapolate away from bg *along the fg/bg contrast direction* rather than\n  // toward literal white: in dark mode fg is lighter than bg so bright tones\n  // push toward white, in light mode fg is darker so they push toward black.\n  // A mix toward white would invert the whole composition in light mode.\n  var color = mix(uniforms.bgColor.rgb, uniforms.fgColor.rgb, tone);\n  color += (uniforms.fgColor.rgb - uniforms.bgColor.rgb) * tone * tone\n    * (uniforms.brightness - 1.0);\n\n  return LinearTosRGB(vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0));\n}\n";
const spectrumWgsl =
  "// Evolves the FFT ocean spectrum each frame.\n//\n// `initial-spectrum.wgsl` seeds h0(k) and h0(-k) from the Phillips-style\n// wind spectrum. This pass applies deep-water dispersion over time to produce\n// the frequency-domain height and horizontal displacement channels consumed by\n// the IFFT passes; later passes transform them into spatial displacement,\n// normals/foam, and particles.\n\nconst PI: f32 = 3.141592653589793;\nconst G: f32 = 9.81;\n\nfn cmul(a: vec2f, b: vec2f) -> vec2f {\n  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);\n}\n\nfn wrapCoord(coord: vec2i, N: i32) -> vec2u {\n  let wrapped = (coord % vec2i(N) + vec2i(N)) % vec2i(N);\n  return vec2u(wrapped);\n}\n\nfn wrapLoad(tex: texture_2d<f32>, coord: vec2i, N: i32) -> vec4f {\n  return textureLoad(tex, wrapCoord(coord, N), 0);\n}\nstruct SpectrumUniforms {\n  resolution: f32,\n  size: f32,\n  time: f32,\n  choppiness: f32,\n};\n@group(0) @binding(0) var<uniform> u: SpectrumUniforms;\n@group(0) @binding(1) var u_initialSpectrum: texture_2d<f32>;\n\n@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let coord = position.xy - vec2f(0.5);\n  let n = select(coord.x - u.resolution, coord.x, coord.x < u.resolution * 0.5);\n  let m = select(coord.y - u.resolution, coord.y, coord.y < u.resolution * 0.5);\n  let k = (2.0 * PI / u.size) * vec2f(n, m);\n  let kLen = length(k);\n\n  let h0 = textureLoad(u_initialSpectrum, vec2u(coord), 0);\n  let w = sqrt(G * kLen) * u.time;\n  let expp = vec2f(cos(w),  sin(w));\n  let expm = vec2f(cos(w), -sin(w));\n\n  let h = cmul(h0.rg, expp) + cmul(h0.ba, expm);\n\n  // Convert the evolved height spectrum into slope/height and choppy\n  // horizontal displacement spectra before the inverse FFT stages.\n  var kn = vec2f(0.0);\n  if (kLen > 0.0) { kn = k / kLen; }\n  let negI_h = vec2f(h.y, -h.x);\n  let hx = negI_h * kn.x * u.choppiness;\n  let hz = negI_h * kn.y * u.choppiness;\n\n  let cA = vec2f(hx.x - h.y, hx.y + h.x);\n  let cB = hz;\n  return vec4f(cA, cB);\n}\n";
import { gaussianCoefficients, OCEAN_TUNING } from "./tuning.js";

type Output = Surface | Target;

interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly colors?: OceanColors;
  readonly fps?: number;
  /**
   * Called once for any failure after construction -- init, resize rebuild, or
   * a throw inside the frame loop. Without it those failures rethrow, which in
   * the frame loop means an uncaught error and a hero that silently stops
   * updating. The caller is expected to swap in the fallback background.
   */
  readonly onError?: (error: unknown) => void;
}

type PointerTarget = readonly [number, number, number];

// The lag is intentional: a 30fps hero should feel like the field is drifting
// toward the cursor, not that it is pinned to it.
const POINTER_POSITION_EASING = 0.22;
const POINTER_STRENGTH_EASING = 0.16;

const SIM_FORMAT: GPUTextureFormat = "rgba32float";
const HDR_FORMAT: GPUTextureFormat = "rgba16float";
const TRANSPARENT = [0, 0, 0, 0] as const;

export function createRenderer({
  canvas,
  colors,
  fps,
  onError,
}: RendererOptions) {
  let disposed = false;
  let currentColors: OceanColors = colors ?? DEFAULT_OCEAN_COLORS;
  let pointer: [number, number, number] = [0, 0, 0];
  let pointerTarget: [number, number, number] = [0, 0, 0];
  let loop: FrameLoopHandle | undefined;
  let paused = false;
  let failed = false;
  let rebuilding = false;
  let resizePending = false;
  let releaseErrorListener: (() => void) | undefined;

  // Distinct from `ready`, which only means initialize() returned -- the frame
  // loop is registered by then but has not run. Callers that reveal the canvas
  // need the first drawn frame, or they fade in an empty surface.
  let signalFirstFrame: () => void = () => {};
  let signalFirstFrameFailed: (error: unknown) => void = () => {};
  const firstFrame = new Promise<void>((resolve, reject) => {
    signalFirstFrame = resolve;
    signalFirstFrameFailed = reject;
  });
  // Failure is delivered through onError; this keeps the rejection from
  // surfacing as an unhandled promise when no caller awaits firstFrame.
  firstFrame.catch(() => {});
  let drewOnce = false;
  let gpu: Gpu | undefined;
  let output: Surface | undefined;
  let graph: OceanGraph | undefined;
  let unsubscribeResize: (() => void) | undefined;
  let resizeFrame = 0;
  let resizeGeneration = 0;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    resizeGeneration++;
    runCleanups([
      () => {
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
      },
      () => loop?.stop(),
      () => releaseErrorListener?.(),
      () => unsubscribeResize?.(),
      () => gpu?.dispose(),
    ]);
  }

  function fail(error: unknown): never | void {
    const first = !failed;
    failed = true;
    try {
      dispose();
      // The original failure is rethrown or handed to onError immediately
      // below; a teardown error raised here would replace that real cause.
      // coercion-ok: the caller still receives the failure that started this.
    } catch {
      // coercion-ok: teardown errors must not replace the original renderer failure.
    }
    // Never resolves after a failure: fulfilling it would let a caller fade in
    // a dead canvas at the same moment onError demotes to the fallback.
    if (first) signalFirstFrameFailed(error);
    if (!onError) throw error;
    // Only the first failure is reported: dispose() can cascade, and the
    // caller swaps backgrounds on the first one anyway.
    if (first) onError(error);
  }

  const rebuild = async (generation: number) => {
    if (disposed || !gpu || !output || !graph) return;
    if (sameSize(graph.scene.size, output.size)) return;
    const next = await createGraph(
      gpu,
      output,
      `fft-ocean-resize-${generation}`,
      currentColors,
    );
    if (disposed) return;
    if (generation !== resizeGeneration) {
      try {
        destroyGraph(next);
      } catch {
        // coercion-ok: a newer resize already owns the live graph, so freeing
        // this superseded one is best-effort -- failing wastes GPU memory but
        // cannot corrupt the frame on screen.
      }
      return;
    }
    const previous = graph;
    graph = next;
    destroyGraph(previous);
  };

  const scheduleResize = () => {
    if (disposed) return;
    // A rebuild allocates six 512x512 rgba32float simulation targets plus the
    // HDR and bloom chain. resizeFrame alone does not stop a drag-resize from
    // starting the next one mid-flight, because it is cleared before the await
    // -- so overlapping rebuilds would each pay that cost concurrently and the
    // generation check would only free them afterwards. One at a time, then
    // one more pass for whatever size the drag settled on.
    if (rebuilding) {
      resizePending = true;
      return;
    }
    if (resizeFrame) return;
    const generation = ++resizeGeneration;
    resizeFrame = requestAnimationFrame(async () => {
      resizeFrame = 0;
      rebuilding = true;
      try {
        await rebuild(generation);
      } catch (error) {
        if (!disposed && generation === resizeGeneration) fail(error);
      } finally {
        rebuilding = false;
      }
      if (resizePending && !disposed) {
        resizePending = false;
        scheduleResize();
      }
    });
  };

  const initialize = async () => {
    const { init } = await import("vgpu");
    if (disposed) return;
    const nextGpu = await init();
    if (disposed) {
      nextGpu.dispose();
      return;
    }

    gpu = nextGpu;
    output = surface(gpu, canvas, { dpr: [1, 1.6] });
    const nextGraph = await createGraph(
      gpu,
      output,
      "fft-ocean-live",
      currentColors,
    );
    if (disposed) {
      try {
        destroyGraph(nextGraph);
      } catch {
        // coercion-ok: Cleanup is best-effort after the renderer device is disposed.
      }
      return;
    }
    graph = nextGraph;

    unsubscribeResize = output.onResize(scheduleResize);

    // The frame callback's try/catch only covers what runs inside it. vgpu
    // reports validation failures asynchronously, and a lost device surfaces
    // on the GPUDevice itself -- neither reaches that catch, so without these
    // the hero keeps a frozen ocean mounted and never demotes.
    releaseErrorListener = nextGpu.onError((error) => {
      if (!disposed) fail(error);
    });
    void nextGpu.gpu.lost.then((info) => {
      if (!disposed) fail(new Error(`WebGPU device lost: ${info.reason}`));
    });

    const time = clock(gpu);
    loop = frameLoop(
      gpu,
      (currentFrame) => {
        if (disposed || paused || !graph || !output) return;
        try {
          setDynamics(graph, time.time * OCEAN_TUNING.simulation.timeScale);
          updatePointer(graph.particles, time.time);
          renderGraph(currentFrame, graph, output);
          if (!drewOnce) {
            drewOnce = true;
            signalFirstFrame();
          }
        } catch (error) {
          fail(error);
        }
      },
      fps === undefined ? undefined : { fps },
    );
  };

  const ready = initialize().catch((error: unknown) => {
    if (!disposed) fail(error);
  });

  /**
   * A theme flip must not rebuild the graph: the simulation targets are six
   * 512x512 rgba32float textures and reallocating them stalls the frame the
   * user is watching the toggle in.
   */
  /**
   * Skips frame work while the hero is scrolled out of view. The loop stays
   * registered rather than being stopped and rebuilt, so resuming costs one
   * boolean instead of a device round trip.
   */
  function setPaused(next: boolean): void {
    paused = next;
  }

  function updatePointer(particles: Draw, timeSeconds: number): void {
    pointer[0] += (pointerTarget[0] - pointer[0]) * POINTER_POSITION_EASING;
    pointer[1] += (pointerTarget[1] - pointer[1]) * POINTER_POSITION_EASING;
    pointer[2] += (pointerTarget[2] - pointer[2]) * POINTER_STRENGTH_EASING;
    if (pointer[2] < 0.001 && pointerTarget[2] === 0) pointer[2] = 0;

    particles.set({
      u: { cursor: [pointer[0], pointer[1], pointer[2], timeSeconds] },
    });
  }

  function setPointer(next: PointerTarget): void {
    if (disposed) return;
    pointerTarget = [next[0], next[1], next[2]];
  }

  function setColors(next: OceanColors): void {
    if (disposed) return;
    currentColors = next;
    if (graph) setPresentColors(graph, next);
  }

  return { ready, firstFrame, dispose, setColors, setPaused, setPointer };
}

export type OceanRenderer = ReturnType<typeof createRenderer>;

export async function createGraph(
  gpu: Gpu,
  output: Output,
  label: string,
  colors: OceanColors = DEFAULT_OCEAN_COLORS,
): Promise<OceanGraph> {
  const ownedTargets: Target[] = [];
  try {
    const graph = buildGraph(gpu, output, label, colors, (value) => {
      ownedTargets.push(value);
      return value;
    });
    await prewarm(graph, output);
    return graph;
  } catch (error) {
    try {
      destroyTargets(ownedTargets);
    } catch {
      // Partial-allocation cleanup must not replace the construction failure.
    }
    throw error;
  }
}

function buildGraph(
  gpu: Gpu,
  output: Output,
  label: string,
  colors: OceanColors,
  own: (value: Target) => Target,
) {
  const resolution = OCEAN_RESOLUTION;
  const createTarget = (
    name: string,
    size: readonly [number, number],
    format: GPUTextureFormat,
  ) => own(target(gpu, { size, format, label: `${label}-${name}` }));
  const simulationTarget = (name: string) =>
    createTarget(name, [resolution, resolution], SIM_FORMAT);
  const simulation = {
    noise: simulationTarget("noise"),
    h0: simulationTarget("h0"),
    spectrum: simulationTarget("spectrum"),
    ping: simulationTarget("ping"),
    pong: simulationTarget("pong"),
    normalFoam: simulationTarget("normal-foam"),
  };
  const sizes = bloomSizes(output.size);
  const scene = createTarget("scene", normalizedSize(output.size), HDR_FORMAT);
  const bright = createTarget("bright", sizes[0]!, HDR_FORMAT);
  const composite = createTarget("composite", sizes[0]!, HDR_FORMAT);
  const linearSampler = sampler(gpu, {
    // rgba16float is only linearly filterable with the optional WebGPU feature.
    // Nearest keeps the same pipeline valid on capable devices that omit it.
    minFilter: gpu.device.features.has("float16-filterable")
      ? "linear"
      : "nearest",
    magFilter: gpu.device.features.has("float16-filterable")
      ? "linear"
      : "nearest",
  });

  const noiseEffect = configuredEffect(gpu, noiseWgsl, `${label}-noise`);
  const initialSpectrum = configuredEffect(
    gpu,
    initialSpectrumWgsl,
    `${label}-initial-spectrum`,
    {
      u: {
        resolution,
        size: OCEAN_TUNING.simulation.oceanSize,
        windSpeed: OCEAN_TUNING.simulation.windSpeed,
        windAngle: OCEAN_TUNING.simulation.windAngle,
        amplitude: OCEAN_TUNING.simulation.amplitude,
      },
      u_noise: simulation.noise,
    },
  );
  const evolveSpectrum = configuredEffect(
    gpu,
    spectrumWgsl,
    `${label}-spectrum`,
    {
      u: {
        resolution,
        size: OCEAN_TUNING.simulation.oceanSize,
        time: 0,
        choppiness: OCEAN_TUNING.simulation.choppiness,
      },
      u_initialSpectrum: simulation.h0,
    },
  );

  const simulationTargets: Record<SimulationTargetName, Target> = {
    spectrum: simulation.spectrum,
    ping: simulation.ping,
    pong: simulation.pong,
  };
  const ifft = createIfftStageTable().map((spec: IfftStage) => ({
    spec,
    effect: configuredEffect(
      gpu,
      ifftStageWgsl,
      `${label}-ifft-${spec.index}-${spec.horizontal ? "h" : "v"}`,
      {
        u: {
          resolution,
          subtransformSize: spec.subtransformSize,
          horizontal: spec.horizontal ? 1 : 0,
        },
        u_input: simulationTargets[spec.input],
      },
    ),
    output: simulationTargets[spec.output],
  }));
  const displacement = ifft[ifft.length - 1]!.output;
  const normals = configuredEffect(
    gpu,
    normalFoamWgsl,
    `${label}-normal-foam`,
    {
      u: {
        resolution,
        worldSize: OCEAN_TUNING.simulation.worldSize,
        displacementScale: OCEAN_TUNING.simulation.displacementScale,
        foamThreshold: OCEAN_TUNING.simulation.foamThreshold,
      },
      u_displacement: displacement,
    },
  );
  const particles = draw(gpu, {
    shader: particlesWgsl,
    vertices: 6,
    instances: resolution * resolution,
    blend: {
      color: { src: "src-alpha", dst: "one" },
      alpha: { src: "one", dst: "one" },
    },
    label: `${label}-particles`,
  }).set({
    u_displacement: displacement,
    u_normalFoam: simulation.normalFoam,
  });
  setParticleConstants(particles, output);
  const brightEffect = configuredEffect(
    gpu,
    bloomBrightWgsl,
    `${label}-bloom-bright`,
    {
      uniforms: {
        luminosityThreshold: OCEAN_TUNING.bloom.threshold,
        smoothWidth: OCEAN_TUNING.bloom.smoothWidth,
      },
      tDiffuse: scene,
      linearSampler,
    },
  );

  let bloomInput = bright;
  const levels = sizes.map((size, index) => {
    const horizontal = createTarget(`bloom-h${index}`, size, HDR_FORMAT);
    const vertical = createTarget(`bloom-v${index}`, size, HDR_FORMAT);
    const radius = OCEAN_TUNING.bloom.kernelRadii[index]!;
    const horizontalEffect = makeBlur(
      gpu,
      `${label}-blur-h${index}`,
      bloomInput,
      horizontal,
      linearSampler,
      [1, 0],
      radius,
    );
    const verticalEffect = makeBlur(
      gpu,
      `${label}-blur-v${index}`,
      horizontal,
      vertical,
      linearSampler,
      [0, 1],
      radius,
    );
    bloomInput = vertical;
    return { horizontal, vertical, horizontalEffect, verticalEffect };
  });
  const compositeEffect = configuredEffect(
    gpu,
    bloomCompositeWgsl,
    `${label}-bloom-composite`,
    {
      uniforms: {
        bloomStrength: OCEAN_TUNING.bloom.strength,
        bloomRadius: OCEAN_TUNING.bloom.radius,
        bloomFactors0: [1, 0.8, 0.6, 0.4],
        bloomFactors1: [0.2, 0, 0, 0],
      },
      blurTexture1: levels[0]!.vertical,
      blurTexture2: levels[1]!.vertical,
      blurTexture3: levels[2]!.vertical,
      blurTexture4: levels[3]!.vertical,
      blurTexture5: levels[4]!.vertical,
      linearSampler,
    },
  );
  const present = configuredEffect(gpu, presentWgsl, `${label}-present`, {
    uniforms: presentUniforms(colors),
    sceneHDR: scene,
    bloomTexture: composite,
    linearSampler,
  });
  return {
    simulation,
    scene,
    bloom: { bright, composite, levels },
    effects: {
      noise: noiseEffect,
      initialSpectrum,
      evolveSpectrum,
      normals,
      bright: brightEffect,
      composite: compositeEffect,
      present,
    },
    ifft,
    particles,
    needsInitialSpectrum: true,
  };
}

export type OceanGraph = ReturnType<typeof buildGraph>;

function configuredEffect(
  gpu: Gpu,
  shader: string | ShaderSource,
  label: string,
  bindings?: Record<string, unknown>,
): Effect {
  const configured = effect(gpu, shader, { label });
  return bindings ? configured.set(bindings) : configured;
}

function makeBlur(
  gpu: Gpu,
  label: string,
  source: Target,
  output: Target,
  linearSampler: GPUSampler,
  direction: readonly [number, number],
  kernelRadius: number,
): Effect {
  const blur = effect(gpu, bloomBlurWgsl, { label });
  const coefficients = gaussianCoefficients(kernelRadius);
  blur.set({
    uniforms: {
      direction,
      invSize: output.texelSize,
      gaussianCoefficients0: coefficients.slice(0, 4),
      gaussianCoefficients1: coefficients.slice(4, 8),
      gaussianCoefficients2: coefficients.slice(8, 12),
      gaussianCoefficients3: coefficients.slice(12, 16),
      gaussianCoefficients4: coefficients.slice(16, 20),
      gaussianCoefficients5: coefficients.slice(20, 24),
    },
    colorTexture: source,
    linearSampler,
  });
  return blur;
}

async function prewarm(graph: OceanGraph, output: Output): Promise<void> {
  const results = await Promise.allSettled([
    graph.effects.noise.compile(graph.simulation.noise),
    graph.effects.initialSpectrum.compile(graph.simulation.h0),
    graph.effects.evolveSpectrum.compile(graph.simulation.spectrum),
    ...graph.ifft.map(({ effect, output }) => effect.compile(output)),
    graph.effects.normals.compile(graph.simulation.normalFoam),
    graph.particles.compile(graph.scene),
    graph.effects.bright.compile(graph.bloom.bright),
    ...graph.bloom.levels.flatMap((level) => [
      level.horizontalEffect.compile(level.horizontal),
      level.verticalEffect.compile(level.vertical),
    ]),
    graph.effects.composite.compile(graph.bloom.composite),
    graph.effects.present.compile({ colors: [output.format] }),
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}

function presentUniforms(colors: OceanColors) {
  return {
    fgColor: [...colors.fg, 1] as const,
    bgColor: [...colors.bg, 1] as const,
    brightness: OCEAN_TUNING.present.brightness,
  };
}

/** Retunes the present pass in place. Allocates nothing. */
export function setPresentColors(graph: OceanGraph, colors: OceanColors): void {
  graph.effects.present.set({ uniforms: presentUniforms(colors) });
}

function setDynamics(graph: OceanGraph, timeSeconds: number): void {
  graph.effects.evolveSpectrum.set({
    u: { time: timeSeconds * OCEAN_TUNING.simulation.spectrumTimeScale },
  });
}

function setParticleConstants(particles: Draw, output: Output): void {
  const camera = oceanCamera(output.size);
  const tuning = OCEAN_TUNING;
  particles.set({
    u: {
      view: camera.view,
      projection: camera.projection,
      viewport: [output.size[0], output.size[1], 1, OCEAN_RESOLUTION],
      world: [
        tuning.simulation.worldSize,
        tuning.simulation.displacementScale,
        tuning.particles.pointSize,
        0,
      ],
      fade: [
        tuning.particles.fadeNear,
        tuning.particles.fadeFar,
        tuning.particles.fadePower,
        0,
      ],
      oceanColor: tuning.particles.oceanColor,
      neonColor: tuning.particles.neonColor,
      foamColor: tuning.particles.foamColor,
      cursor: [0, 0, 0, 0],
    },
  });
}

export function renderAt(
  gpu: Gpu,
  graph: OceanGraph,
  output: Target,
  time: number,
): void {
  setDynamics(graph, time);
  frame(gpu, (currentFrame) => renderGraph(currentFrame, graph, output));
}

export function renderGraph(
  currentFrame: Frame,
  graph: OceanGraph,
  output: Output,
): void {
  const pass = (target: Output, drawable: Draw | Effect) =>
    currentFrame.pass({ target, clear: TRANSPARENT }, (encoder) =>
      encoder.draw(drawable),
    );
  if (graph.needsInitialSpectrum) {
    pass(graph.simulation.noise, graph.effects.noise);
    pass(graph.simulation.h0, graph.effects.initialSpectrum);
    graph.needsInitialSpectrum = false;
  }
  pass(graph.simulation.spectrum, graph.effects.evolveSpectrum);
  for (const stage of graph.ifft) {
    pass(stage.output, stage.effect);
  }
  pass(graph.simulation.normalFoam, graph.effects.normals);
  pass(graph.scene, graph.particles);
  pass(graph.bloom.bright, graph.effects.bright);
  for (const level of graph.bloom.levels) {
    pass(level.horizontal, level.horizontalEffect);
    pass(level.vertical, level.verticalEffect);
  }
  pass(graph.bloom.composite, graph.effects.composite);
  pass(output, graph.effects.present);
}

export function bloomSizes(
  size: readonly [number, number],
): [number, number][] {
  let width = Math.max(1, Math.round(size[0] / 2));
  let height = Math.max(1, Math.round(size[1] / 2));
  return Array.from({ length: OCEAN_TUNING.bloom.levels }, () => {
    const level: [number, number] = [width, height];
    width = Math.max(1, Math.round(width / 2));
    height = Math.max(1, Math.round(height / 2));
    return level;
  });
}

export function destroyGraph(graph: OceanGraph): void {
  destroyTargets([
    ...Object.values(graph.simulation),
    graph.scene,
    graph.bloom.bright,
    graph.bloom.composite,
    ...graph.bloom.levels.flatMap((level) => [
      level.horizontal,
      level.vertical,
    ]),
  ]);
}

function destroyTargets(targets: readonly Target[]): void {
  runCleanups(
    [...targets].reverse().map((value) => () => value.color.destroy()),
  );
}

function runCleanups(cleanups: readonly (() => void)[]): void {
  let firstError: unknown;
  let failed = false;
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}

function normalizedSize(size: readonly [number, number]): [number, number] {
  return [Math.max(1, Math.floor(size[0])), Math.max(1, Math.floor(size[1]))];
}

function sameSize(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
