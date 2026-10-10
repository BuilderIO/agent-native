import {
  catalogFloat as float,
  catalogPalette,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
} from "./native-effects";

const motion = (speed = 0.3): Record<string, EffectProperty> => ({
  palette: catalogPalette(),
  scale: float("Scale", 1, 0.2, 4),
  speed: float("Speed", speed, 0, 2),
  density: float("Density", 7, 1, 24),
  softness: float("Softness", 0.1, 0.005, 0.5),
});

const field = (p: (name: string) => string) => `
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let q = (input.uv - 0.5) * vec2f(aspect, 1.0) * ${p("scale")}.x;
  let t = globals.clock.x * ${p("speed")}.x;
  let density = ${p("density")}.x;
  let soft = ${p("softness")}.x;
`;

const visualSpecs: CatalogShaderSpec[] = [
  {
    id: "curl-streamlines",
    name: "Curl Streamlines",
    kind: "generator",
    properties: motion(),
    fragment: (p) =>
      field(p) +
      `
  var position = q;
  var ink = 0.0;
  for (var step = 0u; step < 12u; step += 1u) {
    let a = sin(position.y * density + t) + cos(position.x * density * 0.7 - t);
    let velocity = vec2f(cos(a), sin(a)) * 0.018;
    position += velocity;
    ink += exp(-abs(sin(position.x * density * 1.8 - position.y * density * 0.9)) / max(soft, 0.005));
  }
  return paletteAt(clamp(ink / 8.0, 0.0, 1.0));
`,
  },
  {
    id: "eddy-rings",
    name: "Eddy Rings",
    kind: "generator",
    properties: motion(0.22),
    fragment: (p) =>
      field(p) +
      `
  var ring = 0.0;
  for (var i = 0u; i < 5u; i += 1u) {
    let angle = f32(i) * 2.399963 + t * (0.2 + f32(i) * 0.06);
    let center = vec2f(cos(angle), sin(angle)) * (0.12 + f32(i) * 0.055);
    let d = q - center;
    let theta = atan2(d.y, d.x) + t * (0.4 + f32(i) * 0.08);
    let radius = length(d) + 0.025 * sin(theta * density);
    ring += exp(-abs(radius - (0.12 + f32(i) * 0.025)) / max(soft * 0.15, 0.002));
  }
  return paletteAt(clamp(ring * 0.27, 0.0, 1.0));
`,
  },
  {
    id: "reaction-islands",
    name: "Reaction Islands",
    kind: "generator",
    properties: motion(0.1),
    fragment: (p) =>
      field(p) +
      `
  let cell = vec2i(floor(q * density * 2.0));
  let local = fract(q * density * 2.0) - 0.5;
  var activator = 0.0;
  var inhibitor = 0.0;
  for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) {
    let site = cell + vec2i(x, y);
    let jitter = vec2f(random(site), random(site + vec2i(47, 83))) - 0.5;
    let delta = local - vec2f(f32(x), f32(y)) - jitter * 0.6;
    let radius2 = dot(delta, delta);
    activator += exp(-radius2 * (20.0 + 4.0 * sin(t + jitter.x * 6.0)));
    inhibitor += exp(-radius2 * 3.0);
  }}
  let edge = smoothstep(-soft, soft, activator - inhibitor * 0.34);
  return paletteAt(edge);
`,
  },
  {
    id: "firefly-drift",
    name: "Firefly Drift",
    version: 2,
    kind: "generator",
    properties: motion(0.45),
    fragment: (p) =>
      field(p) +
      `
  let world = q * density;
  let cell = vec2i(floor(world));
  let local = fract(world);
  var glow = 0.0;
  for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) {
    let id = cell + vec2i(x, y);
    let phase = random(id + vec2i(13, 31)) * 6.283185;
    var center = vec2f(f32(x), f32(y)) + vec2f(random(id), random(id + vec2i(67, 19)));
    center += vec2f(sin(t + phase), cos(t * 0.73 + phase)) * 0.22;
    let radius2 = dot(local - center, local - center);
    let pulse = 0.5 + 0.5 * sin(t * 2.0 + phase);
    glow += exp(-radius2 / max(soft * soft * 0.25, 0.0001)) * pulse;
  }}
  return paletteAt(clamp(glow * 0.75, 0.0, 1.0));
`,
  },
  {
    id: "ink-advection",
    name: "Ink Advection",
    kind: "generator",
    properties: motion(0.2),
    fragment: (p) =>
      field(p) +
      `
  var position = q;
  for (var i = 0u; i < 8u; i += 1u) {
    let spin = vec2f(-position.y, position.x) / (0.15 + dot(position, position));
    let shear = vec2f(sin(position.y * density + t), cos(position.x * density - t));
    position -= (spin * 0.012 + shear * 0.008) * (1.0 + f32(i) * 0.03);
  }
  let pigment = fractalNoise(position * density + vec2f(t * 0.15, -t * 0.09));
  let basin = smoothstep(0.25 - soft, 0.75 + soft, pigment);
  return paletteAt(basin);
`,
  },
  {
    id: "magnetic-filaments",
    name: "Magnetic Filaments",
    kind: "generator",
    properties: motion(0.18),
    fragment: (p) =>
      field(p) +
      `
  let poleA = vec2f(-0.22, 0.12 * sin(t));
  let poleB = vec2f(0.25, -0.12 * cos(t));
  let da = q - poleA;
  let db = q - poleB;
  let angle = atan2(da.y, da.x) - atan2(db.y, db.x);
  let potential = log(max(length(da), 0.001)) - log(max(length(db), 0.001));
  let filaments = abs(sin(angle * density + potential * 3.0));
  return paletteAt(1.0 - smoothstep(0.0, soft * 2.0, filaments));
`,
  },
  {
    id: "cellular-bloom",
    name: "Cellular Bloom",
    kind: "generator",
    properties: motion(0.16),
    fragment: (p) =>
      field(p) +
      `
  let world = q * density;
  let cell = vec2i(floor(world));
  let local = fract(world);
  var bloom = 0.0;
  for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) {
    let id = cell + vec2i(x, y);
    let seed = random(id);
    let center = vec2f(f32(x), f32(y)) + vec2f(random(id + vec2i(3, 41)), random(id + vec2i(29, 7)));
    let age = fract(t * 0.13 + seed);
    let front = age * 0.72;
    bloom = max(bloom, 1.0 - smoothstep(front - soft, front + soft, length(local - center)));
  }}
  return paletteAt(clamp(bloom, 0.0, 1.0));
`,
  },
  {
    id: "plasma-sheets",
    name: "Plasma Sheets",
    kind: "generator",
    properties: motion(0.38),
    fragment: (p) =>
      field(p) +
      `
  var sheet = 0.0;
  for (var i = 0u; i < 6u; i += 1u) {
    let depth = 1.0 + f32(i) * 0.34;
    let wave = q * density * depth;
    let fold = wave.y + sin(wave.x * 1.3 + t * depth) * 0.35;
    let distance = abs(sin(fold + cos(wave.x * 0.4 - t) * 0.5));
    sheet += exp(-distance / max(soft * 0.4, 0.002)) / depth;
  }
  return paletteAt(clamp(sheet * 0.35, 0.0, 1.0));
`,
  },
];

