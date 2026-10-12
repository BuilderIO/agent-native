import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const scene = `${NATIVE_RENDER_GLOBALS}
fn rotateX(p: vec3f, angle: f32) -> vec3f {
  let c = cos(angle); let s = sin(angle);
  return vec3f(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}
fn rotateY(p: vec3f, angle: f32) -> vec3f {
  let c = cos(angle); let s = sin(angle);
  return vec3f(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}
fn objectRay(uv: vec2f, yaw: f32, pitch: f32) -> mat3x3f {
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let screen = (uv - 0.5) * vec2f(2.0 * aspect, 2.0);
  let origin = rotateX(rotateY(vec3f(0.0, 0.0, 3.0), -yaw), -pitch);
  let direction = normalize(rotateX(rotateY(normalize(vec3f(screen * 0.85, -2.4)), -yaw), -pitch));
  return mat3x3f(origin, direction, vec3f(0.0));
}
fn slab(origin: vec3f, direction: vec3f, low: vec3f, high: vec3f) -> vec2f {
  let safe = select(direction, vec3f(0.000001), abs(direction) < vec3f(0.000001));
  let a = (low - origin) / safe;
  let b = (high - origin) / safe;
  let near = min(a, b);
  let far = max(a, b);
  return vec2f(max(max(near.x, near.y), near.z), min(min(far.x, far.y), far.z));
}
fn sourceAt(uv: vec2f) -> vec4f {
  return textureSampleLevel(sourceTexture, effectSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn sourceLuma(sample: vec4f) -> f32 {
  return dot(sample.rgb / max(sample.a, 0.00001), vec3f(0.2126, 0.7152, 0.0722));
}
fn lightDirection(angle: f32) -> vec3f {
  return normalize(vec3f(cos(angle), -0.5, sin(angle) + 0.6));
}
fn lit(normal: vec3f, angle: f32, shine: f32) -> f32 {
  let diffuse = max(dot(normal, lightDirection(angle)), 0.0);
  let highlight = pow(max(dot(reflect(-lightDirection(angle), normal), vec3f(0.0, 0.0, 1.0)), 0.0), 8.0 + shine * 72.0);
  return 0.28 + diffuse * 0.62 + highlight * shine * 0.55;
}
`;

const formWgsl = `${scene}
fn formDistance(p: vec3f, depth: f32, curve: f32) -> f32 {
  let radial = length(p.xy / vec2f(0.83, 0.62));
  let front = depth + curve * (1.0 - min(radial * radial, 2.0));
  return max((radial - 1.0) * 0.62, max(p.z - front, -depth - p.z));
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let depth = globals.params[0].x;
  let curve = globals.params[1].x;
  let ray = objectRay(input.uv, globals.params[2].x, globals.params[3].x);
  let origin = ray[0]; let direction = ray[1];
  let bounds = slab(origin, direction, vec3f(-0.9, -0.7, -0.8), vec3f(0.9, 0.7, 1.25));
  if (bounds.x > bounds.y || bounds.y < 0.0) { return vec4f(0.0); }
  var distance = max(bounds.x, 0.0);
  var hit = false;
  for (var step = 0; step < 48; step += 1) {
    let point = origin + direction * distance;
    let surface = formDistance(point, depth, curve);
    if (surface < 0.0025) { hit = true; break; }
    distance += max(surface * 0.78, 0.004);
    if (distance > bounds.y) { break; }
  }
  if (!hit) { return vec4f(0.0); }
  let point = origin + direction * distance;
  let e = 0.003;
  let normal = normalize(vec3f(
    formDistance(point + vec3f(e, 0.0, 0.0), depth, curve) - formDistance(point - vec3f(e, 0.0, 0.0), depth, curve),
    formDistance(point + vec3f(0.0, e, 0.0), depth, curve) - formDistance(point - vec3f(0.0, e, 0.0), depth, curve),
    formDistance(point + vec3f(0.0, 0.0, e), depth, curve) - formDistance(point - vec3f(0.0, 0.0, e), depth, curve)
  ));
  let uv = point.xy / vec2f(1.66, 1.24) + 0.5;
  let source = sourceAt(uv);
  let sideShade = select(1.0, 0.68, abs(normal.z) < 0.45);
  let alpha = source.a * globals.params[6].x;
  return vec4f(source.rgb * (lit(normal, globals.params[4].x, globals.params[5].x) * sideShade) * globals.params[6].x, alpha);
}`;

