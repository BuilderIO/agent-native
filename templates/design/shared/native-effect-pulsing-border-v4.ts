import { catalogColor, catalogFloat as f } from "./native-effect-catalog-kit";
import { nativeEffectPaintWgsl } from "./native-effect-paint";
import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import {
  planNativePropertyLayout,
  type EffectDefinition,
  type EffectProperty,
} from "./native-effects";

const properties = {
  colors: {
    type: "paint",
    label: "Colors",
    maxCount: 8,
    allowedKinds: ["linear", "angular"],
    default: {
      kind: "angular",
      angle: 0,
      stops: [
        { position: 0, color: catalogColor(13 / 255, 193 / 255, 253 / 255) },
        {
          position: 1 / 3,
          color: catalogColor(217 / 255, 21 / 255, 239 / 255),
        },
        { position: 2 / 3, color: catalogColor(1, 63 / 255, 46 / 255, 0.8) },
        { position: 1, color: catalogColor(13 / 255, 193 / 255, 253 / 255) },
      ],
    },
  },
  colorBack: {
    type: "color",
    label: "Background",
    default: catalogColor(0, 0, 0),
  },
  roundness: f("Roundness", 0.25, 0, 1),
  thickness: f("Thickness", 0.1, 0, 1),
  softness: f("Softness", 0.2, 0, 1),
  aspectRatio: {
    type: "enum",
    label: "Aspect ratio",
    default: "auto",
    options: ["auto", "square"],
  },
  intensity: f("Intensity", 0.2, 0, 1),
  bloom: f("Bloom", 0.25, 0, 1),
  glowSpread: f("Glow spread", 0.15, 0, 1),
  spots: { type: "int", label: "Spots", default: 4, min: 1, max: 4, step: 1 },
  spotSize: f("Spot size", 0.5, 0, 1),
  pulse: f("Pulse", 0.25, 0, 1),
  smoke: f("Smoke", 0.3, 0, 1),
  smokeSize: f("Smoke size", 0.6, 0, 1),
  margin: f("Margin", 0, 0, 1),
  marginLeft: { ...f("Margin left", 0, 0, 1), defaultFrom: "margin" },
  marginRight: { ...f("Margin right", 0, 0, 1), defaultFrom: "margin" },
  marginTop: { ...f("Margin top", 0, 0, 1), defaultFrom: "margin" },
  marginBottom: { ...f("Margin bottom", 0, 0, 1), defaultFrom: "margin" },
  fit: {
    type: "enum",
    label: "Fit",
    default: "contain",
    options: ["none", "contain", "cover"],
    advanced: true,
  },
  scale: { ...f("Scale", 0.6, 0.01, 4), advanced: true },
  rotation: { ...f("Rotation", 0, 0, 360), unit: "°", advanced: true },
  offsetX: { ...f("Offset X", 0, -1, 1), advanced: true },
  offsetY: { ...f("Offset Y", 0, -1, 1), advanced: true },
  originX: { ...f("Origin X", 0.5, 0, 1), advanced: true },
  originY: { ...f("Origin Y", 0.5, 0, 1), advanced: true },
  worldWidth: {
    ...f("World width", 0, 0, 8192, 1),
    unit: "px",
    advanced: true,
  },
  worldHeight: {
    ...f("World height", 0, 0, 8192, 1),
    unit: "px",
    advanced: true,
  },
} satisfies Record<string, EffectProperty>;

const layout = planNativePropertyLayout({
  properties,
  uniformPacking: "compact",
});
const p = (name: keyof typeof properties) => {
  const offset = layout.offsets[name];
  return "globals.params[" + Math.floor(offset / 4) + "]." + "xyzw"[offset % 4];
};
const paintSlot = layout.offsets.colors / 4;
const backSlot = layout.offsets.colorBack / 4;

