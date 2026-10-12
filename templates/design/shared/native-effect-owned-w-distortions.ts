import {
  CATALOG_EDGE,
  catalogFloat,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import { OWNED_NEXT_PROCESSOR_DEFINITIONS } from "./native-effect-owned-next-b";
import { OWNED_NEXT_FOUR_H_DEFINITIONS } from "./native-effect-owned-next-four-h";
import { OWNED_NEXT_TWELVE_S_DEFINITIONS } from "./native-effect-owned-next-twelve-s";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "./native-effects";

type Look = readonly [string, Record<string, EffectValue>];
type Draft = CatalogShaderSpec & {
  mechanism: string;
  looks: readonly [Look, Look];
};
const f = (
  label: string,
  value: number,
  min: number,
  max: number,
): EffectProperty => catalogFloat(label, value, min, max);
const unit = (label: string, value: number): EffectProperty =>
  f(label, value, 0, 1);
const angle = (label: string, value: number): EffectProperty =>
  f(label, value, -180, 180);

function predecessor(
  definitions: readonly EffectDefinition[],
  id: string,
): EffectDefinition {
  const found = definitions.find((definition) => definition.id === id);
  if (!found || found.version !== 1)
    throw new Error(`The frozen ${id} predecessor is unavailable`);
  return found;
}
const corner = predecessor(
  OWNED_NEXT_PROCESSOR_DEFINITIONS,
  "an-native-owned-corner-perspective",
);
const polar = predecessor(
  OWNED_NEXT_FOUR_H_DEFINITIONS,
  "an-native-owned-log-polar-reprojection",
);
const bend = predecessor(
  OWNED_NEXT_TWELVE_S_DEFINITIONS,
  "an-native-owned-s-parabolic-bend",
);

export const OWNED_W_DISTORTION_DRAFTS: readonly Draft[] = [
  {
    id: "owned-w-axis-mirror",
    name: "Axis Mirror",
    kind: "processor",
    backdrop: true,
    edgeSampling: "repeat-mirror-bilinear-v2",
    mechanism:
      "Reflects one half-plane across a movable, freely rotated line while preserving the opposite half.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      centerX: unit("Center X", 0.5),
      centerY: unit("Center Y", 0.5),
      angle: angle("Mirror angle", 0),
      side: {
        type: "enum",
        label: "Mirrored side",
        default: "positive",
        options: ["positive", "negative"],
      },
      blend: unit("Blend", 1),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  let extent = globals.viewport.xy / globals.clock.z;
  let center = vec2f(${p("centerX")}.x, ${p("centerY")}.x) * extent;
  let radians = ${p("angle")}.x * PI / 180.0;
  let normal = vec2f(-sin(radians), cos(radians));
  let distance = dot(input.uv * extent - center, normal);
  let selected = select(-distance, distance, u32(${p("side")}.x) == 0u);
  if (selected <= 0.0 || ${p("blend")}.x <= 0.0) { return original; }
  let reflected = (input.uv * extent - 2.0 * distance * normal) / extent;
  return mix(original, sampleSource(reflected), ${p("blend")}.x);`,
    looks: [
      ["Horizontal reflection", { angle: 0, centerY: 0.5 }],
      ["Diagonal reflection", { angle: 42, centerX: 0.43, blend: 0.9 }],
    ],
  },
  {
    id: "owned-w-elastic-stretch",
    name: "Elastic Stretch",
    kind: "processor",
    backdrop: true,
    edgeSampling: "repeat-mirror-bilinear-v2",
    mechanism:
      "Inverse-samples a directional stretch with compact radial falloff; pixels outside the selected radius stay fixed.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      centerX: unit("Center X", 0.5),
      centerY: unit("Center Y", 0.5),
      angle: angle("Stretch angle", 0),
      radius: f("Stretch radius", 0.36, 0.05, 0.8),
      strength: f("Stretch strength", 0.5, -0.9, 2),
    },
    fragment: (p) => `
  let extent = globals.viewport.xy / globals.clock.z;
  let center = vec2f(${p("centerX")}.x, ${p("centerY")}.x) * extent;
  let radius = ${p("radius")}.x * min(extent.x, extent.y);
  let ray = input.uv * extent - center;
  let reach = length(ray) / radius;
  if (reach >= 1.0 || ${p("strength")}.x == 0.0) { return sampleSource(input.uv); }
  let radians = ${p("angle")}.x * PI / 180.0;
  let axis = vec2f(cos(radians), sin(radians));
  let parallel = dot(ray, axis);
  let weight = 1.0 - reach * reach;
  let scale = max(1.0 + ${p("strength")}.x * weight * weight, 0.1);
  return sampleSource((center + ray - axis * parallel * (1.0 - 1.0 / scale)) / extent);`,
    looks: [
      ["Wide pull", { radius: 0.55, strength: 0.55 }],
      ["Tight compression", { angle: 65, radius: 0.28, strength: -0.55 }],
    ],
  },
  {
    id: "owned-w-lit-spherize",
    name: "Lit Spherize",
    kind: "processor",
    backdrop: true,
    edgeSampling: "repeat-mirror-bilinear-v2",
    mechanism:
      "Wraps source pixels over a hemispherical disk and shades its analytic normal with a movable light; exterior pixels stay unchanged.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      centerX: unit("Center X", 0.5),
      centerY: unit("Center Y", 0.5),
      radius: f("Sphere radius", 0.34, 0.08, 0.48),
      depth: unit("Sphere depth", 0.7),
      lightAngle: angle("Light angle", -35),
      lightHeight: unit("Light height", 0.72),
      lighting: unit("Lighting", 0.55),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  let extent = globals.viewport.xy / globals.clock.z;
  let center = vec2f(${p("centerX")}.x, ${p("centerY")}.x) * extent;
  let radius = ${p("radius")}.x * min(extent.x, extent.y);
  let disk = (input.uv * extent - center) / radius;
  let r2 = dot(disk, disk);
  if (r2 >= 1.0 || ${p("depth")}.x <= 0.0) { return original; }
  let z = sqrt(max(1.0 - r2, 0.00001));
  let surfaceRadius = asin(sqrt(r2)) / max(sqrt(r2), 0.00001);
  let mapped = center + mix(disk, disk * surfaceRadius, ${p("depth")}.x) * radius;
  let sampled = sampleSource(mapped / extent);
  let radians = ${p("lightAngle")}.x * PI / 180.0;
  let light = normalize(vec3f(cos(radians), sin(radians), 0.2 + ${p("lightHeight")}.x * 1.8));
  let normal = normalize(vec3f(disk, z));
  let diffuse = max(dot(normal, light), 0.0);
  let halfVector = normalize(light + vec3f(0.0, 0.0, 1.0));
  let sheen = pow(max(dot(normal, halfVector), 0.0), 24.0) * 0.25;
  let illumination = mix(1.0, 0.38 + diffuse * 0.62 + sheen, ${p("lighting")}.x);
  let lit = vec4f(sampled.rgb * illumination, sampled.a);
  return mix(original, lit, (1.0 - smoothstep(0.93, 1.0, sqrt(r2))) * ${p("depth")}.x);`,
    looks: [
      ["Soft hemisphere", { depth: 0.55, lighting: 0.35 }],
      [
        "Raking light",
        { depth: 1, lightAngle: 48, lightHeight: 0.3, lighting: 0.9 },
      ],
    ],
  },
  {
    id: "owned-log-polar-reprojection",
    version: 2,
    name: polar.name,
    kind: "processor",
    backdrop: polar.placements.includes("backdrop"),
    mechanism:
      "Adds linear-radius unwrapping to the geometric log-radius map while retaining its center, rotation, blend, and edge controls.",
    properties: {
      ...polar.properties,
      radialSpacing: {
        type: "enum",
        label: "Radial spacing",
        default: "logarithmic",
        options: ["logarithmic", "linear"],
      },
    },
    fragment: (p) => `
  let amount = ${p("amount")}.x;
  if (amount <= 0.0) { return sampleSource(input.uv); }
  let inner = ${p("innerRadius")}.x;
  let outer = max(${p("outerRadius")}.x, inner + 0.001);
  let angle = input.uv.x * TAU + ${p("rotation")}.x;
  let logRadius = inner * pow(outer / inner, input.uv.y);
  let linearRadius = mix(inner, outer, input.uv.y);
  let radius = select(logRadius, linearRadius, u32(${p("radialSpacing")}.x) == 1u);
  let mapped = vec2f(${p("centerX")}.x, ${p("centerY")}.x) + radius * vec2f(cos(angle), sin(angle));
  return sampleSource(mix(input.uv, mapped, amount));`,
    looks: [
      [
        "Circular strip",
        { radialSpacing: "linear", innerRadius: 0.02, outerRadius: 0.58 },
      ],
      [
        "Wide angular map",
        {
          radialSpacing: "linear",
          innerRadius: 0.16,
          outerRadius: 0.9,
          rotation: 0.55,
        },
      ],
    ],
  },
  {
    id: "owned-s-parabolic-bend",
    version: 2,
    name: bend.name,
    kind: "processor",
    backdrop: bend.placements.includes("backdrop"),
    mechanism:
      "Generalizes the horizontal parabolic bend to a freely rotated axis with a finite influence, preserving its older exact version.",
    properties: {
      ...bend.properties,
      bendAngle: angle("Bend angle", 0),
      influence: f("Bend influence", 1, 0.05, 1),
    },
    fragment: (p) => `
  let radians = ${p("bendAngle")}.x * PI / 180.0;
  let axis = vec2f(-sin(radians), cos(radians));
  let normal = vec2f(axis.y, -axis.x);
  let ray = input.uv - vec2f(0.5, ${p("anchor")}.x);
  let along = dot(ray, axis);
  let across = dot(ray, normal);
  let influence = 1.0 - smoothstep(${p("influence")}.x * 0.5, ${p("influence")}.x, abs(across));
  let displacement = ${p("curvature")}.x * along * abs(along) * (1.0 + ${p("taper")}.x * along) * influence;
  return sampleSource(input.uv - normal * displacement);`,
    looks: [
      ["Local bow", { curvature: 0.48, bendAngle: 20, influence: 0.35 }],
      ["Diagonal arch", { curvature: -0.7, bendAngle: -42, influence: 0.65 }],
    ],
  },
  {
    id: "owned-corner-perspective",
    version: 2,
    name: corner.name,
    kind: "processor",
    backdrop: corner.placements.includes("backdrop"),
    mechanism:
      "Adds a camera control mode with yaw, pitch, field of view, pan, and zoom to the existing four-corner planar homography.",
    properties: {
      edge: corner.properties.edge!,
      topLeft: {
        ...corner.properties.topLeft!,
        visibleWhen: { property: "viewMode", equals: "corners" },
      },
      topRight: {
        ...corner.properties.topRight!,
        visibleWhen: { property: "viewMode", equals: "corners" },
      },
      bottomRight: {
        ...corner.properties.bottomRight!,
        visibleWhen: { property: "viewMode", equals: "corners" },
      },
      bottomLeft: {
        ...corner.properties.bottomLeft!,
        visibleWhen: { property: "viewMode", equals: "corners" },
      },
      viewMode: {
        type: "enum",
        label: "Perspective mode",
        default: "corners",
        options: ["corners", "camera"],
      },
      yaw: {
        ...angle("Camera yaw", 0),
        visibleWhen: { property: "viewMode", equals: "camera" },
      },
      pitch: {
        ...angle("Camera pitch", 0),
        visibleWhen: { property: "viewMode", equals: "camera" },
      },
      fieldOfView: {
        ...f("Field of view", 55, 20, 100),
        visibleWhen: { property: "viewMode", equals: "camera" },
      },
      zoom: {
        ...f("Camera zoom", 1, 0.4, 3),
        visibleWhen: { property: "viewMode", equals: "camera" },
      },
      panX: {
        ...f("Camera pan X", 0, -1, 1),
        visibleWhen: { property: "viewMode", equals: "camera" },
      },
      panY: {
        ...f("Camera pan Y", 0, -1, 1),
        visibleWhen: { property: "viewMode", equals: "camera" },
      },
    },
    fragment: (p) => `
  if (u32(${p("viewMode")}.x) == 1u) {
    let yaw = ${p("yaw")}.x * PI / 180.0;
    let pitch = ${p("pitch")}.x * PI / 180.0;
    let right = vec3f(cos(yaw), 0.0, sin(yaw));
    let up = vec3f(sin(yaw) * sin(pitch), cos(pitch), -cos(yaw) * sin(pitch));
    let normal = cross(right, up);
    let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
    let focal = tan(${p("fieldOfView")}.x * PI / 360.0);
    let screen = (input.uv - vec2f(0.5)) * 2.0;
    let ray = normalize(vec3f(screen.x * aspect * focal, screen.y * focal, -1.0));
    let denominator = dot(ray, normal);
    if (abs(denominator) < 0.00001) { return vec4f(0.0); }
    let distance = -normal.z / denominator;
    if (distance <= 0.0) { return vec4f(0.0); }
    let hit = vec3f(0.0, 0.0, 1.0) + ray * distance;
    let mapped = vec2f(dot(hit, right), dot(hit, up)) / ${p("zoom")}.x +
      vec2f(0.5 + ${p("panX")}.x, 0.5 + ${p("panY")}.x);
    return sampleSource(mapped);
  }
  let p0 = ${p("topLeft")}.xy; let p1 = ${p("topRight")}.xy;
  let p2 = ${p("bottomRight")}.xy; let p3 = ${p("bottomLeft")}.xy;
  let d1 = p1 - p2; let d2 = p3 - p2;
  let d3 = p0 - p1 + p2 - p3;
  let determinant = d1.x * d2.y - d2.x * d1.y;
  if (abs(determinant) < 0.00001) { return vec4f(0.0); }
  let g = (d3.x * d2.y - d2.x * d3.y) / determinant;
  let h = (d1.x * d3.y - d3.x * d1.y) / determinant;
  let a = p1.x - p0.x + g * p1.x; let b = p3.x - p0.x + h * p3.x;
  let d = p1.y - p0.y + g * p1.y; let e = p3.y - p0.y + h * p3.y;
  let ax = a - input.uv.x * g; let bx = b - input.uv.x * h;
  let dy = d - input.uv.y * g; let ey = e - input.uv.y * h;
  let rhs = input.uv - p0;
  let inverseDet = ax * ey - bx * dy;
  if (abs(inverseDet) < 0.00001) { return vec4f(0.0); }
  let sourceUv = vec2f((rhs.x * ey - bx * rhs.y) / inverseDet,
    (ax * rhs.y - rhs.x * dy) / inverseDet);
  if (any(sourceUv < vec2f(0.0)) || any(sourceUv > vec2f(1.0))) { return vec4f(0.0); }
  return sampleSource(sourceUv);`,
    looks: [
      ["Camera yaw", { viewMode: "camera", yaw: 27, fieldOfView: 55 }],
      [
        "Raised viewpoint",
        {
          viewMode: "camera",
          yaw: -18,
          pitch: 29,
          fieldOfView: 68,
          zoom: 1.35,
        },
      ],
    ],
  },
];

export const OWNED_W_DISTORTION_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_W_DISTORTION_DRAFTS.map((draft) => {
    const base = catalogShader(draft);
    return {
      ...base,
      resources: base.resources?.map((resource) =>
        resource.name === "color"
          ? { ...resource, format: "rgba16float" }
          : resource,
      ),
      provenance: { origin: "design-original", note: draft.mechanism },
    };
  });

export const OWNED_W_DISTORTION_PRESETS: readonly EffectPreset[] =
  OWNED_W_DISTORTION_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-v${draft.version ?? 1}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: draft.version ?? 1,
      placement: "layer" as const,
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
