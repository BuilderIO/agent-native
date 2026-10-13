import { NATIVE_GRAPH_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const common = `${NATIVE_GRAPH_GLOBALS}
const TAU: f32 = 6.28318530718;
fn wrapped(point: vec2i, size: vec2i) -> vec2i {
  return (point % size + size) % size;
}
fn uvAt(point: vec2i, size: vec2i) -> vec2f {
  return (vec2f(point) + 0.5) / vec2f(size);
}
fn seededDensity(uv: vec2f) -> f32 {
  let phase = globals.clock.y * 0.017;
  let bands = pow(0.5 + 0.5 * sin(TAU * (uv.x * 3.0 + phase)) * sin(TAU * (uv.y * 2.0 - phase)), 2.0);
  let center = vec2f(0.5 + 0.16 * sin(phase), 0.5 + 0.16 * cos(phase));
  let delta = fract(uv - center + 0.5) - 0.5;
  let pocket = exp(-dot(delta, delta) * 35.0);
  return clamp(0.08 + bands * 0.58 + pocket * 0.28, 0.0, 1.0);
}
`;

const advectVelocity = `${common}
@group(0) @binding(2) var previousVelocity: texture_2d<f32>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
fn velocityAt(uv: vec2f) -> vec2f {
  let size = vec2i(textureDimensions(previousVelocity));
  let pixel = fract(uv) * vec2f(size) - 0.5;
  let base = vec2i(floor(pixel));
  let blend = fract(pixel);
  let a = textureLoad(previousVelocity, wrapped(base, size), 0).xy;
  let b = textureLoad(previousVelocity, wrapped(base + vec2i(1, 0), size), 0).xy;
  let c = textureLoad(previousVelocity, wrapped(base + vec2i(0, 1), size), 0).xy;
  let d = textureLoad(previousVelocity, wrapped(base + vec2i(1, 1), size), 0).xy;
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let uv = uvAt(vec2i(id.xy), size);
  let phase = globals.clock.y * 0.017;
  let scale = globals.params[2].x;
  let swirl = vec2f(sin(TAU * (uv.y * scale + phase)), -sin(TAU * (uv.x * scale - phase)));
  let dt = globals.clock.w;
  var velocity = swirl * 0.065 * globals.params[1].x;
  if (dt > 0.0) {
    let previous = velocityAt(uv);
    let traced = uv - previous * dt;
    velocity = velocityAt(traced);
    let texel = 1.0 / vec2f(size);
    let neighbors = velocityAt(traced - vec2f(texel.x, 0.0)) + velocityAt(traced + vec2f(texel.x, 0.0))
      + velocityAt(traced - vec2f(0.0, texel.y)) + velocityAt(traced + vec2f(0.0, texel.y));
    velocity = mix(velocity, neighbors * 0.25, clamp(globals.params[0].x * dt * 10.0, 0.0, 1.0));
    velocity += swirl * globals.params[1].x * dt * 0.12;
    velocity *= exp(-globals.params[0].x * dt * 0.5);
  }
  textureStore(outputTexture, vec2i(id.xy), vec4f(clamp(velocity, vec2f(-0.5), vec2f(0.5)), 0.0, 0.0));
}`;

const divergence = `${common}
@group(0) @binding(2) var velocityTexture: texture_2d<f32>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let point = vec2i(id.xy);
  let left = textureLoad(velocityTexture, wrapped(point + vec2i(-1, 0), size), 0).x;
  let right = textureLoad(velocityTexture, wrapped(point + vec2i(1, 0), size), 0).x;
  let top = textureLoad(velocityTexture, wrapped(point + vec2i(0, -1), size), 0).y;
  let bottom = textureLoad(velocityTexture, wrapped(point + vec2i(0, 1), size), 0).y;
  textureStore(outputTexture, point, vec4f(0.5 * (right - left + bottom - top), 0.0, 0.0, 0.0));
}`;

function pressurePass(first: boolean): string {
  return `${common}
@group(0) @binding(2) var divergenceTexture: texture_2d<f32>;
${first ? "" : "@group(0) @binding(3) var pressureTexture: texture_2d<f32>;"}
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let point = vec2i(id.xy);
  let divergenceValue = textureLoad(divergenceTexture, point, 0).x;
  ${
    first
      ? "let neighborSum = 0.0;"
      : `let neighborSum =
    textureLoad(pressureTexture, wrapped(point + vec2i(-1, 0), size), 0).x
    + textureLoad(pressureTexture, wrapped(point + vec2i(1, 0), size), 0).x
    + textureLoad(pressureTexture, wrapped(point + vec2i(0, -1), size), 0).x
    + textureLoad(pressureTexture, wrapped(point + vec2i(0, 1), size), 0).x;`
  }
  textureStore(outputTexture, point, vec4f((neighborSum - divergenceValue) * 0.25, 0.0, 0.0, 0.0));
}`;
}

const projectVelocity = `${common}
@group(0) @binding(2) var velocityTexture: texture_2d<f32>;
@group(0) @binding(3) var pressureTexture: texture_2d<f32>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let point = vec2i(id.xy);
  let x = textureLoad(pressureTexture, wrapped(point + vec2i(1, 0), size), 0).x
    - textureLoad(pressureTexture, wrapped(point + vec2i(-1, 0), size), 0).x;
  let y = textureLoad(pressureTexture, wrapped(point + vec2i(0, 1), size), 0).x
    - textureLoad(pressureTexture, wrapped(point + vec2i(0, -1), size), 0).x;
  let velocity = textureLoad(velocityTexture, point, 0).xy - 0.5 * vec2f(x, y);
  textureStore(outputTexture, point, vec4f(clamp(velocity, vec2f(-0.5), vec2f(0.5)), 0.0, 0.0));
}`;

const advanceDensity = `${common}
@group(0) @binding(2) var velocityTexture: texture_2d<f32>;
@group(0) @binding(3) var previousDensity: texture_2d<f32>;
@group(0) @binding(18) var outputTexture: texture_storage_2d<rgba16float, write>;
fn densityAt(uv: vec2f) -> f32 {
  let size = vec2i(textureDimensions(previousDensity));
  let pixel = fract(uv) * vec2f(size) - 0.5;
  let base = vec2i(floor(pixel));
  let blend = fract(pixel);
  let a = textureLoad(previousDensity, wrapped(base, size), 0).x;
  let b = textureLoad(previousDensity, wrapped(base + vec2i(1, 0), size), 0).x;
  let c = textureLoad(previousDensity, wrapped(base + vec2i(0, 1), size), 0).x;
  let d = textureLoad(previousDensity, wrapped(base + vec2i(1, 1), size), 0).x;
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}
@compute @workgroup_size(8, 8, 1)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(outputTexture));
  if (any(id.xy >= vec2u(size))) { return; }
  let point = vec2i(id.xy);
  let uv = uvAt(point, size);
  let dt = globals.clock.w;
  var density = seededDensity(uv);
  if (dt > 0.0) {
    let velocity = textureLoad(velocityTexture, point, 0).xy;
    let traced = uv - velocity * dt;
    density = densityAt(traced);
    let texel = 1.0 / vec2f(size);
    let neighbors = densityAt(traced - vec2f(texel.x, 0.0)) + densityAt(traced + vec2f(texel.x, 0.0))
      + densityAt(traced - vec2f(0.0, texel.y)) + densityAt(traced + vec2f(0.0, texel.y));
    density = mix(density, neighbors * 0.25, clamp(globals.params[3].x * dt * 10.0, 0.0, 1.0));
    density = density * exp(-globals.params[5].x * dt)
      + seededDensity(uv) * globals.params[4].x * dt * 0.16;
    density = mix(density, seededDensity(uv), 1.0 - exp(-globals.params[6].x * dt));
  }
  textureStore(outputTexture, point, vec4f(clamp(density, 0.0, 1.0), 0.0, 0.0, 0.0));
}`;

const render = `${common}
@group(0) @binding(2) var densityTexture: texture_2d<f32>;
fn densityAt(uv: vec2f) -> f32 {
  let size = vec2i(textureDimensions(densityTexture));
  let pixel = fract(uv) * vec2f(size) - 0.5;
  let base = vec2i(floor(pixel));
  let blend = fract(pixel);
  let a = textureLoad(densityTexture, wrapped(base, size), 0).x;
  let b = textureLoad(densityTexture, wrapped(base + vec2i(1, 0), size), 0).x;
  let c = textureLoad(densityTexture, wrapped(base + vec2i(0, 1), size), 0).x;
  let d = textureLoad(densityTexture, wrapped(base + vec2i(1, 1), size), 0).x;
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let coordinates = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(coordinates[vertexIndex], 0.0, 1.0);
  output.uv = coordinates[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let density = clamp(densityAt(input.uv), 0.0, 1.0);
  let low = vec4f(globals.params[7].rgb * globals.params[7].a, globals.params[7].a);
  let high = vec4f(globals.params[8].rgb * globals.params[8].a, globals.params[8].a);
  return mix(low, high, density) * density;
}`;

const texture = (name: string, persistent = false) => ({
  name,
  kind: "texture-2d" as const,
  format: "rgba16float" as const,
  usage: ["sampled", "storage"] as ("sampled" | "storage")[],
  size: "fixed" as const,
  width: 128,
  height: 128,
  ...(persistent ? { persistent: true } : {}),
});

export const FLUID_COLOR_FIELD_EFFECT: EffectDefinition = {
  id: "an-native-owned-source-free-fluid-color-field",
  name: "Fluid Color Field",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    viscosity: {
      type: "float",
      label: "Viscosity",
      default: 0.28,
      min: 0,
      max: 2,
      step: 0.01,
    },
    flowForce: {
      type: "float",
      label: "Flow force",
      default: 0.8,
      min: 0,
      max: 2,
      step: 0.01,
    },
    flowScale: {
      type: "int",
      label: "Flow scale",
      default: 2,
      min: 1,
      max: 5,
      step: 1,
    },
    densityDiffusion: {
      type: "float",
      label: "Density diffusion",
      default: 0.24,
      min: 0,
      max: 2,
      step: 0.01,
    },
    densityEmission: {
      type: "float",
      label: "Density emission",
      default: 0.8,
      min: 0,
      max: 3,
      step: 0.01,
    },
    densityDecay: {
      type: "float",
      label: "Density decay",
      default: 0.12,
      min: 0,
      max: 2,
      step: 0.01,
    },
    densityRestoration: {
      type: "float",
      label: "Density restoration",
      default: 0.22,
      min: 0,
      max: 2,
      step: 0.01,
    },
    lowColor: {
      type: "color",
      label: "Low color",
      default: { space: "srgb", components: [0.11, 0.16, 0.41], alpha: 1 },
    },
    highColor: {
      type: "color",
      label: "High color",
      default: { space: "srgb", components: [0.58, 0.78, 1], alpha: 1 },
    },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    texture("advectedVelocity"),
    texture("divergence"),
    ...Array.from({ length: 6 }, (_, index) => texture(`pressure${index}`)),
    texture("velocity", true),
    texture("density", true),
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: {
    abi: "stateful-resource-v3",
    timing: { fixedDt: 1 / 60, maxStepsPerCall: 8, maxStepIndex: 36000 },
    stateResources: ["velocity", "density"],
  },
  passes: [
    {
      id: "advect-velocity",
      kind: "compute",
      wgsl: advectVelocity,
      reads: [],
      previousFrameReads: ["velocity"],
      output: "advectedVelocity",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "divergence",
      kind: "compute",
      wgsl: divergence,
      reads: ["advectedVelocity"],
      output: "divergence",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `pressure-${index}`,
      kind: "compute" as const,
      wgsl: pressurePass(index === 0),
      reads:
        index === 0 ? ["divergence"] : ["divergence", `pressure${index - 1}`],
      output: `pressure${index}`,
      dispatch: {
        elements: "output-texture" as const,
        workgroupSize: [8, 8, 1] as const,
      },
    })),
    {
      id: "project-velocity",
      kind: "compute",
      wgsl: projectVelocity,
      reads: ["advectedVelocity", "pressure5"],
      output: "velocity",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "advance-density",
      kind: "compute",
      wgsl: advanceDensity,
      reads: ["velocity"],
      previousFrameReads: ["density"],
      output: "density",
      dispatch: { elements: "output-texture", workgroupSize: [8, 8, 1] },
    },
    {
      id: "render",
      kind: "render",
      wgsl: render,
      reads: ["density"],
      output: "color",
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "A source-free toroidal velocity and density field uses fixed-step advection, pressure projection, diffusion, and density restoration. The bounded field maps to editable premultiplied Fill colors.",
  },
};

