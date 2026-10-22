import { catalogColor, catalogFloat } from "./native-effect-catalog-kit";
import { nativeEffectPaintWgsl } from "./native-effect-paint";
import { NATIVE_GLOBAL_BINDINGS } from "./native-effect-wgsl";
import {
  planNativePropertyLayout,
  type EffectDefinition,
} from "./native-effects";

const fill = {
  type: "paint" as const,
  label: "Fill",
  maxCount: 8,
  default: {
    kind: "linear" as const,
    angle: 90,
    interpolation: "in oklab" as const,
    stops: [
      { position: 0, color: catalogColor(0.52, 0.65, 1) },
      { position: 0.24, color: catalogColor(0.94, 0.42, 0.91) },
      { position: 0.36, color: catalogColor(1, 0.38, 0.48) },
      { position: 0.49, color: catalogColor(1, 0.88, 0.25) },
      { position: 0.68, color: catalogColor(1, 0.48, 0.14) },
      { position: 1, color: catalogColor(0.96, 0.33, 0.54) },
    ],
  },
};

function groupedFloat(group: string, ...args: Parameters<typeof catalogFloat>) {
  return { ...catalogFloat(...args), group };
}

const properties = {
  fill,
  timeOffset: groupedFloat("Motion", "Time offset", 0, -30, 30),
  contrast: groupedFloat("Color", "Contrast", 1, 0, 2),
  saturation: groupedFloat("Color", "Saturation", 1, 0, 2),
  hueShift: groupedFloat("Color", "Hue shift", 0, -2 * Math.PI, 2 * Math.PI),
  displacementAmount: groupedFloat("Shape", "Displacement amount", 0.62, 0, 1),
  displacementFrequencyX: groupedFloat(
    "Shape",
    "Displacement frequency X",
    12.7,
    0,
    20,
    0.1,
  ),
  displacementFrequencyY: groupedFloat(
    "Shape",
    "Displacement frequency Y",
    1.1,
    0,
    20,
    0.1,
  ),
  positionX: groupedFloat("Transform", "Position X", 0, -2, 2),
  positionY: groupedFloat("Transform", "Position Y", 0, -2, 2),
  positionZ: groupedFloat("Transform", "Position Z", 0, -2, 2),
  rotationX: groupedFloat(
    "Transform",
    "Rotation X",
    0,
    -2 * Math.PI,
    2 * Math.PI,
  ),
  rotationY: groupedFloat(
    "Transform",
    "Rotation Y",
    0,
    -2 * Math.PI,
    2 * Math.PI,
  ),
  rotationZ: groupedFloat(
    "Transform",
    "Rotation Z",
    0,
    -2 * Math.PI,
    2 * Math.PI,
  ),
  scaleX: groupedFloat("Transform", "Scale X", 1, 0.25, 3),
  scaleY: groupedFloat("Transform", "Scale Y", 1, 0.25, 3),
  scaleZ: groupedFloat("Transform", "Scale Z", 1, 0.25, 3),
  twistX: groupedFloat("Shape", "Twist X", 0.62, -2 * Math.PI, 2 * Math.PI),
  twistY: groupedFloat("Shape", "Twist Y", 2, -2 * Math.PI, 2 * Math.PI),
  twistZ: groupedFloat("Shape", "Twist Z", 0, -2 * Math.PI, 2 * Math.PI),
  foldConcentrationX: groupedFloat("Shape", "Fold tightness X", 0.5, 0, 1),
  foldConcentrationY: groupedFloat("Shape", "Fold tightness Y", 0.12, 0, 1),
  foldConcentrationZ: groupedFloat("Shape", "Fold tightness Z", 0.5, 0, 1),
  glowAmount: groupedFloat("Surface", "Glow amount", 0.45, 0, 2),
  glowSpread: groupedFloat("Surface", "Glow spread", 0.45, 0, 1),
  glowFocus: groupedFloat("Surface", "Glow focus", 0.5, 0, 1),
  lineDensity: groupedFloat("Surface", "Line density", 300, 0, 600, 1),
  lineThickness: groupedFloat("Surface", "Line thickness", 0.5, 0, 1),
  compressionResponse: groupedFloat("Surface", "Compression response", 1, 0, 2),
};

const propertyLayout = planNativePropertyLayout({
  properties,
  uniformPacking: "compact",
});
if (propertyLayout.offsets.fill !== 0)
  throw new Error("Folded Mesh paint must start at uniform zero");

