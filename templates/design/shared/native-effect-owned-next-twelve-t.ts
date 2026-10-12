import {
  catalogColor,
  catalogFloat,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "./native-effects";

type Look = readonly [string, Record<string, EffectValue>];
export type Draft = CatalogShaderSpec & {
  mechanism: string;
  closest: string;
  cost: string;
  looks: readonly [Look, Look];
};
const px = (
  label: string,
  value: number,
  min: number,
  max: number,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min,
  max,
  step: 0.1,
  unit: "px",
});
const integer = (
  label: string,
  value: number,
  min: number,
  max: number,
): EffectProperty => ({
  type: "int",
  label,
  default: value,
  min,
  max,
  step: 1,
});
const pigment = (
  label: string,
  r: number,
  g: number,
  b: number,
): EffectProperty => ({
  type: "color",
  label,
  default: catalogColor(r, g, b),
});
const edge = (): EffectProperty => ({
  type: "enum",
  label: "Outside source",
  default: "clamp",
  options: ["transparent", "clamp"],
  advanced: true,
});

export const OWNED_NEXT_TWELVE_T_DRAFTS: readonly Draft[] = [
  {
    id: "owned-t-paired-band-exchange",
    name: "Paired Band Exchange",
    kind: "processor",
    mechanism:
      "Pairs adjacent horizontal source bands and exchanges their sampled positions by a controllable fraction; the mapping is a bandwise permutation, not a noisy displacement.",
    closest: "Pixel Shift; Tape Tracking; Bar Shift source candidate",
    cost: "One source read per pixel.",
    properties: {
      edge: edge(),
      height: px("Band height", 36, 8, 100),
      exchange: catalogFloat("Exchange", 0.8, 0, 1),
    },
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let h = ${p("height")}.x;
  let band = i32(floor(point.y / h));
  let direction = select(-1.0, 1.0, (band % 2) == 0);
  let sourceY = point.y + direction * h * ${p("exchange")}.x;
  return sampleSource(vec2f(point.x, sourceY) * globals.viewport.zw * globals.clock.z);`,
    looks: [
      ["Short exchanges", { height: 20, exchange: 0.55 }],
      ["Wide swap", { height: 64, exchange: 1 }],
    ],
  },
  {
    id: "owned-t-concentric-rotor",
    name: "Concentric Rotor",
    kind: "processor",
    mechanism:
      "Inverse-samples alternating annular zones after opposite rotations around a chosen center; boundaries rotate but radial distance stays fixed.",
    closest: "Swirl; Kaleidoscope; Concentric Spin source candidate",
    cost: "One source read per pixel.",
    properties: {
      edge: edge(),
      centerX: catalogFloat("Center X", 0.5, 0, 1),
      centerY: catalogFloat("Center Y", 0.5, 0, 1),
      ring: px("Ring width", 34, 12, 90),
      angle: catalogFloat("Zone angle", 0.38, -1.5, 1.5),
    },
    fragment: (p) => `
  let extent = globals.viewport.xy / globals.clock.z;
  let center = vec2f(${p("centerX")}.x, ${p("centerY")}.x) * extent;
  let ray = input.uv * extent - center;
  let zone = i32(floor(length(ray) / ${p("ring")}.x));
  let direction = select(-1.0, 1.0, (zone % 2) == 0);
  let source = center + rotate(ray, -direction * ${p("angle")}.x);
  return sampleSource(source / extent);`,
    looks: [
      ["Subtle rings", { ring: 48, angle: 0.16 }],
      ["Counter orbit", { centerX: 0.38, ring: 24, angle: 0.85 }],
    ],
  },
  {
    id: "owned-t-node-grid-warp",
    version: 2,
    name: "Node Grid Warp",
    kind: "processor",
    mechanism:
      "Displaces each source point by bilinearly interpolating four reproducible vertex offsets of its containing rectangular cell; displacement is continuous across grid edges.",
    closest:
      "Noise Displacement; Vector Field Displacement; Grid Distortion source candidate",
    cost: "Eight integer component hashes and one source read per pixel.",
    properties: {
      edge: edge(),
      cell: px("Cell size", 60, 20, 120),
      amplitude: px("Vertex offset", 9, 0, 24),
      seed: integer("Seed", 11, 0, 1000),
    },
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let grid = point / ${p("cell")}.x;
  let base = vec2i(floor(grid)); let f = fract(grid); let u = f * f * (vec2f(3.0) - 2.0 * f);
  let seed = i32(${p("seed")}.x);
  let a = vec2f(random(base + vec2i(seed, 19)), random(base + vec2i(37, seed)));
  let b = vec2f(random(base + vec2i(1 + seed, 19)), random(base + vec2i(38, seed)));
  let c = vec2f(random(base + vec2i(seed, 20)), random(base + vec2i(37, 1 + seed)));
  let d = vec2f(random(base + vec2i(1 + seed, 20)), random(base + vec2i(38, 1 + seed)));
  let offset = mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - vec2f(1.0);
  return sampleSource((point + offset * ${p("amplitude")}.x) / (globals.viewport.xy / globals.clock.z));`,
    looks: [
      ["Gentle mesh", { cell: 78, amplitude: 5 }],
      ["Bent tiles", { cell: 32, amplitude: 18, seed: 71 }],
    ],
  },
  {
    id: "owned-t-luma-tail-integrator",
    name: "Luma Tail Integrator",
    kind: "processor",
    mechanism:
      "A one-sided seven-tap exposure trail whose ray length is driven by the current source luminance, so bright features drag farther while dark regions retain detail.",
    closest:
      "Directional Smear; Radial Echo; Progressive Blur source candidate",
    cost: "Eight source reads per pixel, fixed.",
    properties: {
      edge: edge(),
      reach: px("Bright reach", 26, 0, 72),
      floorReach: px("Dark reach", 2, 0, 18),
      angle: catalogFloat("Direction", 0.3, -3.14, 3.14),
      amount: catalogFloat("Trail blend", 0.8, 0, 1),
    },
    helpers: () => `
fn tStraightExact(color: vec4f) -> vec3f {
  if (color.a <= 0.0) { return vec3f(0.0); }
  return color.rgb / color.a;
}`,
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let straight = tStraightExact(center);
  let light = clamp(dot(straight, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  let lengthPx = mix(${p("floorReach")}.x, ${p("reach")}.x, light);
  let axis = vec2f(cos(${p("angle")}.x), sin(${p("angle")}.x)) * lengthPx * globals.viewport.zw * globals.clock.z;
  var integral = vec4f(0.0);
  for (var tap = 0u; tap < 7u; tap += 1u) { integral += sampleSource(input.uv - axis * (f32(tap) / 6.0)); }
  return mix(center, integral / 7.0, ${p("amount")}.x);`,
    looks: [
      ["Bright drawing", { reach: 36, floorReach: 0, amount: 0.9 }],
      [
        "Diagonal exposure",
        { reach: 54, floorReach: 6, angle: 1.15, amount: 1 },
      ],
    ],
  },
  {
    id: "owned-t-chalkboard-rubbing",
    name: "Chalkboard Rubbing",
    kind: "processor",
    mechanism:
      "Uses directional source luminance gradient to raise chalk pigment on transitions, then combines it with low-opacity periodic rubbing lines while preserving source alpha.",
    closest: "Edge Ink; Crosshatch; Chalkboard source candidate",
    cost: "Three source reads and one analytic hatch per pixel.",
    properties: {
      edge: edge(),
      chalk: pigment("Chalk", 0.87, 0.88, 0.8),
      sensitivity: catalogFloat("Edge response", 4, 0, 10),
      spacing: px("Rubbing spacing", 8, 3, 24),
      strength: catalogFloat("Deposit", 0.75, 0, 1),
    },
    helpers: () => `
fn tStraightExact(color: vec4f) -> vec3f {
  if (color.a <= 0.0) { return vec3f(0.0); }
  return color.rgb / color.a;
}`,
    fragment: (p) => `
  let center = sampleSource(input.uv);
  let stepUv = globals.viewport.zw * globals.clock.z;
  let right = sampleSource(input.uv + vec2f(stepUv.x, 0.0));
  let down = sampleSource(input.uv + vec2f(0.0, stepUv.y));
  let c = dot(tStraightExact(center), vec3f(0.2126, 0.7152, 0.0722));
  let r = dot(tStraightExact(right), vec3f(0.2126, 0.7152, 0.0722));
  let d = dot(tStraightExact(down), vec3f(0.2126, 0.7152, 0.0722));
  let edgeAmount = clamp(length(vec2f(r-c,d-c)) * ${p("sensitivity")}.x, 0.0, 1.0);
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let hatch = 1.0 - smoothstep(0.05, 0.28, abs(fract((point.x + point.y * 0.35) / ${p("spacing")}.x) - 0.5));
  let weight = ${p("strength")}.x * max(edgeAmount, hatch * 0.18) * center.a;
  let pigment = ${p("chalk")};
  return vec4f(mix(center.rgb, pigment.rgb * center.a, weight * pigment.a), center.a);`,
    looks: [
      ["Soft rubbing", { sensitivity: 2, spacing: 12, strength: 0.55 }],
      ["Hard contours", { sensitivity: 8, spacing: 5, strength: 1 }],
    ],
  },
  {
    id: "owned-t-door-reveal",
    version: 2,
    name: "Opposed Door Reveal",
    kind: "processor",
    mechanism:
      "Two continuous panels open from the vertical center with independent feather; the source is retained only in the opened aperture, unlike periodic slats or checker phases.",
    closest: "Slat Shutter; Checker Phase; Barn Doors source candidate",
    cost: "One source read per pixel.",
    edgeSampling: "fixed-clamp",
    properties: {
      progress: catalogFloat("Opening", 0.62, 0, 1),
      feather: catalogFloat("Feather", 0.02, 0, 0.2),
      invert: integer("Invert", 0, 0, 1),
    },
    fragment: (p) => `
  let source = sampleSource(input.uv);
  let progress = ${p("progress")}.x;
  let invert = ${p("invert")}.x;
  if (progress <= 0.0) { return source * invert; }
  if (progress >= 1.0) { return source * (1.0 - invert); }
  let halfOpen = progress * 0.5;
  let distance = abs(input.uv.x - 0.5);
  let feather = max(${p("feather")}.x, 0.00001);
  let opening = 1.0 - smoothstep(halfOpen - feather, halfOpen + feather, distance);
  let coverage = mix(opening, 1.0 - opening, invert);
  return source * coverage;`,
    looks: [
      ["Narrow opening", { progress: 0.25, feather: 0.005 }],
      ["Soft reverse", { progress: 0.72, feather: 0.08, invert: 1 }],
    ],
  },
  {
    id: "owned-t-stochastic-block-field",
    version: 2,
    name: "Stochastic Block Field",
    kind: "generator",
    mechanism:
      "Assigns each integer cell an independent seeded height and shades the discontinuity at its four borders; this is a piecewise-constant random field rather than a DCT block transform.",
    closest: "Block Transform; Voronoi Cells; BlockNoise source candidate",
    cost: "One integer cell hash and four analytic border tests.",
    properties: {
      cell: px("Block size", 30, 8, 90),
      seed: integer("Seed", 7, 0, 1000),
      contrast: catalogFloat("Height contrast", 0.75, 0, 1),
      seam: px("Seam", 1, 0, 6),
      light: pigment("High", 0.82, 0.7, 0.53),
      dark: pigment("Low", 0.06, 0.11, 0.19),
    },
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let cell = point / ${p("cell")}.x;
  let value = random(vec2i(floor(cell)) + vec2i(i32(${p("seed")}.x), 17));
  let local = fract(cell) * ${p("cell")}.x;
  let border = min(min(local.x, local.y), min(${p("cell")}.x-local.x, ${p("cell")}.x-local.y));
  let height = mix(0.5, value, ${p("contrast")}.x) * smoothstep(0.0, ${p("seam")}.x + 1.0 / globals.clock.z, border);
  let high = ${p("light")}; let low = ${p("dark")};
  return mix(vec4f(low.rgb*low.a,low.a),vec4f(high.rgb*high.a,high.a),height);`,
    looks: [
      ["Small aggregate", { cell: 14, seam: 0.4, contrast: 0.55 }],
      ["Large blocks", { cell: 68, seam: 3, contrast: 1, seed: 53 }],
    ],
  },
  {
    id: "owned-t-offset-dot-matrix",
    name: "Offset Dot Matrix",
    kind: "generator",
    mechanism:
      "Renders equal-radius circles on a staggered row lattice with independently controlled odd-row offset and elliptical dot aspect; deterministic topology differs from inhibited random stippling.",
    closest: "Inhibited Stipple; Phyllotaxis Seeds; DotGrid source candidate",
    cost: "Three adjacent-row nearest-dot distances per pixel.",
    properties: {
      pitch: px("Dot spacing", 24, 8, 72),
      radius: px("Dot radius", 4, 0.5, 20),
      offset: catalogFloat("Odd-row offset", 0.5, 0, 1),
      aspect: catalogFloat("Dot aspect", 1, 0.4, 2),
      dot: pigment("Dots", 0.86, 0.52, 0.23),
      ground: pigment("Ground", 0.06, 0.08, 0.12),
    },
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let row = i32(floor(point.y / ${p("pitch")}.x));
  var nearest = 1.0e6;
  for (var offsetRow = -1; offsetRow <= 1; offsetRow += 1) {
    let candidate = row + offsetRow;
    let shift = select(0.0, ${p("offset")}.x, (candidate % 2) != 0);
    let dx = (fract(point.x / ${p("pitch")}.x - shift) - 0.5) * ${p("pitch")}.x / ${p("aspect")}.x;
    let dy = point.y - (f32(candidate) + 0.5) * ${p("pitch")}.x;
    nearest = min(nearest, length(vec2f(dx, dy)));
  }
  let coverage = 1.0 - smoothstep(${p("radius")}.x-0.5/globals.clock.z,${p("radius")}.x+0.5/globals.clock.z,nearest);
  let ink=${p("dot")};let ground=${p("ground")};
  return mix(vec4f(ground.rgb*ground.a,ground.a),vec4f(ink.rgb*ink.a,ink.a),coverage);`,
    looks: [
      ["Small offset", { pitch: 17, radius: 2.1, offset: 0.5 }],
      ["Elongated array", { pitch: 38, radius: 8, offset: 0.25, aspect: 1.6 }],
    ],
  },
  {
    id: "owned-t-pinned-strand-array",
    version: 2,
    name: "Pinned Strand Array",
    kind: "generator",
    mechanism:
      "Between fixed upper and lower pins, each strand follows a sine displacement multiplied by a zero-at-endpoint envelope; line count and resonance are independent.",
    closest: "Braided Ribbons; Bezier Hatch; Strands source candidate",
    cost: "Eight bounded strand-distance comparisons.",
    properties: {
      count: integer("Strands", 6, 2, 8),
      swing: px("Swing", 12, 0, 35),
      cycles: catalogFloat("Oscillations", 1.5, 0.5, 4),
      width: px("Thread", 1.5, 0.4, 8),
      thread: pigment("Thread", 0.82, 0.72, 0.59),
      ground: pigment("Ground", 0.08, 0.11, 0.16),
    },
    fragment: (p) => `
  let point = input.uv * globals.viewport.xy / globals.clock.z;
  let height = globals.viewport.y / globals.clock.z;
  let t = clamp(point.y / height,0.0,1.0);
  let envelope = sin(3.14159265*t);
  let count = floor(${p("count")}.x);
  var nearest = 1.0e6;
  for (var strand=0u;strand<8u;strand+=1u) {
    if (f32(strand)<count) {
      let pin = (f32(strand)+0.5)*globals.viewport.x/globals.clock.z/count;
      let curve = pin + ${p("swing")}.x*envelope*sin(6.2831853*${p("cycles")}.x*t + f32(strand)*0.71);
      nearest=min(nearest,abs(point.x-curve));
    }
  }
  let coverage=1.0-smoothstep(${p("width")}.x*0.5,${p("width")}.x*0.5+1.0/globals.clock.z,nearest);
  let ink=${p("thread")};let ground=${p("ground")};
  return mix(vec4f(ground.rgb*ground.a,ground.a),vec4f(ink.rgb*ink.a,ink.a),coverage);`,
    looks: [
      ["Taut strings", { count: 8, swing: 4, cycles: 2, width: 1 }],
      ["Resonant threads", { count: 4, swing: 28, cycles: 3.5, width: 2.5 }],
    ],
  },
  {
    id: "owned-t-rational-conic-ribbon",
    name: "Rational Conic Ribbon",
    kind: "generator",
    mechanism:
      "Samples a rational quadratic Bézier with a variable central weight; changing the weight moves the locus through conic sections while endpoints remain pinned.",
    closest: "Bezier Hatch; Catenary Cables; Line source candidate",
    cost: "Forty-eight fixed rational-segment distance comparisons per pixel; performance gate required.",
    properties: {
      bend: catalogFloat("Conic weight", 0.7, 0.2, 3),
      lift: px("Control lift", 58, 10, 130),
      width: px("Ribbon", 2.5, 0.5, 12),
      ink: pigment("Ink", 0.86, 0.47, 0.31),
      ground: pigment("Ground", 0.05, 0.08, 0.13),
    },
    fragment: (p) => `
  let point=input.uv*globals.viewport.xy/globals.clock.z;
  let size=globals.viewport.xy/globals.clock.z;
  let start=vec2f(size.x*0.12,size.y*0.72);
  let control=vec2f(size.x*0.5,size.y*0.72-${p("lift")}.x);
  let end=vec2f(size.x*0.88,size.y*0.72);
  var previous=start;var nearest=1.0e6;
  for(var segment=1u;segment<=48u;segment+=1u){
    let t=f32(segment)/48.0;let a=(1.0-t)*(1.0-t);let b=2.0*${p("bend")}.x*t*(1.0-t);let c=t*t;
    let next=(start*a+control*b+end*c)/(a+b+c);
    let side=next-previous;let f=clamp(dot(point-previous,side)/max(dot(side,side),0.00001),0.0,1.0);
    nearest=min(nearest,length(point-previous-side*f));previous=next;
  }
  let coverage=1.0-smoothstep(${p("width")}.x*0.5,${p("width")}.x*0.5+1.0/globals.clock.z,nearest);
  let ink=${p("ink")};let ground=${p("ground")};
  return mix(vec4f(ground.rgb*ground.a,ground.a),vec4f(ink.rgb*ink.a,ink.a),coverage);`,
    looks: [
      ["Open conic", { bend: 0.25, lift: 82, width: 2 }],
      ["Tight arch", { bend: 2.4, lift: 105, width: 4 }],
    ],
  },
  {
    id: "owned-t-crescent-boolean",
    name: "Crescent Boolean",
    kind: "generator",
    mechanism:
      "Subtracts an offset disk from a primary disk in signed-distance space; the exposed lune has controllable thickness and antialiased topology, not a recolored star or circular ring.",
    closest: "Star Cutout; Vesica/Crescent source candidates",
    cost: "Two analytic disk distances per pixel.",
    properties: {
      radius: px("Outer radius", 58, 20, 120),
      cut: px("Cut radius", 52, 8, 120),
      shift: px("Cut shift", 24, -90, 90),
      softness: px("Edge softness", 1, 0.5, 12),
      moon: pigment("Lune", 0.9, 0.75, 0.46),
      ground: pigment("Ground", 0.05, 0.06, 0.12),
    },
    fragment: (p) => `
  let point=(input.uv-vec2f(0.5))*globals.viewport.xy/globals.clock.z;
  let outer=length(point)-${p("radius")}.x;
  let removed=${p("cut")}.x-length(point-vec2f(${p("shift")}.x,0.0));
  let signed=max(outer,removed);
  let coverage=1.0-smoothstep(-${p("softness")}.x*0.5,${p("softness")}.x*0.5,signed);
  let ink=${p("moon")};let ground=${p("ground")};
  return mix(vec4f(ground.rgb*ground.a,ground.a),vec4f(ink.rgb*ink.a,ink.a),coverage);`,
    looks: [
      ["Thin lune", { radius: 62, cut: 58, shift: 18 }],
      ["Open moon", { radius: 72, cut: 48, shift: 42, softness: 2 }],
    ],
  },
  {
    id: "owned-t-rose-locus",
    version: 2,
    name: "Rose Locus",
    kind: "generator",
    mechanism:
      "Measures distance to a sampled polar rhodonea locus r=a cos(kθ), retaining its signed-radius loops; petal count changes the curve's topology rather than tinting a generic rosette.",
    closest: "Hypotrochoid Ink; Guilloche Rosettes; Flower source candidate",
    cost: "Sixty-four polar segment distance comparisons per pixel; performance gate required.",
    properties: {
      radius: px("Petal reach", 62, 20, 110),
      petals: integer("Frequency", 4, 2, 9),
      width: px("Stroke", 2, 0.5, 10),
      ink: pigment("Trace", 0.91, 0.55, 0.22),
      ground: pigment("Ground", 0.06, 0.09, 0.13),
    },
    fragment: (p) => `
  let point=(input.uv-vec2f(0.5))*globals.viewport.xy/globals.clock.z;
  var previous=vec2f(${p("radius")}.x,0.0);var nearest=1.0e6;
  let petals = floor(${p("petals")}.x);
  for(var segment=1u;segment<=64u;segment+=1u){
    let angle=6.2831853*f32(segment)/64.0;
    let r=${p("radius")}.x*cos(petals*angle);
    let next=vec2f(cos(angle),sin(angle))*r;
    let side=next-previous;let f=clamp(dot(point-previous,side)/max(dot(side,side),0.00001),0.0,1.0);
    nearest=min(nearest,length(point-previous-side*f));previous=next;
  }
  let coverage=1.0-smoothstep(${p("width")}.x*0.5,${p("width")}.x*0.5+1.0/globals.clock.z,nearest);
  let ink=${p("ink")};let ground=${p("ground")};
  return mix(vec4f(ground.rgb*ground.a,ground.a),vec4f(ink.rgb*ink.a,ink.a),coverage);`,
    looks: [
      ["Four petals", { petals: 4, radius: 52, width: 1.4 }],
      ["Dense rosette", { petals: 7, radius: 78, width: 3 }],
    ],
  },
];

export const OWNED_NEXT_TWELVE_T_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_TWELVE_T_DRAFTS.map((draft) => {
    const base = catalogShader(draft);
    return {
      ...base,
      resources: base.resources?.map((resource) =>
        resource.name === "color"
          ? { ...resource, format: "rgba16float" }
          : resource,
      ),
      provenance: {
        origin: "design-original",
        note: draft.mechanism.slice(0, 240),
      },
    };
  });

export const OWNED_NEXT_TWELVE_T_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_TWELVE_T_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: draft.version ?? 1,
      placement:
        draft.kind === "generator" ? ("fill" as const) : ("layer" as const),
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