const sourceResource = {
  name: "source",
  kind: "texture-2d" as const,
  usage: ["sampled" as const],
  external: true,
  size: "viewport" as const,
};
const renderResource = (name: string) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float" as const,
  usage: ["render" as const, "sampled" as const],
  size: "viewport" as const,
});
const edge = (): EffectProperty => ({
  type: "enum",
  label: "Edges",
  default: "clamp",
  options: ["transparent", "clamp"],
  advanced: true,
});
const provenance: EffectDefinition["provenance"] = {
  origin: "design-original",
  note: "Original Design shader material with bounded native render passes and linear premultiplied output.",
};

const flowGlass: EffectDefinition = {
  id: "an-native-flow-glass",
  name: "Flow Glass",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    amount: float("Amount", 0.65, 0, 1),
    distortion: float("Distortion", 9, 0, 30, 0.1),
    frequency: float("Frequency", 6, 1, 20),
    speed: float("Speed", 0.25, 0, 2),
    edge: edge(),
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    sourceResource,
    renderResource("refracted"),
    renderResource("color"),
  ],
  output: "color",
  provenance,
  passes: [
    {
      id: "refract",
      kind: "render",
      reads: ["source"],
      output: "refracted",
      wgsl:
        NATIVE_RENDER_GLOBALS +
        `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let phase = globals.clock.x * globals.params[3].x;
  let frequency = globals.params[2].x;
  let wave = vec2f(
    sin(uv.y * frequency * 6.283185 + phase + sin(uv.x * frequency)),
    cos(uv.x * frequency * 6.283185 - phase + cos(uv.y * frequency))
  );
  let shifted = uv + wave * globals.params[1].x * globals.clock.z * globals.viewport.zw;
  if (u32(globals.params[4].x) == 0u && (any(shifted < vec2f(0.0)) || any(shifted > vec2f(1.0)))) { return vec4f(0.0); }
  return textureSampleLevel(sourceTexture, effectSampler, clamp(shifted, vec2f(0.0), vec2f(1.0)), 0.0);
}
`,
    },
    {
      id: "mix",
      kind: "render",
      reads: ["source", "refracted"],
      output: "color",
      wgsl:
        NATIVE_RENDER_GLOBALS +
        `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let refracted = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  return mix(original, refracted, globals.params[0].x);
}
`,
    },
  ],
};