export const FLUID_COLOR_FIELD_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-source-free-fluid-indigo-current",
    name: "Indigo Current",
    definitionId: FLUID_COLOR_FIELD_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    clip: "bounds",
    params: {
      viscosity: 0.2,
      flowForce: 1.1,
      flowScale: 2,
      densityDiffusion: 0.22,
      densityEmission: 1.1,
      densityDecay: 0.14,
      densityRestoration: 0.18,
      lowColor: { space: "srgb", components: [0.1, 0.15, 0.42], alpha: 0.92 },
      highColor: { space: "srgb", components: [0.5, 0.84, 1], alpha: 0.92 },
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-source-free-fluid-amber-tide",
    name: "Amber Tide",
    definitionId: FLUID_COLOR_FIELD_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    clip: "bounds",
    params: {
      viscosity: 0.48,
      flowForce: 0.75,
      flowScale: 4,
      densityDiffusion: 0.55,
      densityEmission: 0.85,
      densityDecay: 0.2,
      densityRestoration: 0.34,
      lowColor: { space: "srgb", components: [0.25, 0.08, 0.1], alpha: 0.96 },
      highColor: { space: "srgb", components: [1, 0.58, 0.24], alpha: 0.96 },
    },
    provenance: { origin: "design-original" },
  },
];