const surfaceWgsl = `${scene}
fn surfaceHeight(uv: vec2f) -> f32 {
  let source = sourceAt(uv);
  let pigment = sourceLuma(source) * source.a;
  let drape = sin(uv.x * globals.params[2].x * 6.2831853) * cos(uv.y * globals.params[2].x * 3.1415927);
  return -0.35 + pigment * globals.params[0].x + drape * globals.params[1].x;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let ray = objectRay(input.uv, globals.params[3].x, globals.params[4].x);
  let origin = ray[0]; let direction = ray[1];
  let bounds = slab(origin, direction, vec3f(-1.0, -1.0, -0.8), vec3f(1.0, 1.0, 1.2));
  if (bounds.x > bounds.y || bounds.y < 0.0) { return vec4f(0.0); }
  var distance = max(bounds.x, 0.0);
  var hit = false;
  for (var step = 0; step < 48; step += 1) {
    let point = origin + direction * distance;
    let uv = point.xy * 0.5 + 0.5;
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { break; }
    let height = surfaceHeight(uv);
    if (point.z <= height && sourceAt(uv).a > 0.02) { hit = true; break; }
    distance += max((point.z - height) * 0.62, 0.012);
    if (distance > bounds.y) { break; }
  }
  if (!hit) { return vec4f(0.0); }
  let point = origin + direction * distance;
  let uv = point.xy * 0.5 + 0.5;
  let pixel = vec2f(1.0) / max(globals.viewport.xy, vec2f(1.0));
  let normal = normalize(vec3f(
    -(surfaceHeight(uv + vec2f(pixel.x, 0.0)) - surfaceHeight(uv - vec2f(pixel.x, 0.0))) / max(pixel.x * 4.0, 0.00001),
    -(surfaceHeight(uv + vec2f(0.0, pixel.y)) - surfaceHeight(uv - vec2f(0.0, pixel.y))) / max(pixel.y * 4.0, 0.00001),
    1.0
  ));
  let source = sourceAt(uv);
  let alpha = source.a * globals.params[6].x;
  return vec4f(source.rgb * lit(normal, globals.params[5].x, 0.35) * globals.params[6].x, alpha);
}`;