const wakeEcho: EffectDefinition = {
  id: "an-native-wake-echo",
  name: "Wake Echo",
  version: 1,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    amount: float("Amount", 0.5, 0, 1),
    spread: float("Spread", 8, 0, 24, 0.1),
    direction: float("Direction", 0.7, -3.14, 3.14),
    speed: float("Speed", 0.2, 0, 2),
    edge: edge(),
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [sourceResource, renderResource("wake"), renderResource("color")],
  output: "color",
  provenance,
  passes: [
    {
      id: "wake",
      kind: "render",
      reads: ["source"],
      output: "wake",
      wgsl:
        NATIVE_RENDER_GLOBALS +
        `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let direction = vec2f(cos(globals.params[2].x), sin(globals.params[2].x));
  let displacement = globals.params[1].x * globals.clock.z * globals.viewport.zw;
  let phase = globals.clock.x * globals.params[3].x;
  var sum = vec4f(0.0);
  for (var i = 0u; i < 8u; i += 1u) {
    let distance = (f32(i) + 0.5) / 8.0;
    let bend = sin(phase - distance * 6.283185) * 0.25;
    let offset = direction * displacement * distance + vec2f(-direction.y, direction.x) * displacement * bend;
    let uv = input.uv - offset;
    if (u32(globals.params[4].x) == 0u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { continue; }
    sum += textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0) / 8.0;
  }
  return sum;
}
`,
    },
    {
      id: "mix",
      kind: "render",
      reads: ["source", "wake"],
      output: "color",
      wgsl:
        NATIVE_RENDER_GLOBALS +
        `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let original = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let wake = textureSampleLevel(maskTexture, effectSampler, input.uv, 0.0);
  return mix(original, wake, globals.params[0].x);
}
`,
    },
  ],
};

export const DESIGN_OWNED_DYNAMICS_DEFINITIONS: readonly EffectDefinition[] = [
  ...visualSpecs.map(catalogShader),
  flowGlass,
  wakeEcho,
];

export const DESIGN_OWNED_DYNAMICS_PRESETS: readonly EffectPreset[] =
  DESIGN_OWNED_DYNAMICS_DEFINITIONS.map((definition) => ({
    id: `${definition.id}:default`,
    name: definition.name,
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement: definition.kind === "generator" ? "fill" : "layer",
    params: {},
    clip: "bounds",
    provenance: { origin: "design-original" },
  }));

