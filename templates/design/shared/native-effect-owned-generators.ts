import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type {
  EffectColor,
  EffectDefinition,
  EffectPreset,
} from "./native-effects";

type Palette = readonly [EffectColor, EffectColor];
type GeneratorSpec = {
  id: string;
  name: string;
  category: "organic" | "textile" | "optical" | "atmosphere" | "volume";
  feature: { label: string; value: number; min: number; max: number };
  palettes: readonly [Palette, Palette];
  body: string;
};

function color(red: number, green: number, blue: number): EffectColor {
  return { space: "srgb", components: [red, green, blue], alpha: 1 };
}

const moss: Palette = [color(0.025, 0.075, 0.055), color(0.58, 0.89, 0.57)];
const clay: Palette = [color(0.16, 0.045, 0.055), color(0.98, 0.59, 0.35)];
const sea: Palette = [color(0.015, 0.075, 0.13), color(0.35, 0.86, 0.8)];
const iris: Palette = [color(0.075, 0.025, 0.2), color(0.76, 0.49, 0.94)];
const linen: Palette = [color(0.12, 0.105, 0.09), color(0.96, 0.9, 0.76)];
const steel: Palette = [color(0.025, 0.04, 0.065), color(0.72, 0.85, 0.98)];
const gold: Palette = [color(0.15, 0.065, 0.025), color(1, 0.8, 0.39)];
const dusk: Palette = [color(0.06, 0.07, 0.2), color(0.96, 0.48, 0.43)];
const pearl: Palette = [color(0.11, 0.16, 0.2), color(0.94, 0.93, 0.87)];
const neon: Palette = [color(0.025, 0.025, 0.1), color(0.29, 0.99, 0.78)];

const OWN_MATH = `
fn ownedHash(p: vec2f) -> f32 {
  let q = dot(p, vec2f(127.1, 311.7));
  return fract(sin(q) * 43758.5453);
}
fn ownedNoise(p: vec2f) -> f32 {
  let cell = floor(p);
  let f = fract(p);
  let interpolation = f * f * (3.0 - 2.0 * f);
  let bottom = mix(ownedHash(cell), ownedHash(cell + vec2f(1.0, 0.0)), interpolation.x);
  let top = mix(ownedHash(cell + vec2f(0.0, 1.0)), ownedHash(cell + vec2f(1.0, 1.0)), interpolation.x);
  return mix(bottom, top, interpolation.y);
}
fn ownedFbm(p: vec2f) -> f32 {
  var value = 0.0;
  var weight = 0.5;
  var point = p;
  for (var octave = 0u; octave < 4u; octave += 1u) {
    value += ownedNoise(point) * weight;
    point = vec2f(point.x * 1.7 - point.y * 1.1, point.x * 1.1 + point.y * 1.7) + vec2f(8.1, 3.7);
    weight *= 0.5;
  }
  return value / 0.9375;
}
fn ownedSegmentDistance(point: vec2f, start: vec2f, end: vec2f) -> f32 {
  let delta = end - start;
  let u = clamp(dot(point - start, delta) / max(dot(delta, delta), 0.00001), 0.0, 1.0);
  return length(point - start - delta * u);
}
fn ownedRotate(p: vec2f, angle: f32) -> vec2f {
  return vec2f(p.x * cos(angle) - p.y * sin(angle), p.x * sin(angle) + p.y * cos(angle));
}
`;

