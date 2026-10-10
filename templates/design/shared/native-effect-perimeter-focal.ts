import { catalogColor } from "./native-effect-catalog-kit";
import { DESIGN_COORDINATE_RANDOM_WGSL } from "./native-effect-coordinate-random";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import {
  propertySlots,
  type EffectDefinition,
  type EffectProperty,
  type EffectPreset,
  type EffectValue,
} from "./native-effects";

const f = (
  label: string,
  value: number,
  min: number,
  max: number,
): Extract<EffectProperty, { type: "float" | "int" }> => ({
  type: "float",
  label,
  default: value,
  min,
  max,
  step: 0.01,
});
const coordinateProperties = (): Record<string, EffectProperty> => ({
  fit: {
    type: "enum",
    label: "Fit",
    default: "none",
    options: ["none", "contain", "cover"],
    advanced: true,
  },
  scale: { ...f("Scale", 1, 0.01, 4), advanced: true },
  rotation: { ...f("Rotation", 0, 0, 360), unit: "°", advanced: true },
  originX: { ...f("Origin X", 0.5, 0, 1), advanced: true },
  originY: { ...f("Origin Y", 0.5, 0, 1), advanced: true },
  offsetX: { ...f("Offset X", 0, -1, 1), advanced: true },
  offsetY: { ...f("Offset Y", 0, -1, 1), advanced: true },
  worldWidth: {
    ...f("World width", 0, 0, 8192),
    unit: "px",
    step: 1,
    advanced: true,
  },
  worldHeight: {
    ...f("World height", 0, 0, 8192),
    unit: "px",
    step: 1,
    advanced: true,
  },
});
const background: EffectProperty = {
  type: "color",
  label: "Background color",
  default: catalogColor(0.025, 0.045, 0.075),
};
const perimeterProperties: Record<string, EffectProperty> = {
  colorBack: structuredClone(background),
  colors: {
    type: "color-array",
    label: "Light colors",
    default: [
      catalogColor(0.97, 0.55, 0.19),
      catalogColor(0.24, 0.87, 0.7),
      catalogColor(0.89, 0.93, 0.83),
    ],
    maxCount: 5,
  },
  roundness: f("Roundness", 0.2, 0, 1),
  thickness: f("Thickness", 0.025, 0, 1),
  marginLeft: f("Left margin", 0.05, 0, 1),
  marginRight: f("Right margin", 0.05, 0, 1),
  marginTop: f("Top margin", 0.05, 0, 1),
  marginBottom: f("Bottom margin", 0.05, 0, 1),
  aspectRatio: {
    type: "enum",
    label: "Aspect ratio",
    default: "auto",
    options: ["auto", "square"],
  },
  softness: f("Softness", 0.3, 0, 1),
  intensity: f("Intensity", 0.6, 0, 1),
  bloom: f("Halo reach", 0.35, 0, 1),
  spots: {
    type: "int",
    label: "Lights per color",
    default: 2,
    min: 1,
    max: 4,
    step: 1,
  },
  spotSize: f("Light reach", 0.15, 0, 1),
  pulse: f("Pulse", 0.25, 0, 1),
  smoke: f("Mist depth", 0.2, 0, 1),
  smokeSize: f("Mist scale", 0.5, 0, 1),
  ...coordinateProperties(),
};
const focalProperties: Record<string, EffectProperty> = {
  colorBack: structuredClone(background),
  colors: {
    type: "color-array",
    label: "Field colors",
    default: [
      catalogColor(0.95, 0.92, 0.75),
      catalogColor(0.4, 0.79, 0.7),
      catalogColor(0.09, 0.27, 0.38),
    ],
    maxCount: 10,
  },
  radius: f("Radius", 0.7, 0, 3),
  focalDistance: f("Focal distance", 0, 0, 3),
  focalAngle: { ...f("Focal angle", 0, 0, 360), unit: "°" },
  falloff: f("Falloff", 0, -1, 1),
  mixing: f("Stop blending", 1, 0, 1),
  distortion: f("Distortion", 0.15, 0, 1),
  distortionShift: f("Deformation phase", 0, -1, 1),
  distortionFreq: f("Angular frequency", 6, 0, 20),
  grainMixer: f("Field grain", 0.02, 0, 1),
  grainOverlay: f("Color grain", 0.015, 0, 1),
  ...coordinateProperties(),
};