const feedbackComputeHeader = `
struct Params {
  time: f32, dt: f32, seed: f32, intensity: f32,
  blockSize: f32, drift: f32, churn: f32, padding: f32,
};
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var priorTexture: texture_2d<f32>;
@group(0) @binding(2) var nextTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var displayTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: Params;

fn sourceAt(cell: vec2i) -> vec4f {
  let dimensions = vec2f(textureDimensions(sourceTexture));
  let uv = (vec2f(cell) + 0.5) / vec2f(768.0);
  let sourceCell = vec2i(clamp(floor(uv * dimensions), vec2f(0.0), dimensions - 1.0));
  return textureLoad(sourceTexture, sourceCell, 0);
}
fn priorAt(cell: vec2i) -> vec4f {
  return textureLoad(priorTexture, clamp(cell, vec2i(0), vec2i(767)), 0);
}
`;

const feedbackResolve = `
struct Resolve { blend: f32, padding: vec3f };
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var displayTexture: texture_2d<f32>;
@group(0) @binding(2) var linearClamp: sampler;
@group(0) @binding(3) var<uniform> resolve: Resolve;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let xy = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var result: VertexOut;
  result.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  result.uv = vec2f(xy.x, 1.0 - xy.y);
  return result;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let live = textureSampleLevel(sourceTexture, linearClamp, input.uv, 0.0);
  let memory = textureSampleLevel(displayTexture, linearClamp, input.uv, 0.0);
  return mix(live, memory, resolve.blend);
}
`;