const SPECS: readonly GeneratorSpec[] = [
  {
    id: "mycelium-trails",
    name: "Mycelium Trails",
    category: "organic",
    feature: { label: "Branch width", value: 0.035, min: 0.005, max: 0.16 },
    palettes: [moss, pearl],
    body: `let warp = ownedFbm(p * 4.0 + vec2f(t * 0.09, 0.0)) * 0.35;
      var distance = 10.0;
      for (var branch = 0u; branch < 5u; branch += 1u) {
        let offset = f32(branch) * 0.27 - 0.54;
        let curve = sin(p.x * (3.0 + f32(branch)) + offset * 8.0 + t * 0.2) * (0.12 + warp);
        distance = min(distance, abs(p.y - offset - curve));
      }
      let field = 1.0 - smoothstep(detail * 0.4, detail * 1.4, distance);`,
  },
  {
    id: "ink-blooms",
    name: "Ink Blooms",
    category: "organic",
    feature: { label: "Bloom reach", value: 0.46, min: 0.1, max: 1.2 },
    palettes: [clay, iris],
    body: `var pigment = 0.0;
      for (var bloom = 0u; bloom < 3u; bloom += 1u) {
        let center = vec2f(f32(bloom) * 0.55 - 0.55, sin(f32(bloom) * 2.3) * 0.25);
        let radial = length(p - center) + (ownedFbm((p - center) * 7.0 + vec2f(t * 0.05)) - 0.5) * 0.2;
        pigment = max(pigment, 1.0 - smoothstep(detail * 0.48, detail, radial));
      }
      let field = pigment * (0.7 + 0.3 * ownedNoise(p * 20.0));`,
  },
  {
    id: "leaf-venation",
    name: "Leaf Venation",
    category: "organic",
    feature: { label: "Vein density", value: 9, min: 3, max: 24 },
    palettes: [moss, gold],
    body: `let leaf = 1.0 - smoothstep(0.75, 0.84, length(vec2f(p.x * 0.7, p.y * 1.4)));
      let midrib = 1.0 - smoothstep(0.01, 0.025, abs(p.y - sin(p.x * 2.0) * 0.04));
      let rung = fract((p.x + 1.0) * detail);
      let branchX = floor((p.x + 1.0) * detail) / detail - 1.0;
      let branchY = abs(p.x - branchX) * 0.65;
      let veins = 1.0 - smoothstep(0.009, 0.025, abs(abs(p.y) - branchY));
      let field = leaf * max(midrib, veins * smoothstep(0.0, 0.2, rung));`,
  },
  {
    id: "coral-polyps",
    name: "Coral Polyps",
    category: "organic",
    feature: { label: "Polyp radius", value: 0.28, min: 0.08, max: 0.48 },
    palettes: [clay, sea],
    body: `let grid = p * 4.0;
      let cell = floor(grid);
      let local = fract(grid) - 0.5 - (ownedHash(cell) - 0.5) * 0.16;
      let radius = length(local);
      let petals = 0.035 * sin(atan2(local.y, local.x) * 8.0 + ownedHash(cell + vec2f(5.0)) * 6.28);
      let ring = 1.0 - smoothstep(0.02, 0.065, abs(radius - detail - petals));
      let center = 1.0 - smoothstep(0.03, 0.08, radius);
      let field = max(ring, center * 0.8);`,
  },
  {
    id: "tide-pool-contours",
    name: "Tide Pool Contours",
    category: "organic",
    feature: { label: "Shore spacing", value: 7, min: 2, max: 18 },
    palettes: [sea, linen],
    body: `let elevation = ownedFbm(p * 2.8 + vec2f(t * 0.05, -t * 0.03));
      let shore = abs(fract(elevation * detail) - 0.5);
      let edge = 1.0 - smoothstep(0.35, 0.49, shore);
      let basin = smoothstep(0.35, 0.62, elevation);
      let field = mix(basin * 0.7, 1.0, edge);`,
  },
  {
    id: "knit-loops",
    name: "Knit Loops",
    category: "textile",
    feature: { label: "Loop width", value: 0.23, min: 0.08, max: 0.4 },
    palettes: [linen, iris],
    body: `let cell = p * vec2f(5.0, 7.0);
      let row = floor(cell.y);
      let local = vec2f(fract(cell.x + row * 0.5) - 0.5, fract(cell.y) - 0.5);
      let left = length(vec2f((local.x + 0.18) / detail, local.y * 1.15)) - 0.8;
      let right = length(vec2f((local.x - 0.18) / detail, local.y * 1.15)) - 0.8;
      let yarn = min(abs(left), abs(right));
      let field = 1.0 - smoothstep(0.05, 0.13, yarn);`,
  },
  {
    id: "braided-ribbons",
    name: "Braided Ribbons",
    category: "textile",
    feature: { label: "Ribbon width", value: 0.12, min: 0.03, max: 0.28 },
    palettes: [iris, gold],
    body: `let lane = p.y * 5.0;
      let phase = p.x * 7.0 + t * 0.2;
      let a = abs(fract(lane + sin(phase) * 0.26) - 0.5);
      let b = abs(fract(lane + 0.5 - sin(phase) * 0.26) - 0.5);
      let over = step(0.0, sin(phase * 2.0));
      let ribbon = mix(1.0 - smoothstep(detail, detail + 0.06, b), 1.0 - smoothstep(detail, detail + 0.06, a), over);
      let field = ribbon * (0.68 + 0.32 * over);`,
  },
  {
    id: "quilted-diamonds",
    name: "Quilted Diamonds",
    category: "textile",
    feature: { label: "Stitch depth", value: 0.22, min: 0.02, max: 0.5 },
    palettes: [linen, clay],
    body: `let tile = fract(ownedRotate(p * 4.0, 0.785398)) - 0.5;
      let seam = min(abs(tile.x), abs(tile.y));
      let relief = pow(max(0.0, 1.0 - length(tile) * 1.8), 2.0);
      let stitch = 1.0 - smoothstep(0.012, 0.035, seam);
      let field = clamp(relief * (0.5 + detail) - stitch * 0.5, 0.0, 1.0);`,
  },
  {
    id: "lace-rosettes",
    name: "Lace Rosettes",
    category: "textile",
    feature: { label: "Petal count", value: 8, min: 4, max: 16 },
    palettes: [pearl, iris],
    body: `let local = fract(p * 3.4) - 0.5;
      let radius = length(local);
      let petals = 0.22 + 0.055 * cos(atan2(local.y, local.x) * detail);
      let rim = 1.0 - smoothstep(0.012, 0.045, abs(radius - petals));
      let eyelets = 1.0 - smoothstep(0.012, 0.04, abs(radius - 0.1));
      let field = max(rim, eyelets * 0.7);`,
  },
  {
    id: "sashiko-stitches",
    name: "Sashiko Stitches",
    category: "textile",
    feature: { label: "Stitch length", value: 0.43, min: 0.12, max: 0.8 },
    palettes: [steel, linen],
    body: `let row = floor(p.y * 12.0);
      let arc = p.y * 12.0 - row - 0.5 - 0.11 * cos(p.x * 8.0 + row * 0.5);
      let dash = step(fract(p.x * 5.0 + row * 0.37), detail);
      let thread = 1.0 - smoothstep(0.025, 0.065, abs(arc));
      let field = thread * dash;`,
  },
  {
    id: "prism-facets",
    name: "Prism Facets",
    category: "optical",
    feature: { label: "Facet sharpness", value: 0.75, min: 0.1, max: 1 },
    palettes: [iris, neon],
    body: `let grid = p * 4.0;
      let cell = floor(grid);
      let local = fract(grid);
      let diagonal = step(local.x + local.y, 1.0);
      let normal = normalize(vec3f(local.x - 0.5, local.y - 0.5, mix(-1.0, 1.0, diagonal)));
      let light = pow(max(dot(normal, normalize(vec3f(-0.3, 0.6, 1.0))), 0.0), detail * 24.0 + 2.0);
      let edge = 1.0 - smoothstep(0.0, 0.045, min(abs(local.x + local.y - 1.0), min(local.x, local.y)));
      let field = clamp(light + edge * 0.35 + ownedHash(cell) * 0.2, 0.0, 1.0);`,
  },
  {
    id: "fresnel-shells",
    name: "Fresnel Shells",
    category: "optical",
    feature: { label: "Shell curvature", value: 0.62, min: 0.1, max: 1.5 },
    palettes: [sea, pearl],
    body: `let radius = length(vec2f(p.x, p.y * detail));
      let normal = normalize(vec3f(p * 0.7, sqrt(max(0.0, 1.0 - min(radius * radius, 1.0)))));
      let grazing = pow(1.0 - max(normal.z, 0.0), 3.0);
      let shells = 0.5 + 0.5 * cos(radius * 21.0 - t * 0.2);
      let field = clamp(grazing * 0.8 + shells * 0.32, 0.0, 1.0);`,
  },
  {
    id: "lenticular-ribs",
    name: "Lenticular Ribs",
    category: "optical",
    feature: { label: "Rib pitch", value: 13, min: 4, max: 40 },
    palettes: [steel, gold],
    body: `let groove = fract(p.x * detail + 0.5);
      let cylinder = sqrt(max(0.0, 1.0 - pow(groove * 2.0 - 1.0, 2.0)));
      let reflection = pow(max(0.0, cylinder * 0.6 + (groove - 0.5) * 0.8), 6.0);
      let field = clamp(reflection + cylinder * 0.28 + ownedNoise(vec2f(p.y * 42.0, groove)) * 0.1, 0.0, 1.0);`,
  },
  {
    id: "etched-diffraction",
    name: "Etched Diffraction",
    category: "optical",
    feature: { label: "Groove density", value: 32, min: 8, max: 80 },
    palettes: [steel, iris],
    body: `let groove = sin((p.x + p.y * 0.08) * detail * 6.283185 + t * 0.08);
      let interference = sin((p.x * 0.72 - p.y * 0.69) * detail * 0.71);
      let glint = pow(max(0.0, groove * interference), 12.0);
      let field = clamp(0.42 + groove * 0.16 + interference * 0.14 + glint * 0.5, 0.0, 1.0);`,
  },
  {
    id: "anamorphic-streaks",
    name: "Anamorphic Streaks",
    category: "optical",
    feature: { label: "Streak spread", value: 0.07, min: 0.01, max: 0.25 },
    palettes: [steel, neon],
    body: `let anchors = vec2f(floor(p.x * 3.0), floor(p.y * 5.0));
      let emitter = ownedHash(anchors);
      let y = fract(p.y * 5.0) - 0.5;
      let x = fract(p.x * 3.0) - 0.5;
      let beam = exp(-abs(y) / detail) * exp(-abs(x) * 0.7) * step(0.65, emitter);
      let nucleus = exp(-length(vec2f(x * 6.0, y * 20.0))) * emitter;
      let field = clamp(beam * 0.8 + nucleus, 0.0, 1.0);`,
  },
  {
    id: "aurora-curtains",
    name: "Aurora Curtains",
    category: "atmosphere",
    feature: { label: "Curtain width", value: 0.16, min: 0.04, max: 0.45 },
    palettes: [neon, iris],
    body: `var curtain = 0.0;
      for (var band = 0u; band < 4u; band += 1u) {
        let center = f32(band) * 0.35 - 0.5 + sin(p.y * 4.0 + t * 0.22 + f32(band)) * 0.12;
        let distance = abs(p.x - center - (ownedFbm(p * 3.0 + vec2f(f32(band) * 9.0)) - 0.5) * 0.14);
        curtain += exp(-distance / detail) * smoothstep(-0.8, 0.6, p.y) * 0.32;
      }
      let field = clamp(curtain, 0.0, 1.0);`,
  },
  {
    id: "fog-banks",
    name: "Fog Banks",
    category: "atmosphere",
    feature: { label: "Fog depth", value: 0.55, min: 0.05, max: 1 },
    palettes: [steel, pearl],
    body: `let horizon = p.y + (ownedFbm(p * 2.5 + vec2f(t * 0.05, 0.0)) - 0.5) * detail;
      let far = smoothstep(-0.55, 0.25, horizon);
      let near = smoothstep(-0.2, 0.72, horizon + ownedFbm(p * 6.0) * 0.25);
      let field = clamp(mix(far * 0.55, near, 0.5), 0.0, 1.0);`,
  },
  {
    id: "ember-drift",
    name: "Ember Drift",
    category: "atmosphere",
    feature: { label: "Spark length", value: 0.26, min: 0.04, max: 0.6 },
    palettes: [clay, gold],
    body: `let travel = p + vec2f(0.0, t * 0.2);
      let cell = floor(travel * vec2f(9.0, 12.0));
      let local = fract(travel * vec2f(9.0, 12.0)) - vec2f(ownedHash(cell), ownedHash(cell + vec2f(13.0)));
      let spark = exp(-length(vec2f(local.x * 9.0, local.y * (3.0 / detail)))) * step(0.78, ownedHash(cell + vec2f(3.0)));
      let glow = exp(-length(local * vec2f(3.0, 5.0))) * spark * 0.5;
      let field = clamp(spark + glow, 0.0, 1.0);`,
  },
  {
    id: "horizon-haze",
    name: "Horizon Haze",
    category: "atmosphere",
    feature: { label: "Haze spread", value: 0.28, min: 0.04, max: 0.8 },
    palettes: [dusk, gold],
    body: `let height = p.y + 0.12 * sin(p.x * 2.0);
      let haze = exp(-abs(height) / detail);
      let sun = exp(-length((p - vec2f(0.35, -0.1)) * vec2f(2.0, 2.0)) * 5.0);
      let bands = 0.5 + 0.5 * sin(height * 18.0 + ownedNoise(p * 3.0) * 2.0);
      let field = clamp(haze * 0.6 + sun * 0.45 + bands * 0.1, 0.0, 1.0);`,
  },
  {
    id: "volumetric-cones",
    name: "Volumetric Cones",
    category: "atmosphere",
    feature: { label: "Cone angle", value: 0.42, min: 0.1, max: 1 },
    palettes: [steel, gold],
    body: `let source = vec2f(-0.35, -0.8);
      let ray = p - source;
      let radial = length(ray);
      let cone = 1.0 - smoothstep(detail * 0.72, detail, abs(atan2(ray.x, ray.y) - 0.35));
      let scatter = 0.66 + ownedFbm(p * 5.0 + vec2f(t * 0.03)) * 0.34;
      let field = cone * exp(-radial * 0.9) * scatter;`,
  },
  {
    id: "contour-terrain",
    name: "Contour Terrain",
    category: "volume",
    feature: { label: "Elevation bands", value: 11, min: 3, max: 30 },
    palettes: [moss, linen],
    body: `let elevation = ownedFbm(p * 3.5 + vec2f(0.0, t * 0.02));
      let band = fract(elevation * detail);
      let line = 1.0 - smoothstep(0.03, 0.1, min(band, 1.0 - band));
      let slope = abs(dpdx(elevation)) + abs(dpdy(elevation));
      let field = clamp(elevation * 0.7 + line * 0.28 + slope * 0.25, 0.0, 1.0);`,
  },
  {
    id: "wire-dome",
    name: "Wire Dome",
    category: "volume",
    feature: { label: "Grid lines", value: 10, min: 4, max: 24 },
    palettes: [steel, neon],
    body: `let radius = length(p);
      let depth = sqrt(max(0.0, 1.0 - min(radius * radius, 1.0)));
      let longitude = atan2(p.y, p.x);
      let latitude = atan2(radius, depth);
      let meridian = abs(sin(longitude * detail));
      let parallel = abs(sin(latitude * detail * 1.3));
      let grid = 1.0 - smoothstep(0.0, 0.1, min(meridian, parallel));
      let field = grid * (0.35 + depth * 0.65) * (1.0 - smoothstep(0.95, 1.02, radius));`,
  },
  {
    id: "gyroid-slice",
    name: "Gyroid Slice",
    category: "volume",
    feature: { label: "Iso thickness", value: 0.22, min: 0.03, max: 0.7 },
    palettes: [iris, pearl],
    body: `let q = p * 8.0 + vec2f(t * 0.1, -t * 0.13);
      let z = sin(q.x) * cos(q.y) + sin(q.y) * cos(q.x * 0.7) + sin(q.x * 0.7) * cos(q.y * 0.4);
      let sheet = 1.0 - smoothstep(detail * 0.3, detail, abs(z));
      let shade = 0.5 + 0.5 * cos(z * 3.0);
      let field = sheet * shade;`,
  },
  {
    id: "folded-paper",
    name: "Folded Paper",
    category: "volume",
    feature: { label: "Crease width", value: 0.045, min: 0.005, max: 0.18 },
    palettes: [linen, clay],
    body: `let tile = fract(p * 3.0);
      let diagonal = tile.x - tile.y;
      let fold = step(0.0, diagonal);
      let crease = 1.0 - smoothstep(detail * 0.3, detail, abs(diagonal));
      let normal = mix(vec2f(-0.35, 0.75), vec2f(0.75, -0.35), fold);
      let shade = 0.45 + 0.4 * dot(normal, normalize(vec2f(0.8, 0.6)));
      let field = clamp(shade - crease * 0.4, 0.0, 1.0);`,
  },
  {
    id: "crystal-lattice",
    name: "Crystal Lattice",
    category: "volume",
    feature: { label: "Crystal height", value: 0.68, min: 0.1, max: 1.4 },
    palettes: [sea, gold],
    body: `let grid = p * 4.5;
      let cell = floor(grid);
      let local = fract(grid) - 0.5;
      let diamond = abs(local.x) + abs(local.y);
      let facet = step(0.0, local.x * local.y);
      let apex = max(0.0, 1.0 - diamond * 1.7) * detail;
      let glint = pow(max(0.0, apex * mix(0.65, 1.0, facet)), 3.0);
      let edge = 1.0 - smoothstep(0.02, 0.06, abs(diamond - 0.45));
      let field = clamp(glint + edge * 0.28 + ownedHash(cell) * 0.13, 0.0, 1.0);`,
  },
] as const;