const body = `
override NATIVE_GENERATED_FILL: bool = false;
const EDGE_TAU: f32 = 6.283185307179586;

fn edgeSourceOver(overlay: vec4f, source: vec4f) -> vec4f {
  return overlay + source * (1.0 - overlay.a);
}

fn edgeGeometry(uv: vec2f) -> vec4f {
  // The second pass read is receiverGeometry; its channels are data, not color.
  let halfTexel = vec2f(0.5) / vec2f(textureDimensions(maskTexture));
  let bounded = clamp(uv, halfTexel, vec2f(1.0) - halfTexel);
  var field = textureSampleLevel(maskTexture, effectSampler, bounded, 0.0);
  let cssSize = globals.viewport.xy / max(globals.clock.z, 0.0001);
  field.r -= dot((uv - bounded) * cssSize, field.gb);
  return field;
}

fn edgeLightCoordinate(boundary: vec2f, size: vec2f) -> vec2f {
  let world = vec2f(select(size.x, P_worldWidth, P_worldWidth > 0.0), select(size.y, P_worldHeight, P_worldHeight > 0.0));
  let ratio = size / world;
  var fitScale = 1.0;
  if (P_fit > 0.5 && P_fit < 1.5) { fitScale = min(ratio.x, ratio.y); }
  if (P_fit > 1.5) { fitScale = max(ratio.x, ratio.y); }
  var fieldSize = world * fitScale;
  if (P_aspectRatio > 0.5) { fieldSize = vec2f(min(fieldSize.x, fieldSize.y)); }
  let anchor = vec2f(P_originX, P_originY) * size;
  let moved = boundary - anchor - vec2f(P_offsetX, P_offsetY) * size;
  let angle = P_rotation * EDGE_TAU / 360.0;
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec2f(c * moved.x + s * moved.y, -s * moved.x + c * moved.y);
  return rotated / max(fieldSize * P_scale, vec2f(0.001));
}

@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  var source = vec4f(0.0);
  if (!NATIVE_GENERATED_FILL) { source = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0); }
  if (P_thickness <= 0.0) { return source; }
  if (P_marginLeft + P_marginRight >= 1.0 || P_marginTop + P_marginBottom >= 1.0) { return source; }
  let geometry = edgeGeometry(input.uv);
  if (geometry.a <= 0.0 || geometry.r < 0.0) { return source; }
  let density = max(globals.clock.z, 0.0001);
  let size = max(globals.viewport.xy / density, vec2f(1.0));
  let shortSide = min(size.x, size.y);
  let authoredReach = shortSide * 0.24;
  if (geometry.r >= authoredReach) { return source; }
  let normal = geometry.gb / max(length(geometry.gb), 0.0001);
  let sideWeights = abs(normal) / max(abs(normal.x) + abs(normal.y), 0.0001);
  let horizontalMargin = select(P_marginLeft, P_marginRight, normal.x >= 0.0);
  let verticalMargin = select(P_marginTop, P_marginBottom, normal.y >= 0.0);
  let inset = dot(sideWeights, vec2f(horizontalMargin, verticalMargin)) * shortSide * 0.45;
  let lineWidth = max(0.65, shortSide * (0.006 + 0.16 * P_thickness));
  let antialias = 0.5 / density;
  let coreFeather = max(antialias, lineWidth * 0.8 * P_softness);
  let haloRadius = max(antialias, shortSide * (0.002 + 0.18 * P_glowSpread * P_glowSpread));
  let smokeWidth = max(antialias, haloRadius * (0.25 + 0.75 * P_smokeSize));
  let reach = min(lineWidth * 0.5 + max(coreFeather, haloRadius), authoredReach);
  if (abs(geometry.r - inset - lineWidth * 0.5) > reach + shortSide * 0.025) { return source; }

  var distance = geometry.r;
  let rounding = P_roundness - 0.25;
  if (abs(rounding) > 0.0001) {
    let radius = shortSide * 0.022 * abs(rounding);
    let stepUv = vec2f(radius) / size;
    let surrounding = (edgeGeometry(input.uv + vec2f(stepUv.x, 0.0)).r + edgeGeometry(input.uv - vec2f(stepUv.x, 0.0)).r + edgeGeometry(input.uv + vec2f(0.0, stepUv.y)).r + edgeGeometry(input.uv - vec2f(0.0, stepUv.y)).r) * 0.25;
    // A linear distance ramp averages to itself, so straight edges stay anchored.
    distance += (surrounding - distance) * clamp(rounding * 2.0, -0.5, 1.0);
  }
  let fromLine = abs(distance - inset - lineWidth * 0.5);
  if (fromLine >= reach) { return source; }
  let core = 1.0 - smoothstep(lineWidth * 0.5 - coreFeather, lineWidth * 0.5 + coreFeather, fromLine);
  let haloDistance = max(fromLine - lineWidth * 0.5, 0.0);
  let haloLimit = 1.0 - smoothstep(haloRadius * 0.8, haloRadius, haloDistance);
  let halo = exp(-4.0 * pow(haloDistance / haloRadius, 2.0)) * haloLimit;

  let boundary = input.uv * size;
  let q = edgeLightCoordinate(boundary, size);
  let time = globals.clock.x;
  let paintAngle = time * 0.14;
  let paintCosine = cos(paintAngle);
  let paintSine = sin(paintAngle);
  let paintPoint = boundary - size * 0.5;
  let rotatingPaintPoint = vec2f(paintCosine * paintPoint.x + paintSine * paintPoint.y, -paintSine * paintPoint.x + paintCosine * paintPoint.y);
  let paint = borderPaint(0.5 + rotatingPaintPoint / size, size);
  let radiance = paint.rgb / max(paint.a, 0.0001);
  let azimuth = atan2(q.y, q.x) / EDGE_TAU;
  let bend = 0.024 * sin(q.x * 5.7 + time * 0.31) + 0.018 * sin(q.y * 8.3 - time * 0.23);
  let phase = azimuth + bend;
  let spotCount = clamp(u32(P_spots), 1u, 4u);
  let spread = 0.022 + 0.14 * P_spotSize;
  let heartbeat = pow(max(0.0, sin(time * 2.35)), 12.0) + 0.32 * pow(max(0.0, sin(time * 2.35 - 0.72)), 18.0);
  let beat = 1.0 + P_pulse * (heartbeat * 0.85 - 0.12);
  let brightness = 0.65 + 7.0 * P_intensity;
  var energy = 0.0;
  for (var index = 0u; index < 4u; index += 1u) {
    if (index >= spotCount) { break; }
    let station = f32(index) / f32(spotCount) + time * 0.1;
    let separation = abs(fract(phase - station + 0.5) - 0.5);
    let body = exp(-pow(separation / spread, 2.0));
    let seed = f32(index) * 2.1;
    let flicker = 0.86 + 0.09 * sin(q.x * 12.1 + q.y * 7.3 + seed + time * 0.6) + 0.05 * sin(q.x * 4.3 - q.y * 14.7 - time * 0.39);
    let stationEnergy = 0.55 + 0.45 * sin(time * 1.7 + seed);
    energy += body * flicker * beat * brightness * (0.4 + 0.6 * stationEnergy);
  }
  let edgeAmount = energy * (core * 0.92 + halo * P_bloom * 1.3);
  let alpha = (1.0 - exp(-edgeAmount)) * paint.a;
  let emissionGain = 1.0 + min(3.0, energy * core * 1.2);
  let peak = clamp((energy - 1.25) * 2.0, 0.0, 1.0);
  let whitePeak = 0.18 * core * core * core * peak * peak * peak;
  var light = vec4f((radiance * emissionGain + vec3f(whitePeak)) * alpha, alpha);

  if (P_smoke > 0.0 && paint.a > 0.0) {
    let drift = time * 0.27;
    let curl = sin(q.x * 9.0 + sin(q.y * 6.0 + drift) - drift) * sin(q.y * 11.0 - cos(q.x * 5.0 - drift) + drift * 0.7);
    let smokeDistance = haloDistance / smokeWidth;
    let ribbon = exp(-pow(smokeDistance - 0.7 - curl * 0.42, 2.0) * 4.0);
    let smokeAlpha = P_smoke * paint.a * ribbon * halo * 0.22;
    light = edgeSourceOver(vec4f(radiance * smokeAlpha, smokeAlpha), light);
  }
  let background = globals.params[BACK_SLOT];
  let backgroundAlpha = background.a * core * 0.24;
  let backing = vec4f(background.rgb * backgroundAlpha, backgroundAlpha);
  let authoredLimit = 1.0 - smoothstep(authoredReach * 0.85, authoredReach, geometry.r);
  let coverage = geometry.a * authoredLimit;
  let overlay = edgeSourceOver(light, backing) * coverage;
  return edgeSourceOver(overlay, source);
}
`;