export const DESIGN_OWNED_FEEDBACK_KERNELS = {
  dyeTransport:
    feedbackComputeHeader +
    `
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 768u || invocation.y >= 768u) { return; }
  let cell = vec2i(invocation.xy);
  let uv = (vec2f(cell) + 0.5) / 768.0;
  let angle = sin(uv.y * params.blockSize * 0.07 + params.time * 0.3 + params.seed) * 2.0
    + cos(uv.x * params.blockSize * 0.05 - params.time * 0.2);
  let velocity = vec2f(cos(angle), sin(angle)) * params.drift * params.dt * 90.0;
  let origin = vec2i(clamp(round(vec2f(cell) - velocity), vec2f(0.0), vec2f(767.0)));
  let fresh = sourceAt(cell);
  let previous = priorAt(origin);
  let initial = previous.a <= 0.0;
  let carried = select(previous, fresh, initial);
  let injection = clamp(params.churn * params.dt * 8.0, 0.0, 1.0);
  let dye = mix(carried, fresh, injection);
  let output = mix(fresh, dye, params.intensity);
  textureStore(nextTexture, cell, dye);
  textureStore(displayTexture, cell, output);
}
`,
  reactionField:
    feedbackComputeHeader +
    `
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 768u || invocation.y >= 768u) { return; }
  let cell = vec2i(invocation.xy);
  let fresh = sourceAt(cell);
  let previous = priorAt(cell);
  let uv = (vec2f(cell) + 0.5) / 768.0;
  let emergence = 0.5 + 0.5 * sin((uv.x + params.seed * 0.01) * 35.0) * cos((uv.y - params.seed * 0.02) * 31.0);
  let seed = clamp(dot(fresh.rgb, vec3f(0.2126, 0.7152, 0.0722)) * emergence * params.intensity, 0.0, 1.0);
  let initial = previous.a <= 0.0;
  let u = select(previous.r, 1.0, initial);
  let v = select(previous.g, seed, initial);
  let north = priorAt(cell + vec2i(0, -1));
  let south = priorAt(cell + vec2i(0, 1));
  let west = priorAt(cell + vec2i(-1, 0));
  let east = priorAt(cell + vec2i(1, 0));
  let neighborU = select(north.r + south.r + west.r + east.r, 4.0, initial);
  let neighborV = select(north.g + south.g + west.g + east.g, seed * 4.0, initial);
  let lapU = neighborU - 4.0 * u;
  let lapV = neighborV - 4.0 * v;
  let reaction = u * v * v;
  let feed = 0.015 + params.churn * 0.06;
  let removal = 0.035 + params.blockSize / 6000.0;
  let nextU = clamp(u + params.dt * 22.0 * (params.drift * lapU - reaction + feed * (1.0 - u)), 0.0, 1.0);
  let nextV = clamp(v + params.dt * 22.0 * (0.45 * params.drift * lapV + reaction - (feed + removal) * v), 0.0, 1.0);
  let state = vec4f(nextU, nextV, 0.0, 1.0);
  let pigment = vec3f(nextV, nextV * nextV * 0.45, (1.0 - nextU) * 0.8);
  let display = vec4f(mix(fresh.rgb, pigment * fresh.a, params.intensity), fresh.a);
  textureStore(nextTexture, cell, state);
  textureStore(displayTexture, cell, display);
}
`,
  waveMemory:
    feedbackComputeHeader +
    `
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= 768u || invocation.y >= 768u) { return; }
  let cell = vec2i(invocation.xy);
  let previous = priorAt(cell);
  let north = priorAt(cell + vec2i(0, -1)).r;
  let south = priorAt(cell + vec2i(0, 1)).r;
  let west = priorAt(cell + vec2i(-1, 0)).r;
  let east = priorAt(cell + vec2i(1, 0)).r;
  let fresh = sourceAt(cell);
  let light = dot(fresh.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let forcing = (light - 0.5) * params.intensity * params.churn
    + sin((f32(cell.x) + f32(cell.y)) * 0.012 + params.seed) * 0.003 * params.churn;
  let laplacian = north + south + west + east - 4.0 * previous.r;
  let velocity = (previous.g + (laplacian * params.drift + forcing) * params.dt * 10.0) * 0.985;
  let height = clamp(previous.r + velocity * params.dt * 10.0, -1.0, 1.0);
  let shift = vec2i(round(vec2f(east - west, south - north) * params.blockSize * 0.1));
  let displaced = sourceAt(clamp(cell + shift, vec2i(0), vec2i(767)));
  let state = vec4f(height, velocity, 0.0, 1.0);
  textureStore(nextTexture, cell, state);
  textureStore(displayTexture, cell, mix(fresh, displaced, params.intensity));
}
`,
} as const;

export const DESIGN_OWNED_FEEDBACK_RESOLVE_WGSL = feedbackResolve;

type OwnedFeedbackSlot =
  | "intensity"
  | "blockSize"
  | "drift"
  | "churn"
  | "blend"
  | "seed";
type OwnedFeedbackControls = Record<
  OwnedFeedbackSlot,
  { name: string; label: string; value: number }
>;