function buildDefinition(spec: GeneratorSpec): EffectDefinition {
  const [dark, light] = spec.palettes[0];
  return {
    id: `an-native-owned-${spec.id}`,
    name: spec.name,
    version: 2,
    kind: "generator",
    placements: ["fill"],
    properties: {
      scale: {
        type: "float",
        label: "Scale",
        default: 1,
        min: 0.25,
        max: 5,
        step: 0.01,
      },
      motion: {
        type: "float",
        label: "Motion",
        default: 0.3,
        min: 0,
        max: 3,
        step: 0.01,
      },
      dark: {
        type: "color",
        label: "Shadow color",
        default: structuredClone(dark),
      },
      light: {
        type: "color",
        label: "Highlight color",
        default: structuredClone(light),
      },
      contrast: {
        type: "float",
        label: "Contrast",
        default: 1,
        min: 0.2,
        max: 3,
        step: 0.01,
      },
      feature: {
        type: "float",
        label: spec.feature.label,
        default: spec.feature.value,
        min: spec.feature.min,
        max: spec.feature.max,
        step: 0.01,
      },
    },
    resources: [
      {
        name: "color",
        kind: "texture-2d",
        format: "rgba16float",
        usage: ["render", "sampled"],
        size: "viewport",
      },
    ],
    outputs: { color: { kind: "texture-2d", resource: "color" } },
    output: "color",
    passes: [
      {
        id: "render",
        kind: "render",
        reads: [],
        output: "color",
        wgsl:
          NATIVE_RENDER_GLOBALS +
          OWN_MATH +
          `
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let scale = max(globals.params[0].x, 0.0001);
  let motion = globals.params[1].x;
  let p = (input.uv * 2.0 - vec2f(1.0)) * vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0) * scale;
  let t = globals.clock.x * motion;
  let detail = globals.params[5].x;
  ${spec.body}
  let tone = clamp((field - 0.5) * globals.params[4].x + 0.5, 0.0, 1.0);
  let alpha = mix(globals.params[2].a, globals.params[3].a, tone);
  let rgb = mix(globals.params[2].rgb, globals.params[3].rgb, tone);
  return vec4f(rgb * alpha, alpha);
}
`,
      },
    ],
    provenance: {
      origin: "design-original",
      note: `Original Design ${spec.category} generator.`,
    },
  };
}

export const DESIGN_OWNED_GENERATORS: readonly EffectDefinition[] =
  SPECS.map(buildDefinition);

export const DESIGN_OWNED_GENERATOR_PRESETS: readonly EffectPreset[] =
  SPECS.flatMap((spec) =>
    spec.palettes.map((palette, index) => ({
      id: `an-preset-owned-${spec.id}-${index === 0 ? "signature" : "alternate"}`,
      name: `${spec.name} ${index === 0 ? "Signature" : "Alternate"}`,
      definitionId: `an-native-owned-${spec.id}`,
      definitionVersion: 2,
      placement: "fill" as const,
      params: {
        scale: index === 0 ? 1 : 1.45,
        motion: index === 0 ? 0.3 : 0.55,
        dark: structuredClone(palette[0]),
        light: structuredClone(palette[1]),
        contrast: index === 0 ? 1 : 1.3,
        feature: spec.feature.value,
      },
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
