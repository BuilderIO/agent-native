import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const voxelWgsl = `${NATIVE_RENDER_GLOBALS}
fn rotateX(point: vec3f, angle: f32) -> vec3f {
  let c = cos(angle); let s = sin(angle);
  return vec3f(point.x, point.y * c - point.z * s, point.y * s + point.z * c);
}
fn rotateY(point: vec3f, angle: f32) -> vec3f {
  let c = cos(angle); let s = sin(angle);
  return vec3f(point.x * c + point.z * s, point.y, -point.x * s + point.z * c);
}
fn cellColor(cell: vec2i, grid: i32) -> vec4f {
  if (any(cell < vec2i(0)) || any(cell >= vec2i(grid))) { return vec4f(0.0); }
  let uv = (vec2f(cell) + 0.5) / f32(grid);
  return textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
}
fn cellHeight(cell: vec2i, grid: i32) -> f32 {
  let source = cellColor(cell, grid);
  if (source.a <= 0.025) { return -0.6; }
  let straight = source.rgb / max(source.a, 0.00001);
  let luma = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
  let relief = pow(clamp(luma, 0.0, 1.0), globals.params[2].x);
  return -0.6 + (0.12 + relief * 0.88) * globals.params[1].x;
}
fn slab(origin: vec3f, direction: vec3f, low: vec3f, high: vec3f) -> vec2f {
  let safe = select(direction, vec3f(0.000001), abs(direction) < vec3f(0.000001));
  let nearPlane = min((low - origin) / safe, (high - origin) / safe);
  let farPlane = max((low - origin) / safe, (high - origin) / safe);
  return vec2f(max(max(nearPlane.x, nearPlane.y), nearPlane.z), min(min(farPlane.x, farPlane.y), farPlane.z));
}
fn cellAt(point: vec3f, grid: i32) -> vec2i {
  return vec2i(floor((point.xy + 1.0) * (f32(grid) * 0.5)));
}
fn shadow(point: vec3f, light: vec3f, grid: i32) -> f32 {
  var blocked = 0.0;
  for (var step = 1; step <= 16; step += 1) {
    let travel = f32(step) * 0.055;
    let position = point + light * travel;
    let cell = cellAt(position, grid);
    let height = cellHeight(cell, grid);
    if (height > position.z + 0.015) {
      blocked = max(blocked, 1.0 - f32(step) / 18.0);
    }
  }
  return blocked;
}
fn ambientOcclusion(point: vec3f, cell: vec2i, grid: i32) -> f32 {
  var occupancy = 0.0;
  let radius = i32(globals.params[9].x);
  for (var ring = 1; ring <= 3; ring += 1) {
    if (ring > radius) { break; }
    for (var direction = 0; direction < 8; direction += 1) {
      let offsets = array<vec2i, 8>(
        vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1),
        vec2i(1, 1), vec2i(-1, 1), vec2i(1, -1), vec2i(-1, -1));
      let neighbor = cellHeight(cell + offsets[direction] * ring, grid);
      occupancy += clamp((neighbor - point.z + 0.08) * 1.8, 0.0, 1.0) / f32(ring);
    }
  }
  return clamp(occupancy / 12.0, 0.0, 1.0);
}
fn environment(normal: vec3f, view: vec3f, light: vec3f) -> vec3f {
  let reflected = reflect(-view, normal);
  let studio = pow(max(dot(reflected, light), 0.0), mix(5.0, 90.0, 1.0 - globals.params[7].x));
  let skylight = 0.18 + 0.25 * max(reflected.z, 0.0);
  return vec3f(skylight) + vec3f(1.0, 0.92, 0.78) * studio;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let sourceAtScreen = textureSampleLevel(sourceTexture, effectSampler, input.uv, 0.0);
  let amount = globals.params[11].x;
  if (amount <= 0.0) { return sourceAtScreen; }
  let grid = i32(globals.params[0].x);
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let screen = (input.uv - 0.5) * vec2f(2.0 * aspect, 2.0);
  let yaw = globals.params[3].x; let pitch = globals.params[4].x;
  let origin = rotateX(rotateY(vec3f(0.0, 0.0, 3.0), -yaw), -pitch);
  let direction = normalize(rotateX(rotateY(normalize(vec3f(screen * 0.85, -2.4)), -yaw), -pitch));
  let field = slab(origin, direction, vec3f(-1.0, -1.0, -0.6), vec3f(1.0, 1.0, 1.0));
  if (field.x > field.y || field.y < 0.0) { return mix(sourceAtScreen, vec4f(0.0), amount); }
  let cellWidth = 2.0 / f32(grid);
  var travel = max(field.x, 0.0);
  let entry = origin + direction * (travel + 0.0001);
  var cell = clamp(cellAt(entry, grid), vec2i(0), vec2i(grid - 1));
  let directionStep = vec2i(select(-1, 1, direction.x >= 0.0), select(-1, 1, direction.y >= 0.0));
  let light = normalize(vec3f(cos(globals.params[5].x), sin(globals.params[5].x), 0.85));
  for (var step = 0; step < 64; step += 1) {
    if (any(cell < vec2i(0)) || any(cell >= vec2i(grid)) || travel > field.y) { break; }
    let lowXY = vec2f(cell) * cellWidth - 1.0;
    let source = cellColor(cell, grid);
    if (source.a > 0.025) {
      let low = vec3f(lowXY + vec2f(cellWidth * 0.04), -0.6);
      let high = vec3f(lowXY + vec2f(cellWidth * 0.96), cellHeight(cell, grid));
      let hit = slab(origin, direction, low, high);
      if (hit.x <= hit.y && hit.y >= 0.0 && hit.x >= travel - 0.002 && hit.x <= field.y) {
        let point = origin + direction * max(hit.x, 0.0);
        let face = min(point - low, high - point);
        var normal = vec3f(0.0, 0.0, 1.0);
        if (min(face.x, face.y) < face.z) {
          if (face.x < face.y) { normal = vec3f(select(1.0, -1.0, point.x - low.x < high.x - point.x), 0.0, 0.0); }
          else { normal = vec3f(0.0, select(1.0, -1.0, point.y - low.y < high.y - point.y), 0.0); }
        }
        let castShadow = shadow(point + normal * 0.025, light, grid);
        let ao = ambientOcclusion(point, cell, grid);
        let occlusion = (1.0 - castShadow * globals.params[6].x) * (1.0 - ao * globals.params[8].x);
        let diffuse = max(dot(normal, light), 0.0) * occlusion;
        let straight = source.rgb / max(source.a, 0.00001);
        let luma = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
        let palette = mix(globals.params[10].rgb, globals.params[12].rgb, clamp(luma, 0.0, 1.0));
        let albedo = mix(straight, palette, globals.params[13].x);
        let metal = globals.params[14].x;
        let reflected = environment(normal, -direction, light);
        let material = albedo * (0.19 + diffuse * (0.8 - metal * 0.55))
          + reflected * mix(vec3f(0.08), albedo, metal) * (0.28 + metal * 0.72) * occlusion;
        let alpha = source.a * globals.params[15].x;
        return mix(sourceAtScreen, vec4f(material * alpha, alpha), amount);
      }
    }
    let nextX = select(lowXY.x, lowXY.x + cellWidth, direction.x >= 0.0);
    let nextY = select(lowXY.y, lowXY.y + cellWidth, direction.y >= 0.0);
    let timeX = select(1000000.0, (nextX - origin.x) / direction.x, abs(direction.x) > 0.000001);
    let timeY = select(1000000.0, (nextY - origin.y) / direction.y, abs(direction.y) > 0.000001);
    if (timeX < timeY) { travel = timeX; cell.x += directionStep.x; }
    else { travel = timeY; cell.y += directionStep.y; }
  }
  return mix(sourceAtScreen, vec4f(0.0), amount);
}`;