function ownedFeedbackDefinition(
  id: string,
  name: string,
  computeWgsl: string,
  controls: OwnedFeedbackControls,
): EffectDefinition {
  const uniformProperties = Object.fromEntries(
    Object.entries(controls).map(([slot, control]) => [slot, control.name]),
  ) as Record<OwnedFeedbackSlot, string>;
  const bounds: Record<OwnedFeedbackSlot, readonly [number, number]> = {
    intensity: [0, 1],
    blockSize: [30, 150],
    drift: [0, 1],
    churn: [0, 1],
    blend: [0, 1],
    seed: [0, 100],
  };
  const properties = Object.fromEntries(
    (Object.keys(controls) as OwnedFeedbackSlot[]).map((slot) => {
      const control = controls[slot];
      const [min, max] = bounds[slot];
      return [
        control.name,
        float(
          control.label,
          control.value,
          min,
          max,
          slot === "blockSize" ? 1 : 0.01,
        ),
      ];
    }),
  );
  return {
    id: `an-native-${id}`,
    name,
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties,
    inputs: { source: { kind: "texture-2d", resource: "source" } },
    outputs: { color: { kind: "texture-2d", resource: "feedbackOutput" } },
    resources: [
      sourceResource,
      {
        name: "feedbackState",
        kind: "texture-2d",
        format: "rgba16float",
        size: "fixed",
        width: 768,
        height: 768,
        usage: ["sampled", "storage"],
        persistent: true,
      },
      {
        name: "feedbackDisplay",
        kind: "texture-2d",
        format: "rgba16float",
        size: "fixed",
        width: 768,
        height: 768,
        usage: ["sampled", "storage"],
      },
      renderResource("feedbackOutput"),
    ],
    output: "feedbackOutput",
    feedback: {
      abi: "texture-feedback-v1",
      grid: {
        width: 768,
        height: 768,
        format: "rgba16float",
        workgroup: [8, 8],
      },
      timing: { fixedDt: 1 / 60, maxStepsPerCall: 512, maxStepIndex: 36_000 },
      stateResource: "feedbackState",
      displayResource: "feedbackDisplay",
      uniformProperties,
    },
    passes: [
      {
        id: "advance",
        kind: "compute",
        wgsl: computeWgsl,
        reads: ["source"],
        previousFrameReads: ["feedbackState"],
        output: "feedbackState",
        additionalOutputs: ["feedbackDisplay"],
        persistent: true,
        dispatch: { workgroupSize: [8, 8], elements: "fixed-grid" },
      },
      {
        id: "resolve",
        kind: "render",
        wgsl: feedbackResolve,
        reads: ["source", "feedbackDisplay"],
        output: "feedbackOutput",
      },
    ],
    provenance,
  };
}

export const DESIGN_OWNED_STATEFUL_DEFINITIONS: readonly EffectDefinition[] = [
  ownedFeedbackDefinition(
    "dye-transport",
    "Dye Transport",
    DESIGN_OWNED_FEEDBACK_KERNELS.dyeTransport,
    {
      intensity: { name: "pigment", label: "Pigment", value: 0.8 },
      blockSize: { name: "foldScale", label: "Fold scale", value: 70 },
      drift: { name: "flow", label: "Flow", value: 0.45 },
      churn: { name: "injection", label: "Injection", value: 0.2 },
      blend: { name: "mix", label: "Mix", value: 0.85 },
      seed: { name: "phase", label: "Phase", value: 12 },
    },
  ),
  ownedFeedbackDefinition(
    "reaction-field",
    "Reaction Field",
    DESIGN_OWNED_FEEDBACK_KERNELS.reactionField,
    {
      intensity: { name: "contrast", label: "Contrast", value: 0.7 },
      blockSize: { name: "islandScale", label: "Island scale", value: 80 },
      drift: { name: "diffusion", label: "Diffusion", value: 0.6 },
      churn: { name: "feeding", label: "Feeding", value: 0.45 },
      blend: { name: "mix", label: "Mix", value: 1 },
      seed: { name: "phase", label: "Phase", value: 0 },
    },
  ),
  ownedFeedbackDefinition(
    "wave-memory",
    "Wave Memory",
    DESIGN_OWNED_FEEDBACK_KERNELS.waveMemory,
    {
      intensity: { name: "depth", label: "Depth", value: 0.55 },
      blockSize: { name: "wavelength", label: "Wavelength", value: 85 },
      drift: { name: "elasticity", label: "Elasticity", value: 0.7 },
      churn: { name: "forcing", label: "Forcing", value: 0.25 },
      blend: { name: "mix", label: "Mix", value: 0.7 },
      seed: { name: "phase", label: "Phase", value: 0 },
    },
  ),
];

export const DESIGN_OWNED_STATEFUL_PRESETS: readonly EffectPreset[] =
  DESIGN_OWNED_STATEFUL_DEFINITIONS.map((definition) => ({
    id: `${definition.id}:default`,
    name: definition.name,
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement: "layer",
    params: {},
    clip: "bounds",
    provenance: { origin: "design-original" },
  }));