function nativeParam(name: keyof typeof properties): string {
  const offset = propertyLayout.offsets[name];
  if (offset === undefined)
    throw new Error(`Folded Mesh property ${name} is unbound`);
  return `globals.params[${Math.floor(offset / 4)}].${"xyzw"[offset % 4]}`;
}

export const FOLDED_MESH_V2_EFFECT: EffectDefinition = {
  id: "an-native-folded-mesh",
  name: "Folded Mesh",
  version: 2,
  kind: "generator",
  placements: ["fill"],
  uniformPacking: "compact",
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
      id: "folded-surface",
      kind: "render",
      reads: [],
      output: "color",
      mesh: { columns: 128, rows: 96 },
      wgsl: `${NATIVE_GLOBAL_BINDINGS}
${nativeEffectPaintWgsl(propertyLayout.offsets.fill / 4, "foldedFill")}
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) seam: f32,
  @location(3) @interpolate(flat) hueRotation: vec2f,
};
fn rotateX(value: vec3f, sine: f32, cosine: f32) -> vec3f {
  return vec3f(value.x, value.y * cosine - value.z * sine, value.y * sine + value.z * cosine);
}
fn rotateY(value: vec3f, sine: f32, cosine: f32) -> vec3f {
  return vec3f(value.x * cosine + value.z * sine, value.y, -value.x * sine + value.z * cosine);
}
fn rotateZ(value: vec3f, sine: f32, cosine: f32) -> vec3f {
  return vec3f(value.x * cosine - value.y * sine, value.x * sine + value.y * cosine, value.z);
}
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let uv = vec2f(f32(vertexIndex % 129u), f32(vertexIndex / 129u)) / vec2f(128.0, 96.0);
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let size = 0.68;
  let twistX = ${nativeParam("twistX")};
  let twistY = ${nativeParam("twistY")};
  let twistZ = ${nativeParam("twistZ")};
  let depth = ${nativeParam("displacementAmount")};
  let frequencyX = ${nativeParam("displacementFrequencyX")};
  let frequencyY = ${nativeParam("displacementFrequencyY")};
  let foldX = ${nativeParam("foldConcentrationX")};
  let foldY = ${nativeParam("foldConcentrationY")};
  let foldZ = ${nativeParam("foldConcentrationZ")};
  let time = globals.clock.x + ${nativeParam("timeOffset")};
  let deformationStrength = clamp(max(length(vec3f(twistX, twistY, twistZ)) / 2.094, depth / 0.62), 0.0, 1.0);
  let s = uv.y;
  let t = uv.x * 2.0 - 1.0;
  let foldRadius = 0.05 + 0.16 * (1.0 - foldX);
  let foldEnvelope = exp(-t * t / foldRadius);
  let foldEnvelopeT = -2.0 * t * foldEnvelope / foldRadius;
  let foldStrength = 0.85 + 0.66 * foldZ;
  let foldedT = t - deformationStrength * foldStrength * t * foldEnvelope;
  let foldedTT = 1.0 - deformationStrength * foldStrength * (foldEnvelope + t * foldEnvelopeT);
  let pleatPhase = 6.2831853 * (frequencyX * uv.x + frequencyY * s) + time * 0.3;
  let broadPhase = 5.0 * t + 2.0 * s + time * 0.2;
  let pleatWeight = 0.025;
  let ridgeHeight = 0.08 + 0.12 * foldZ;
  let relief = depth * size * (ridgeHeight * foldEnvelope + pleatWeight * sin(pleatPhase) + 0.04 * sin(broadPhase));
  let reliefT = depth * size * (ridgeHeight * foldEnvelopeT + 3.14159265 * frequencyX * pleatWeight * cos(pleatPhase) + 0.2 * cos(broadPhase));
  let reliefS = depth * size * (6.2831853 * frequencyY * pleatWeight * cos(pleatPhase) + 0.08 * cos(broadPhase));
  let across = 1.55 * aspect * size;
  let tailPosition = clamp((s - 0.58) / 0.42, 0.0, 1.0);
  let tail = tailPosition * tailPosition * (3.0 - 2.0 * tailPosition);
  let tailS = select(0.0, 6.0 * tailPosition * (1.0 - tailPosition) / 0.42, s > 0.58 && s < 1.0);
  let longitudinal = (1.75 - 3.3 * s - 1.35 * tail) * size;
  let base = vec3f(across * foldedT, longitudinal, relief);
  let baseT = vec3f(across * foldedTT, 0.0, reliefT);
  let baseS = vec3f(0.0, (-3.3 - 1.35 * tailS) * size, reliefS);
  let turnWidth = 1.0 - 0.75 * foldY;
  let turnStart = 0.5 - 0.5 * turnWidth;
  let turnEnd = 0.5 + 0.5 * turnWidth;
  let turnPosition = clamp((s - turnStart) / turnWidth, 0.0, 1.0);
  let turnProfile = turnPosition * turnPosition * (3.0 - 2.0 * turnPosition);
  let turnProfileS = select(0.0, 6.0 * turnPosition * (1.0 - turnPosition) / turnWidth, s > turnStart && s < turnEnd);
  let hingeRadius = 0.09 + 0.32 * (1.0 - foldX);
  let hingeEnvelope = exp(-t * t / hingeRadius);
  let hingeEnvelopeT = -2.0 * t * hingeEnvelope / hingeRadius;
  let hingePhase = 3.14159265 * s + time * 0.14;
  let hingeStrength = (0.5 + 0.9 * foldZ) * twistY / 2.0;
  let hinge = hingeStrength * t * hingeEnvelope * sin(hingePhase);
  let hingeT = hingeStrength * (hingeEnvelope + t * hingeEnvelopeT) * sin(hingePhase);
  let hingeS = hingeStrength * t * hingeEnvelope * 3.14159265 * cos(hingePhase);
  let turn = twistY * turnProfile + hinge;
  let turnT = hingeT;
  let turnS = twistY * turnProfileS + hingeS;
  let sinTurn = sin(turn);
  let cosTurn = cos(turn);
  let turned = vec3f(base.x * cosTurn + base.z * sinTurn, base.y, -base.x * sinTurn + base.z * cosTurn);
  let turnedT = vec3f(baseT.x * cosTurn + baseT.z * sinTurn, baseT.y, -baseT.x * sinTurn + baseT.z * cosTurn)
    + turnT * vec3f(turned.z, 0.0, -turned.x);
  let turnedS = vec3f(baseS.x * cosTurn + baseS.z * sinTurn, baseS.y, -baseS.x * sinTurn + baseS.z * cosTurn)
    + turnS * vec3f(turned.z, 0.0, -turned.x);
  let curlEnvelope = exp(-t * t / 0.4);
  let curlEnvelopeT = -2.0 * t * curlEnvelope / 0.4;
  let curlPhase = 3.14159265 * s + time * 0.12;
  let bend = twistX * (0.8 * t * curlEnvelope * sin(curlPhase) + 0.22 * sin(2.0 * s + time * 0.15));
  let bendT = twistX * 0.8 * (curlEnvelope + t * curlEnvelopeT) * sin(curlPhase);
  let bendS = twistX * (0.8 * t * curlEnvelope * 3.14159265 * cos(curlPhase) + 0.44 * cos(2.0 * s + time * 0.15));
  let sinBend = sin(bend);
  let cosBend = cos(bend);
  let curled = vec3f(turned.x, turned.y * cosBend - turned.z * sinBend, turned.y * sinBend + turned.z * cosBend);
  let curledT = vec3f(turnedT.x, turnedT.y * cosBend - turnedT.z * sinBend, turnedT.y * sinBend + turnedT.z * cosBend)
    + bendT * vec3f(0.0, -curled.z, curled.y);
  let curledS = vec3f(turnedS.x, turnedS.y * cosBend - turnedS.z * sinBend, turnedS.y * sinBend + turnedS.z * cosBend)
    + bendS * vec3f(0.0, -curled.z, curled.y);
  let roll = twistZ * turnProfile;
  let rolled = rotateZ(curled, sin(roll), cos(roll));
  let rolledT = rotateZ(curledT, sin(roll), cos(roll));
  let rolledS = rotateZ(curledS, sin(roll), cos(roll))
    + twistZ * turnProfileS * vec3f(-rolled.y, rolled.x, 0.0);
  let sweepPhase = 2.0 * s + time * 0.16;
  let sweep = deformationStrength * (0.1 + 1.6 * s - 0.7 * s * s + 0.04 * sin(sweepPhase));
  let sweepS = deformationStrength * (1.6 - 1.4 * s + 0.08 * cos(sweepPhase));
  let axisScale = vec3f(${nativeParam("scaleX")}, ${nativeParam("scaleY")}, ${nativeParam("scaleZ")});
  let scaled = (rolled + vec3f(sweep * aspect * size, 0.0, 0.0)) * axisScale;
  let scaledT = rolledT * axisScale;
  let scaledS = (rolledS + vec3f(sweepS * aspect * size, 0.0, 0.0)) * axisScale;
  let rx = ${nativeParam("rotationX")};
  let ry = ${nativeParam("rotationY")};
  let rz = ${nativeParam("rotationZ")};
  let world = rotateZ(rotateY(rotateX(scaled, sin(rx), cos(rx)), sin(ry), cos(ry)), sin(rz), cos(rz))
    + vec3f(2.0 * aspect * ${nativeParam("positionX")}, -2.0 * ${nativeParam("positionY")}, 2.0 * ${nativeParam("positionZ")});
  let tangentT = rotateZ(rotateY(rotateX(scaledT, sin(rx), cos(rx)), sin(ry), cos(ry)), sin(rz), cos(rz));
  let tangentS = rotateZ(rotateY(rotateX(scaledS, sin(rx), cos(rx)), sin(ry), cos(ry)), sin(rz), cos(rz));
  let surface = cross(tangentT, tangentS);
  let camera = 10.0 + 9.0 * max(aspect, 1.0);
  let viewDepth = camera - world.z;
  let nearPlane = 0.1;
  let farPlane = camera * 2.5;
  var output: VertexOutput;
  output.position = vec4f(
    world.x * camera / aspect,
    world.y * camera,
    farPlane / (farPlane - nearPlane) * viewDepth - farPlane * nearPlane / (farPlane - nearPlane),
    viewDepth
  );
  output.uv = uv;
  output.normal = surface / max(length(surface), 1e-12);
  output.seam = t;
  let hue = ${nativeParam("hueShift")};
  output.hueRotation = vec2f(cos(hue), sin(hue));
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let paint = foldedFill(input.uv, globals.viewport.xy);
  let oriented = select(input.normal, -input.normal, input.normal.z < 0.0);
  let normal = oriented / max(length(oriented), 1e-12);
  let light = normalize(vec3f(-0.36, 0.55, 0.75));
  let diffuse = max(dot(normal, light), 0.0);
  let reflection = pow(diffuse, 20.0);
  let sourceColor = paint.rgb / max(paint.a, 1e-5);
  let hueAxis = vec3f(0.577350269);
  let shiftedColor = sourceColor * input.hueRotation.x
    + cross(hueAxis, sourceColor) * input.hueRotation.y
    + hueAxis * dot(hueAxis, sourceColor) * (1.0 - input.hueRotation.x);
  let luma = dot(shiftedColor, vec3f(0.2126, 0.7152, 0.0722));
  let saturated = mix(vec3f(luma), shiftedColor, ${nativeParam("saturation")});
  let color = clamp((saturated - vec3f(0.5)) * ${nativeParam("contrast")} + vec3f(0.5), vec3f(0.0), vec3f(1.0));
  let lineDensity = ${nativeParam("lineDensity")};
  let fiberPhase = 6.2831853 * lineDensity * input.uv.x + input.uv.y * 34.0
    + 7.0 * sin(input.uv.x * 29.0 + input.uv.y * 8.0 + (globals.clock.x + ${nativeParam("timeOffset")}) * 0.12);
  let fiberAA = 1.0 - smoothstep(1.2, 3.2, fwidth(fiberPhase));
  let fiberEnvelope = smoothstep(0.02, 0.24, input.uv.x)
    * (1.0 - smoothstep(0.76, 0.98, input.uv.x));
  let lineThickness = ${nativeParam("lineThickness")};
  let lineThreshold = 0.92 - 0.84 * lineThickness;
  let fiber = smoothstep(lineThreshold, 1.0, 0.5 + 0.5 * sin(fiberPhase))
    * (0.88 + 0.12 * sin(input.uv.y * 19.0 + input.uv.x * 13.0))
    * fiberAA * fiberEnvelope * min(lineDensity, 1.0) * smoothstep(0.0, 0.04, lineThickness);
  let seamWidth = 0.004 + 0.048 * ${nativeParam("glowSpread")};
  let seam = pow(exp(-input.seam * input.seam / seamWidth), 0.3 + 1.4 * ${nativeParam("glowFocus")});
  let compression = length(vec2f(dpdx(input.uv.x), dpdy(input.uv.x))) * globals.viewport.x;
  let turnGlow = smoothstep(1.3, 4.5, compression) * ${nativeParam("compressionResponse")};
  let illumination = 0.91 + 0.16 * diffuse + 0.12 * fiber;
  let glow = ${nativeParam("glowAmount")} / 0.45;
  let rgb = paint.a * color * illumination
    + paint.a * glow * (vec3f(0.12) * reflection + vec3f(0.08) * seam + vec3f(0.06) * turnGlow);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(paint.a)), paint.a);
}
`,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original vertex-deformed folded surface with packed native paint.",
  },
};