const float = (label: string, value: number, min: number, max: number) => ({
  type: "float" as const,
  label,
  default: value,
  min,
  max,
  step: 0.01,
});
const color = (components: [number, number, number]) => ({
  space: "srgb" as const,
  components,
  alpha: 1,
});

export const SOURCE_VOXELS_V2_EFFECT: EffectDefinition = {
  id: "an-native-owned-ak-source-voxels",
  name: "Source Voxels",
  version: 2,
  kind: "processor",
  placements: ["layer", "backdrop"],
  properties: {
    grid: {
      type: "int",
      label: "Grid cells",
      default: 24,
      min: 8,
      max: 32,
      step: 1,
    },
    height: float("Voxel height", 0.82, 0.15, 1.3),
    contrast: float("Height contrast", 1.25, 0.35, 3),
    yaw: float("Horizontal orbit", 0.42, -1, 1),
    pitch: float("Vertical orbit", -0.36, -0.8, 0.8),
    lightAngle: float("Light angle", 0.72, -3.14, 3.14),
    shadowStrength: float("Self shadow", 0.72, 0, 1),
    roughness: float("Surface roughness", 0.34, 0, 1),
    ambientOcclusion: float("Neighbor occlusion", 0.68, 0, 1),
    occlusionRadius: {
      type: "int",
      label: "Occlusion radius",
      default: 2,
      min: 1,
      max: 3,
      step: 1,
    },
    paletteDark: {
      type: "color",
      label: "Dark material",
      default: color([0.08, 0.16, 0.28]),
    },
    amount: float("Amount", 1, 0, 1),
    paletteLight: {
      type: "color",
      label: "Light material",
      default: color([0.88, 0.76, 0.5]),
    },
    paletteMix: float("Palette mix", 0.3, 0, 1),
    metalness: float("Metalness", 0.28, 0, 1),
    opacity: float("Opacity", 1, 0, 1),
  },
  inputs: { source: { kind: "texture-2d", resource: "source" } },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "source",
      kind: "texture-2d",
      usage: ["sampled"],
      external: true,
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
  passes: [
    {
      id: "ray-voxels",
      kind: "render",
      reads: ["source"],
      output: "color",
      wgsl: voxelWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original alpha-aware voxel ray traversal with source-height columns, bounded secondary cell shadows, neighborhood occlusion, and material palette.",
  },
};

export const SOURCE_VOXELS_V2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-bf-carved-voxels",
    name: "Carved Voxels",
    definitionId: SOURCE_VOXELS_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "layer",
    clip: "bounds",
    params: {
      grid: 28,
      height: 0.82,
      contrast: 1.25,
      yaw: 0.42,
      pitch: -0.36,
      shadowStrength: 0.72,
      ambientOcclusion: 0.68,
      paletteMix: 0.3,
      metalness: 0.28,
    },
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-bf-golden-city",
    name: "Golden City",
    definitionId: SOURCE_VOXELS_V2_EFFECT.id,
    definitionVersion: 2,
    placement: "backdrop",
    clip: "bounds",
    params: {
      grid: 18,
      height: 1.15,
      contrast: 1.7,
      yaw: -0.48,
      pitch: -0.5,
      lightAngle: 1.35,
      shadowStrength: 0.9,
      ambientOcclusion: 0.85,
      paletteDark: color([0.17, 0.07, 0.03]),
      paletteLight: color([1, 0.68, 0.28]),
      paletteMix: 0.8,
      metalness: 0.7,
    },
    provenance: { origin: "design-original" },
  },
];

export const SOURCE_VOXELS_V2_PRESET_LABEL_SOURCE_IDS: Readonly<
  Record<string, string>
> = Object.fromEntries(
  SOURCE_VOXELS_V2_PRESETS.map((preset) => [preset.id, preset.id]),
);