const voxelsWgsl = `${scene}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let grid = i32(clamp(round(globals.params[0].x), 8.0, 32.0));
  let cellWidth = 2.0 / f32(grid);
  let ray = objectRay(input.uv, globals.params[3].x, globals.params[4].x);
  let origin = ray[0]; let direction = ray[1];
  let bounds = slab(origin, direction, vec3f(-1.0, -1.0, -0.5), vec3f(1.0, 1.0, 0.85));
  if (bounds.x > bounds.y || bounds.y < 0.0) { return vec4f(0.0); }
  var travel = max(bounds.x, 0.0);
  let start = origin + direction * (travel + 0.0001);
  var cell = clamp(vec2i(floor((start.xy + 1.0) / cellWidth)), vec2i(0), vec2i(grid - 1));
  let directionStep = vec2i(select(-1, 1, direction.x >= 0.0), select(-1, 1, direction.y >= 0.0));
  // A ray can cross at most 2 * 32 - 1 cells in this two-axis grid.
  for (var step = 0; step < 64; step += 1) {
    if (any(cell < vec2i(0)) || any(cell >= vec2i(grid)) || travel > bounds.y) { break; }
    let lowXY = vec2f(cell) * cellWidth - 1.0;
    let centerUv = (vec2f(cell) + 0.5) / f32(grid);
    let source = sourceAt(centerUv);
    if (source.a > 0.025) {
      let luma = sourceLuma(source);
      let height = (0.08 + pow(clamp(luma, 0.0, 1.0), globals.params[2].x) * 0.92) * globals.params[1].x;
      let low = vec3f(lowXY + vec2f(cellWidth * 0.08), -0.5);
      let high = vec3f(lowXY + vec2f(cellWidth * 0.92), -0.5 + height);
      let hit = slab(origin, direction, low, high);
      if (hit.x <= hit.y && hit.y >= 0.0 && hit.x >= travel - 0.002 && hit.x <= bounds.y) {
        let point = origin + direction * max(hit.x, 0.0);
        let face = min(point - low, high - point);
        var normal = vec3f(0.0, 0.0, 1.0);
        if (min(face.x, face.y) < face.z) {
          if (face.x < face.y) { normal = vec3f(select(1.0, -1.0, point.x - low.x < high.x - point.x), 0.0, 0.0); }
          else { normal = vec3f(0.0, select(1.0, -1.0, point.y - low.y < high.y - point.y), 0.0); }
        }
        let alpha = source.a * globals.params[6].x;
        return vec4f(source.rgb * lit(normal, globals.params[5].x, 0.25) * globals.params[6].x, alpha);
      }
    }
    let nextX = select(lowXY.x, lowXY.x + cellWidth, direction.x >= 0.0);
    let nextY = select(lowXY.y, lowXY.y + cellWidth, direction.y >= 0.0);
    let timeX = select(1000000.0, (nextX - origin.x) / direction.x, abs(direction.x) > 0.000001);
    let timeY = select(1000000.0, (nextY - origin.y) / direction.y, abs(direction.y) > 0.000001);
    if (timeX < timeY) { travel = timeX; cell.x += directionStep.x; }
    else { travel = timeY; cell.y += directionStep.y; }
  }
  return vec4f(0.0);
}`;

const float = (label: string, value: number, min: number, max: number) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step: 0.01,
});
const integer = (label: string, value: number, min: number, max: number) => ({
  type: "int" as const,
  label,
  default: value,
  min,
  max,
  step: 1,
});

const shared = {
  inputs: { source: { kind: "texture-2d" as const, resource: "source" } },
  outputs: { color: { kind: "texture-2d" as const, resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d" as const,
      usage: ["sampled" as const],
      external: true,
      size: "viewport" as const,
    },
    {
      name: "color",
      kind: "texture-2d" as const,
      format: "rgba16float" as const,
      usage: ["render" as const, "sampled" as const],
      size: "viewport" as const,
    },
  ],
  output: "color",
};