type Accessor = ((key: string) => string) & { slot: (key: string) => number };
function uniforms(properties: Record<string, EffectProperty>): Accessor {
  const slots = new Map<string, number>();
  let next = 0;
  for (const [key, property] of Object.entries(properties)) {
    slots.set(key, next);
    next += propertySlots(property);
  }
  if (next > 32) throw new Error("Perimeter/focal uniform budget exceeded");
  const slot = (key: string): number => {
    const value = slots.get(key);
    if (value === undefined)
      throw new Error(`Unknown perimeter/focal property: ${key}`);
    return value;
  };
  return Object.assign((key: string) => `globals.params[${slot(key)}]`, {
    slot,
  });
}
function common(p: Accessor): string {
  return `
const DESIGN_FIELD_PI: f32 = 3.141592653589793;
const DESIGN_FIELD_TAU: f32 = 6.283185307179586;
${DESIGN_COORDINATE_RANDOM_WGSL}
fn fieldCoordinates(uv: vec2f) -> vec4f {
  let viewport = globals.viewport.xy / globals.clock.z;
  let world = vec2f(select(viewport.x, ${p("worldWidth")}.x, ${p("worldWidth")}.x > 0.0), select(viewport.y, ${p("worldHeight")}.x, ${p("worldHeight")}.x > 0.0));
  let fit = u32(${p("fit")}.x);
  let ratios = viewport / world;
  var fitScale = 1.0;
  if (fit == 1u) { fitScale = min(ratios.x, ratios.y); }
  if (fit == 2u) { fitScale = max(ratios.x, ratios.y); }
  let anchor = vec2f(${p("originX")}.x, ${p("originY")}.x) + vec2f(${p("offsetX")}.x, ${p("offsetY")}.x);
  let local = (uv * viewport - anchor * viewport) / (fitScale * ${p("scale")}.x);
  let angle = ${p("rotation")}.x * DESIGN_FIELD_PI / 180.0;
  let point = vec2f(cos(angle)*local.x + sin(angle)*local.y, -sin(angle)*local.x + cos(angle)*local.y) + world * 0.5;
  return vec4f(point, world);
}
fn fieldColor(index: u32) -> vec4f {
  let color = globals.params[${p.slot("colors")}u + 1u + index];
  return vec4f(color.rgb * color.a, color.a);
}
fn fieldBackground() -> vec4f {
  let color = ${p("colorBack")};
  return vec4f(color.rgb * color.a, color.a);
}
fn fieldOver(foreground: vec4f, background: vec4f) -> vec4f { return foreground + background * (1.0-foreground.a); }
fn fieldNoise(point: vec2f) -> f32 {
  let cell = floor(point);
  let local = fract(point);
  let weight = local * local * (3.0-2.0*local);
  let seed = globals.clock.y;
  let a = designCoordinateRandom(cell, seed);
  let b = designCoordinateRandom(cell+vec2f(1.0,0.0), seed);
  let c = designCoordinateRandom(cell+vec2f(0.0,1.0), seed);
  let d = designCoordinateRandom(cell+vec2f(1.0), seed);
  return mix(mix(a,b,weight.x),mix(c,d,weight.x),weight.y);
}
`;
}
function perimeterBody(p: Accessor): string {
  return `
fn perimeterPoint(distance: f32, halfExtent: vec2f, radius: f32) -> vec2f {
  let horizontal = 2.0*(halfExtent.x-radius);
  let vertical = 2.0*(halfExtent.y-radius);
  let arc = radius * DESIGN_FIELD_PI * 0.5;
  var remaining = distance;
  if (remaining < horizontal) { return vec2f(-halfExtent.x+radius+remaining,-halfExtent.y); }
  remaining -= horizontal;
  if (remaining < arc) { let angle = -DESIGN_FIELD_PI*0.5 + remaining/radius; return vec2f(halfExtent.x-radius,-halfExtent.y+radius)+radius*vec2f(cos(angle),sin(angle)); }
  remaining -= arc;
  if (remaining < vertical) { return vec2f(halfExtent.x,-halfExtent.y+radius+remaining); }
  remaining -= vertical;
  if (remaining < arc) { let angle = remaining/radius; return vec2f(halfExtent.x-radius,halfExtent.y-radius)+radius*vec2f(cos(angle),sin(angle)); }
  remaining -= arc;
  if (remaining < horizontal) { return vec2f(halfExtent.x-radius-remaining,halfExtent.y); }
  remaining -= horizontal;
  if (remaining < arc) { let angle = DESIGN_FIELD_PI*0.5+remaining/radius; return vec2f(-halfExtent.x+radius,halfExtent.y-radius)+radius*vec2f(cos(angle),sin(angle)); }
  remaining -= arc;
  if (remaining < vertical) { return vec2f(-halfExtent.x,halfExtent.y-radius-remaining); }
  remaining -= vertical;
  if (radius == 0.0) { return vec2f(-halfExtent.x,-halfExtent.y); }
  let angle = DESIGN_FIELD_PI+remaining/radius;
  return vec2f(-halfExtent.x+radius,-halfExtent.y+radius)+radius*vec2f(cos(angle),sin(angle));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let coordinates = fieldCoordinates(input.uv);
  let point = coordinates.xy;
  let world = coordinates.zw;
  let pixelSpan = max(length(dpdx(point)),length(dpdy(point)));
  let minimum = vec2f(${p("marginLeft")}.x,${p("marginTop")}.x)*world;
  let maximum = (vec2f(1.0)-vec2f(${p("marginRight")}.x,${p("marginBottom")}.x))*world;
  let center = (minimum+maximum)*0.5;
  var halfExtent = (maximum-minimum)*0.5;
  if (u32(${p("aspectRatio")}.x) == 1u) { halfExtent = vec2f(min(halfExtent.x,halfExtent.y)); }
  let radius = min(halfExtent.x,halfExtent.y)*${p("roundness")}.x;
  let delta = abs(point-center)-halfExtent+vec2f(radius);
  let signedDistance = length(max(delta,vec2f(0.0)))+min(max(delta.x,delta.y),0.0)-radius;
  let span = 2.0*min(halfExtent.x,halfExtent.y);
  let bandWidth = ${p("thickness")}.x*span;
  let feather = max(pixelSpan*0.75,0.0001)+${p("softness")}.x*span*0.02;
  let core = 1.0-smoothstep(bandWidth*0.5-feather,bandWidth*0.5+feather,abs(signedDistance));
  let haloWidth = max(pixelSpan,span*(0.01+0.12*${p("bloom")}.x));
  let halo = exp(-pow(abs(signedDistance)/haloWidth,2.0))*${p("bloom")}.x;
  let count = u32(${p("colors")}.x);
  let spots = u32(${p("spots")}.x);
  let perimeter = 4.0*(halfExtent.x+halfExtent.y-2.0*radius)+DESIGN_FIELD_TAU*radius;
  let reach = max(pixelSpan,perimeter*(0.003+${p("spotSize")}.x*0.12));
  let time = globals.clock.x;
  var weightedColor = vec4f(0.0);
  var totalWeight = 0.0;
  for (var color = 0u; color < 5u; color += 1u) {
    if (color < count) {
      for (var spot = 0u; spot < 4u; spot += 1u) {
        if (spot < spots) {
          let identity = vec2f(f32(color),f32(spot));
          let phase = designCoordinateRandom(identity,globals.clock.y);
          let location = fract((f32(spot)+phase)/f32(spots)+time*(0.025+0.007*f32(color)));
          let light = perimeterPoint(location*perimeter,halfExtent,radius)+center;
          let envelope = mix(1.0,0.7+0.3*sin(DESIGN_FIELD_TAU*(time*0.4+phase)),${p("pulse")}.x);
          let distance = length(point-light)/reach;
          let weight = exp(-distance*distance)*envelope;
          weightedColor += fieldColor(color)*weight;
          totalWeight += weight;
        }
      }
    }
  }
  var lightColor = fieldColor(0u);
  if (totalWeight > 0.00001) { lightColor = weightedColor/totalWeight; }
  let mistWavelength = max(pixelSpan,span*${p("smokeSize")}.x*0.5);
  let mist = fieldNoise(point/mistWavelength+vec2f(time*0.07,-time*0.035));
  let modulation = mix(1.0,0.3+0.7*mist,${p("smoke")}.x);
  let dynamicEnergy = ${p("intensity")}.x*min(totalWeight,1.0);
  let coverage = clamp(core+halo*(0.3+dynamicEnergy),0.0,1.0)*modulation;
  let color = mix(fieldColor(0u),lightColor,clamp(${p("intensity")}.x+${p("bloom")}.x,0.0,1.0));
  return fieldOver(color*coverage,fieldBackground());
}
`;
}
function focalBody(p: Accessor): string {
  return `
fn focalPalette(position: f32) -> vec4f {
  let count = u32(${p("colors")}.x);
  let scaled = clamp(position,0.0,1.0)*f32(count-1u);
  let low = min(u32(floor(scaled)),count-1u);
  let high = min(low+1u,count-1u);
  let fraction = fract(scaled);
  let smoothColor = mix(fieldColor(low),fieldColor(high),fraction);
  let hardColor = fieldColor(min(u32(floor(scaled+0.5)),count-1u));
  return mix(hardColor,smoothColor,${p("mixing")}.x);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let coordinates = fieldCoordinates(input.uv);
  let point = coordinates.xy;
  let world = coordinates.zw;
  let pixelSpan = max(length(dpdx(point)),length(dpdy(point)));
  let span = min(world.x,world.y);
  let focusAngle = ${p("focalAngle")}.x*DESIGN_FIELD_PI/180.0;
  let focus = world*0.5+span*${p("focalDistance")}.x*vec2f(cos(focusAngle),sin(focusAngle));
  let relative = (point-focus)/span;
  var angle = 0.0;
  if (any(relative != vec2f(0.0))) { angle = atan2(relative.y,relative.x); }
  let radius = ${p("radius")}.x;
  if (radius == 0.0) { return fieldBackground(); }
  let deformation = ${p("distortion")}.x*0.25*radius*sin(${p("distortionFreq")}.x*angle+DESIGN_FIELD_TAU*${p("distortionShift")}.x);
  let fieldDither = (designCoordinateRandom(floor(point),globals.clock.y)-0.5)*${p("grainMixer")}.x*0.16;
  let distance = max(length(relative)+deformation+fieldDither,0.0);
  let normalized = clamp(distance/max(radius,pixelSpan/span),0.0,1.0);
  let shaped = pow(normalized,exp2(2.0*${p("falloff")}.x));
  let color = focalPalette(shaped);
  let edge = 1.0-smoothstep(radius-pixelSpan/span,radius+pixelSpan/span,distance);
  let grain = (designCoordinateRandom(floor(point)+vec2f(37.0,19.0),globals.clock.y)-0.5)*${p("grainOverlay")}.x*0.25;
  let foreground = vec4f(color.rgb*(1.0+grain),color.a)*edge;
  return fieldOver(foreground,fieldBackground());
}
`;
}
function definition(
  id: string,
  name: string,
  properties: Record<string, EffectProperty>,
  body: (p: Accessor) => string,
): EffectDefinition {
  const p = uniforms(properties);
  return {
    id,
    name,
    version: 1,
    kind: "generator",
    placements: ["fill"],
    properties,
    outputs: { color: { kind: "texture-2d", resource: "color" } },
    resources: [
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    output: "color",
    passes: [
      {
        id: "field",
        kind: "render",
        reads: [],
        output: "color",
        wgsl: NATIVE_RENDER_GLOBALS + common(p) + body(p),
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Design-owned analytic geometry and linear premultiplied palette fields with bounded seeded integer modulation.",
    },
  };
}
export const LUMINOUS_PERIMETER_EFFECT: EffectDefinition = {
  ...definition(
    "an-native-luminous-perimeter",
    "Luminous Perimeter",
    perimeterProperties,
    perimeterBody,
  ),
  parameterConstraints: [
    {
      kind: "float-sum",
      properties: ["marginLeft", "marginRight"],
      maxSum: 0.999,
    },
    {
      kind: "float-sum",
      properties: ["marginTop", "marginBottom"],
      maxSum: 0.999,
    },
  ],
};
export const FOCAL_COLOR_FIELD_EFFECT = definition(
  "an-native-focal-color-field",
  "Focal Color Field",
  focalProperties,
  focalBody,
);
export const NATIVE_PERIMETER_FOCAL_DEFINITIONS: readonly EffectDefinition[] = [
  LUMINOUS_PERIMETER_EFFECT,
  FOCAL_COLOR_FIELD_EFFECT,
];
function recipe(
  definition: EffectDefinition,
  suffix: string,
  name: string,
  params: Record<string, EffectValue>,
  speed = 1,
): EffectPreset {
  return {
    id: `an-preset-${definition.id.slice("an-native-".length)}-${suffix}`,
    name,
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement: "fill",
    params,
    clip: "bounds",
    timing: { speed, paused: false, time: 0 },
    provenance: { origin: "design-original" },
  };
}
export const NATIVE_PERIMETER_FOCAL_PRESETS: readonly EffectPreset[] = [
  recipe(
    LUMINOUS_PERIMETER_EFFECT,
    "copper-tracer",
    "Copper Tracer",
    {
      colors: [catalogColor(0.97, 0.52, 0.18)],
      roundness: 0,
      thickness: 0.012,
      intensity: 0,
      bloom: 0.15,
      softness: 0,
      smoke: 0,
      pulse: 0,
    },
    0,
  ),
  recipe(
    LUMINOUS_PERIMETER_EFFECT,
    "polar-lantern",
    "Polar Lantern",
    {
      colors: [catalogColor(0.25, 0.84, 0.75), catalogColor(0.92, 0.98, 0.86)],
      aspectRatio: "square",
      roundness: 1,
      thickness: 0.015,
      spots: 1,
      spotSize: 0.24,
      bloom: 0.65,
      pulse: 0.7,
      smoke: 0.3,
    },
    0.45,
  ),
  recipe(
    LUMINOUS_PERIMETER_EFFECT,
    "spectrum-race",
    "Spectrum Race",
    {
      colors: [
        catalogColor(0.98, 0.37, 0.13),
        catalogColor(0.88, 0.72, 0.12),
        catalogColor(0.12, 0.82, 0.47),
        catalogColor(0.14, 0.62, 0.91),
        catalogColor(0.88, 0.24, 0.54),
      ],
      marginLeft: 0.14,
      marginRight: 0.04,
      marginTop: 0.08,
      marginBottom: 0.18,
      spots: 4,
      spotSize: 0.06,
      pulse: 0.9,
      smoke: 0.55,
      intensity: 1,
    },
    1.3,
  ),
  recipe(
    FOCAL_COLOR_FIELD_EFFECT,
    "quiet-focus",
    "Quiet Focus",
    { radius: 0.75, distortion: 0, grainMixer: 0, grainOverlay: 0, mixing: 1 },
    0,
  ),
  recipe(
    FOCAL_COLOR_FIELD_EFFECT,
    "split-orbit",
    "Split Orbit",
    {
      colors: [
        catalogColor(0.94, 0.76, 0.22),
        catalogColor(0.19, 0.62, 0.72),
        catalogColor(0.11, 0.2, 0.4),
        catalogColor(0.89, 0.46, 0.2),
      ],
      radius: 1.25,
      focalDistance: 0.38,
      focalAngle: 137,
      mixing: 0,
      distortion: 0.7,
      distortionFreq: 8,
      distortionShift: -0.25,
      grainMixer: 0,
      grainOverlay: 0,
    },
    0,
  ),
  recipe(
    FOCAL_COLOR_FIELD_EFFECT,
    "grain-eclipse",
    "Grain Eclipse",
    {
      colorBack: catalogColor(0.08, 0.16, 0.24, 0.35),
      colors: [
        catalogColor(0.87, 0.27, 0.16),
        catalogColor(0.24, 0.64, 0.62),
        catalogColor(0.97, 0.86, 0.61, 0.8),
      ],
      radius: 0.6,
      focalDistance: 0.16,
      focalAngle: 230,
      mixing: 0.65,
      falloff: 0.45,
      distortion: 0.2,
      grainMixer: 0.8,
      grainOverlay: 0.65,
    },
    0,
  ),
];