const wgsl =
  NATIVE_RENDER_GLOBALS +
  nativeEffectPaintWgsl(paintSlot, "borderPaint", 8) +
  body
    .replace(/BACK_SLOT/g, String(backSlot))
    .replace(/P_([a-zA-Z]+)/g, (_match, name: string) =>
      p(name as keyof typeof properties),
    );

export const PULSING_BORDER_V4_EFFECT: EffectDefinition = {
  id: "an-native-pulsing-border",
  name: "Pulsing Border",
  version: 4,
  kind: "processor",
  placements: ["fill", "layer"],
  uniformPacking: "compact",
  properties,
  inputs: {
    source: { kind: "texture-2d", resource: "source" },
    geometry: { kind: "texture-2d", resource: "receiverGeometry" },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      external: true,
      usage: ["sampled"],
      size: "viewport",
    },
    {
      name: "receiverGeometry",
      kind: "texture-2d",
      external: true,
      format: "rgba16float",
      sampleEncoding: "linear-data",
      usage: ["sampled"],
      size: "viewport",
    },
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
      id: "render",
      kind: "render",
      reads: ["source", "receiverGeometry"],
      output: "color",
      wgsl,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original Design contour lighting with spatial gradient paint, moving light stations, independent core feather and halo radius, analytic smoke, paired heartbeat modulation, and premultiplied source-over compositing.",
  },
};