const definitions: EffectDefinition[] = [
  {
    ...shared,
    id: "an-native-owned-ak-content-form-3d",
    name: "Content Form 3D",
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties: {
      depth: float("Extrusion depth", 0.27, 0.08, 0.65),
      curvature: float("Face curvature", 0.22, 0, 0.55),
      yaw: float("Horizontal orbit", 0.36, -1.2, 1.2),
      pitch: float("Vertical orbit", -0.2, -0.8, 0.8),
      lightAngle: float("Light angle", 0.72, -3.14, 3.14),
      shine: float("Surface shine", 0.35, 0, 1),
      opacity: float("Opacity", 1, 0, 1),
    },
    passes: [
      {
        id: "render",
        kind: "render",
        reads: ["source"],
        output: "color",
        wgsl: formWgsl,
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original bounded signed-distance extrusion: source pixels wrap a curved face and side wall under orbiting view and normal lighting.",
    },
  },
  {
    ...shared,
    id: "an-native-owned-ak-content-surface-3d",
    name: "Content Surface 3D",
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties: {
      elevation: float("Image elevation", 0.65, 0.1, 1.1),
      drape: float("Drape amplitude", 0.14, 0, 0.4),
      frequency: float("Drape folds", 2.3, 0.5, 6),
      yaw: float("Horizontal orbit", 0.3, -1.0, 1.0),
      pitch: float("Vertical orbit", -0.35, -0.8, 0.8),
      lightAngle: float("Light angle", 0.72, -3.14, 3.14),
      opacity: float("Opacity", 1, 0, 1),
    },
    passes: [
      {
        id: "render",
        kind: "render",
        reads: ["source"],
        output: "color",
        wgsl: surfaceWgsl,
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original source-luminance height field with draped folds, ray intersection, finite-difference normals, and orbiting camera.",
    },
  },
  {
    ...shared,
    id: "an-native-owned-ak-source-voxels",
    name: "Source Voxels",
    version: 1,
    kind: "processor",
    placements: ["layer", "backdrop"],
    properties: {
      grid: integer("Grid cells", 24, 8, 32),
      height: float("Voxel height", 0.72, 0.15, 1.3),
      contrast: float("Height contrast", 1.4, 0.35, 3),
      yaw: float("Horizontal orbit", 0.45, -1.0, 1.0),
      pitch: float("Vertical orbit", -0.34, -0.8, 0.8),
      lightAngle: float("Light angle", 0.72, -3.14, 3.14),
      opacity: float("Opacity", 1, 0, 1),
    },
    passes: [
      {
        id: "render",
        kind: "render",
        reads: ["source"],
        output: "color",
        wgsl: voxelsWgsl,
      },
    ],
    provenance: {
      origin: "design-original",
      note: "Original perspective grid traversal of alpha-aware cuboids: each source cell supplies its color and luminance-derived height.",
    },
  },
];

export const AK_SOURCE_3D_DEFINITIONS: readonly EffectDefinition[] =
  definitions;

export const AK_SOURCE_3D_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-ak-curved-banner",
    name: "Curved Banner",
    definitionId: definitions[0].id,
    definitionVersion: 1,
    placement: "layer",
    clip: "bounds",
    params: {
      depth: 0.22,
      curvature: 0.34,
      yaw: 0.28,
      pitch: -0.16,
      shine: 0.25,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ak-carved-plaque",
    name: "Carved Plaque",
    definitionId: definitions[0].id,
    definitionVersion: 1,
    placement: "backdrop",
    clip: "bounds",
    params: {
      depth: 0.52,
      curvature: 0.06,
      yaw: -0.48,
      pitch: -0.25,
      shine: 0.7,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ak-topographic-cloth",
    name: "Topographic Cloth",
    definitionId: definitions[1].id,
    definitionVersion: 1,
    placement: "layer",
    clip: "bounds",
    params: {
      elevation: 0.77,
      drape: 0.13,
      frequency: 2.2,
      yaw: 0.34,
      pitch: -0.43,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ak-draped-poster",
    name: "Draped Poster",
    definitionId: definitions[1].id,
    definitionVersion: 1,
    placement: "backdrop",
    clip: "bounds",
    params: {
      elevation: 0.35,
      drape: 0.28,
      frequency: 4.2,
      yaw: -0.2,
      pitch: -0.23,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ak-voxel-relief",
    name: "Voxel Relief",
    definitionId: definitions[2].id,
    definitionVersion: 1,
    placement: "layer",
    clip: "bounds",
    params: { grid: 28, height: 0.84, contrast: 1.3, yaw: 0.45, pitch: -0.35 },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-ak-block-city",
    name: "Block City",
    definitionId: definitions[2].id,
    definitionVersion: 1,
    placement: "backdrop",
    clip: "bounds",
    params: { grid: 16, height: 1.12, contrast: 2.1, yaw: -0.4, pitch: -0.5 },
    provenance: { origin: "design-original" },
  },
];

export const AK_SOURCE_3D_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  AK_SOURCE_3D_PRESETS.map((preset) => [preset.id, preset.id]),
);
