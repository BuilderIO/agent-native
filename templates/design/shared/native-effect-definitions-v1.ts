import type { EffectDefinition } from "./native-effects";

// v1 is retained for documents authored before typed resource metadata and palette alpha.
export const NATIVE_EFFECT_DEFINITIONS_V1 = [
  {
    id: "an-native-grain-gradient",
    name: "Orange Cream Grain Gradient",
    version: 1,
    kind: "generator",
    placements: ["fill"],
    properties: {
      orange: {
        type: "color",
        label: "Orange",
        default: {
          space: "srgb",
          components: [1, 0.32, 0.08],
          alpha: 1,
        },
      },
      cream: {
        type: "color",
        label: "Cream",
        default: {
          space: "srgb",
          components: [1, 0.91, 0.72],
          alpha: 1,
        },
      },
      scale: {
        type: "float",
        label: "Scale",
        default: 1,
        min: 0.25,
        max: 4,
        step: 0.01,
      },
      movement: {
        type: "float",
        label: "Movement",
        default: 0.35,
        min: 0,
        max: 2,
        step: 0.01,
      },
      grain: {
        type: "float",
        label: "Grain",
        default: 0.065,
        min: 0,
        max: 0.3,
        step: 0.001,
      },
    },
    passes: [
      {
        id: "gradient",
        kind: "render",
        reads: [],
        output: "color",
        wgsl: "\nstruct Globals {\n  viewport: vec4f,\n  clock: vec4f,\n  params: array<vec4f, 32>,\n};\n@group(0) @binding(0) var<uniform> globals: Globals;\n@group(0) @binding(1) var effectSampler: sampler;\n@group(0) @binding(2) var sourceTexture: texture_2d<f32>;\n@group(0) @binding(3) var maskTexture: texture_2d<f32>;\nstruct VertexOutput {\n  @builtin(position) position: vec4f,\n  @location(0) uv: vec2f,\n};\n@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {\n  let coordinates = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n  var output: VertexOutput;\n  output.position = vec4f(coordinates[vertexIndex], 0.0, 1.0);\n  output.uv = coordinates[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);\n  return output;\n}\n\nfn hash(pixel: vec2f) -> f32 {\n  return fract(sin(dot(pixel, vec2f(127.1, 311.7))) * 43758.5453);\n}\n@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {\n  let uv = input.uv;\n  let phase = globals.clock.x * globals.params[3].x;\n  let p = (uv - vec2f(0.5)) * globals.params[2].x;\n  let wave = 0.5 + 0.5 * sin(p.x * 4.0 + p.y * 3.5 + phase + sin(p.y * 5.0 - phase * 0.7));\n  let bloom = exp(-dot(p - vec2f(0.2 * sin(phase), 0.1 * cos(phase)), p - vec2f(0.2 * sin(phase), 0.1 * cos(phase))) * 2.6);\n  let blend = clamp(wave * 0.52 + bloom * 0.36, 0.0, 1.0);\n  var color = mix(globals.params[0].rgb, globals.params[1].rgb, blend);\n  let noise = hash(floor(uv * globals.viewport.xy) + vec2f(globals.clock.x * 23.0, globals.clock.y));\n  color += (noise - 0.5) * globals.params[4].x;\n  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);\n}\n",
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original Design native WGSL material",
    },
  },
  {
    id: "an-native-halftone",
    name: "Halftone",
    version: 1,
    kind: "processor",
    placements: ["layer"],
    properties: {
      cellSize: {
        type: "float",
        label: "Dot size",
        default: 8,
        min: 2,
        max: 36,
        step: 0.1,
        unit: "px",
      },
      angle: {
        type: "float",
        label: "Angle",
        default: 0.4,
        min: -3.14,
        max: 3.14,
        step: 0.01,
        unit: "rad",
      },
      contrast: {
        type: "float",
        label: "Contrast",
        default: 1,
        min: 0.1,
        max: 3,
        step: 0.01,
      },
      ink: {
        type: "color",
        label: "Ink",
        default: {
          space: "srgb",
          components: [0.08, 0.06, 0.07],
          alpha: 1,
        },
      },
      paper: {
        type: "color",
        label: "Paper",
        default: {
          space: "srgb",
          components: [1, 0.96, 0.85],
          alpha: 1,
        },
      },
    },
    passes: [
      {
        id: "halftone",
        kind: "render",
        reads: ["source"],
        output: "color",
        wgsl: "\nstruct Globals {\n  viewport: vec4f,\n  clock: vec4f,\n  params: array<vec4f, 32>,\n};\n@group(0) @binding(0) var<uniform> globals: Globals;\n@group(0) @binding(1) var effectSampler: sampler;\n@group(0) @binding(2) var sourceTexture: texture_2d<f32>;\n@group(0) @binding(3) var maskTexture: texture_2d<f32>;\nstruct VertexOutput {\n  @builtin(position) position: vec4f,\n  @location(0) uv: vec2f,\n};\n@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {\n  let coordinates = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n  var output: VertexOutput;\n  output.position = vec4f(coordinates[vertexIndex], 0.0, 1.0);\n  output.uv = coordinates[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);\n  return output;\n}\n\n@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {\n  let pixel = input.uv * globals.viewport.xy;\n  let angle = globals.params[1].x;\n  let rotated = vec2f(pixel.x * cos(angle) - pixel.y * sin(angle), pixel.x * sin(angle) + pixel.y * cos(angle));\n  let cell = max(globals.params[0].x, 1.0);\n  let center = (floor(rotated / cell) + vec2f(0.5)) * cell;\n  let samplePixel = vec2f(center.x * cos(angle) + center.y * sin(angle), -center.x * sin(angle) + center.y * cos(angle));\n  let sampled = textureSample(sourceTexture, effectSampler, clamp(samplePixel * globals.viewport.zw, vec2f(0.0), vec2f(1.0)));\n  let straightColor = select(vec3f(0.0), sampled.rgb / max(sampled.a, 0.00001), sampled.a > 0.0);\n  let luminance = dot(straightColor, vec3f(0.2126, 0.7152, 0.0722));\n  let amount = clamp((1.0 - luminance) * globals.params[2].x, 0.0, 1.0);\n  let radius = sqrt(amount) * cell * 0.47;\n  let coverage = 1.0 - smoothstep(radius - 0.75, radius + 0.75, length(rotated - center));\n  let color = mix(globals.params[4].rgb, globals.params[3].rgb, coverage);\n  return vec4f(color * sampled.a, sampled.a);\n}\n",
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original Design source-processing WGSL",
    },
  },
  {
    id: "an-native-frosted-refraction",
    name: "Frosted Refraction",
    version: 1,
    kind: "processor",
    placements: ["backdrop", "layer"],
    properties: {
      blur: {
        type: "float",
        label: "Frost",
        default: 5,
        min: 0,
        max: 20,
        step: 0.1,
        unit: "px",
      },
      distortion: {
        type: "float",
        label: "Refraction",
        default: 7,
        min: 0,
        max: 30,
        step: 0.1,
        unit: "px",
      },
      movement: {
        type: "float",
        label: "Movement",
        default: 0.25,
        min: 0,
        max: 2,
        step: 0.01,
      },
      tint: {
        type: "color",
        label: "Tint",
        default: {
          space: "srgb",
          components: [0.95, 0.98, 1],
          alpha: 0.18,
        },
      },
    },
    passes: [
      {
        id: "refraction",
        kind: "render",
        reads: ["source"],
        output: "color",
        wgsl: "\nstruct Globals {\n  viewport: vec4f,\n  clock: vec4f,\n  params: array<vec4f, 32>,\n};\n@group(0) @binding(0) var<uniform> globals: Globals;\n@group(0) @binding(1) var effectSampler: sampler;\n@group(0) @binding(2) var sourceTexture: texture_2d<f32>;\n@group(0) @binding(3) var maskTexture: texture_2d<f32>;\nstruct VertexOutput {\n  @builtin(position) position: vec4f,\n  @location(0) uv: vec2f,\n};\n@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {\n  let coordinates = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n  var output: VertexOutput;\n  output.position = vec4f(coordinates[vertexIndex], 0.0, 1.0);\n  output.uv = coordinates[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);\n  return output;\n}\n\n@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {\n  let uv = input.uv;\n  let phase = globals.clock.x * globals.params[2].x;\n  let ripple = vec2f(sin(uv.y * 31.0 + phase), cos(uv.x * 27.0 - phase * 0.8));\n  let shifted = uv + ripple * globals.params[1].x * globals.viewport.zw;\n  let step = globals.params[0].x * globals.viewport.zw * 0.35;\n  var color = vec4f(0.0);\n  for (var x = -1; x <= 1; x = x + 1) {\n    for (var y = -1; y <= 1; y = y + 1) {\n      color += textureSample(sourceTexture, effectSampler, clamp(shifted + vec2f(f32(x), f32(y)) * step, vec2f(0.0), vec2f(1.0)));\n    }\n  }\n  color /= 9.0;\n  let tinted = mix(color.rgb, globals.params[3].rgb * color.a, globals.params[3].a);\n  return vec4f(tinted, color.a);\n}\n",
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original Design backdrop/source-processing WGSL",
    },
  },
] as unknown as readonly EffectDefinition[];
