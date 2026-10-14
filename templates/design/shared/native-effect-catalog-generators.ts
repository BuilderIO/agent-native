import {
  catalogFloat as f,
  catalogPalette,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type { EffectProperty } from "./native-effects";

function properties(detail = 6): Record<string, EffectProperty> {
  return {
    palette: catalogPalette(),
    scale: f("Scale", 1, 0.25, 4),
    movement: f("Movement", 0.15, 0, 2),
    detail: f("Detail", detail, 1, 24),
    softness: f("Softness", 0.08, 0.002, 0.5),
    rotation: f("Rotation", 0, -3.14159, 3.14159),
  };
}

const point = (p: (name: string) => string) => `
  let uv = input.uv;
  let q = rotate((uv - 0.5) * vec2f(globals.viewport.x / max(globals.viewport.y, 1.0), 1.0), ${p("rotation")}.x) * ${p("scale")}.x;
  let phase = globals.clock.x * ${p("movement")}.x;
  let detail = ${p("detail")}.x;
  let soft = ${p("softness")}.x;
`;

const specs: CatalogShaderSpec[] = [
  {
    id: "gradient-field",
    name: "Gradient Field",
    kind: "generator",
    properties: {
      ...properties(),
      mode: {
        type: "enum",
        label: "Geometry",
        default: "linear",
        options: ["linear", "radial", "conic", "diamond"],
      },
    },
    fragment: (p) =>
      point(p) +
      `
  let mode = u32(${p("mode")}.x);
  var value = q.x + 0.5 + sin(phase) * soft;
  if (mode == 1u) { value = length(q) * 1.8 + sin(phase) * soft; }
  if (mode == 2u) { value = fract(atan2(q.y, q.x) / TAU + 0.5 + phase * 0.05); }
  if (mode == 3u) { value = (abs(q.x) + abs(q.y)) * 1.4 + sin(phase) * soft; }
  return paletteAt(pow(clamp(value, 0.0, 1.0), detail * 0.15 + 0.1));
`,
  },
  {
    id: "mesh-anchors",
    version: 2,
    name: "Mesh Gradient",
    kind: "generator",
    properties: properties(4),
    fragment: (p) =>
      point(p) +
      `
  var color = vec4f(0.0); var total = 0.0;
  for (var i = 0u; i < 8u; i += 1u) {
    let anchor = vec2f(random(vec2i(i32(i), 91)), random(vec2i(i32(i), 107))) - 0.5;
    let offset = vec2f(sin(phase + f32(i) * 2.0), cos(phase * 0.7 + f32(i))) * soft;
    let delta = q - anchor - offset;
    let weight = 1.0 / pow(max(dot(delta, delta), 0.005), detail * 0.3);
    color += paletteAt(f32(i) / 7.0) * weight; total += weight;
  }
  return color / max(total, 0.00001);
`,
  },
  {
    id: "voronoi-cells",
    version: 2,
    name: "Voronoi Cells",
    kind: "generator",
    properties: properties(7),
    fragment: (p) =>
      point(p) +
      `
  let cell = vec2i(floor(q * detail)); let local = fract(q * detail);
  var nearest = 10.0; var second = 10.0; var value = 0.0;
  for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) {
    let candidate = cell + vec2i(x, y);
    let jitter = vec2f(random(candidate), random(candidate + vec2i(71, 19)));
    let site = vec2f(f32(x), f32(y)) + 0.5 + (jitter - 0.5) * (0.8 + 0.15 * sin(phase + jitter.x * TAU));
    let distance = length(site - local);
    if (distance < nearest) { second = nearest; nearest = distance; value = random(candidate + vec2i(3, 59)); }
    else { second = min(second, distance); }
  }}
  let border = smoothstep(0.0, soft, second - nearest);
  return mix(paletteAt(0.0), paletteAt(value), border);
`,
  },
  {
    id: "truchet-arcs",
    name: "Truchet Arcs",
    kind: "generator",
    properties: properties(8),
    fragment: (p) =>
      point(p) +
      `
  let cell = vec2i(floor(q * detail + phase * 0.08)); var local = fract(q * detail + phase * 0.08);
  if (random(cell) > 0.5) { local.x = 1.0 - local.x; }
  let distance = min(abs(length(local) - 0.5), abs(length(local - 1.0) - 0.5));
  let coverage = 1.0 - smoothstep(soft, soft + 0.02, distance);
  return mix(paletteAt(0.0), paletteAt(1.0), coverage);
`,
  },
  {
    id: "water-caustics",
    name: "Water Caustics",
    kind: "generator",
    properties: properties(5),
    fragment: (p) =>
      point(p) +
      `
  var accumulated = 0.0;
  for (var i = 0u; i < 4u; i += 1u) {
    let angle = f32(i) * 1.570796 + 0.35;
    let wave = rotate(q, angle) * detail + vec2f(phase * (0.5 + f32(i) * 0.17));
    let fold = abs(sin(wave.x + sin(wave.y)) * cos(wave.y - cos(wave.x)));
    accumulated += pow(1.0 - fold, 12.0 + soft * 40.0);
  }
  return paletteAt(clamp(accumulated * 0.5, 0.0, 1.0));
`,
  },
  {
    id: "mandelbrot",
    name: "Mandelbrot",
    kind: "generator",
    properties: properties(12),
    fragment: (p) =>
      point(p) +
      `
  let c = q * (2.6 / max(detail * 0.12, 1.0)) + vec2f(-0.55, 0.08 * sin(phase));
  var z = vec2f(0.0); var escape = 0.0;
  for (var i = 0u; i < 96u; i += 1u) {
    z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 64.0) { escape = (f32(i) + 1.0 - log2(max(log2(length(z)), 0.00001))) / 32.0; break; }
  }
  return paletteAt(select(0.0, fract(escape + soft), escape > 0.0));
`,
  },
  {
    id: "starfield",
    version: 3,
    name: "Starfield",
    kind: "generator",
    properties: properties(18),
    fragment: (p) =>
      point(p) +
      `
  var light = 0.0;
  let basePixelFootprint = max(length(dpdx(q)), length(dpdy(q))) * detail;
  for (var layer = 0u; layer < 3u; layer += 1u) {
    let depth = 1.0 + f32(layer) * 0.65;
    let world = q * detail * depth + vec2f(phase * depth * 0.2, phase * 0.06);
    let pixelFootprint = basePixelFootprint * depth;
    let cell = vec2i(floor(world)); let local = fract(world);
    for (var y = -1; y <= 1; y += 1) { for (var x = -1; x <= 1; x += 1) {
      let tile = cell + vec2i(x, y) + vec2i(i32(layer) * 31);
      let center = vec2f(f32(x), f32(y)) + vec2f(random(tile), random(tile + vec2i(29, 67)));
      let distance = length(local - center);
      let radius = max(0.006 + soft * 0.15 * random(tile + vec2i(51, 7)), pixelFootprint * 0.75);
      light += (1.0 - smoothstep(max(radius - pixelFootprint * 0.5, 0.0), radius + pixelFootprint * 0.5, distance)) / depth;
    }}
  }
  return paletteAt(clamp(light, 0.0, 1.0));
`,
  },
  {
    id: "hex-tiles",
    name: "Hex Tiles",
    kind: "generator",
    properties: properties(6),
    fragment: (p) =>
      point(p) +
      `
  let world = q * detail + vec2f(phase * 0.1, 0.0);
  let grid = vec2f(1.7320508, 3.0);
  let a = world - grid * floor(world / grid + 0.5);
  let b = world - vec2f(0.8660254, 1.5) - grid * floor((world - vec2f(0.8660254, 1.5)) / grid + 0.5);
  let local = select(b, a, dot(a, a) < dot(b, b));
  let id = vec2i(round((world - local) * 2.0));
  let edge = 0.8660254 - max(abs(local.x), dot(abs(local), vec2f(0.5, 0.8660254)));
  let color = paletteAt(random(id));
  return mix(paletteAt(0.0), color, smoothstep(0.0, soft, edge));
`,
  },
  {
    id: "wave-interference",
    name: "Wave Interference",
    kind: "generator",
    properties: properties(12),
    fragment: (p) =>
      point(p) +
      `
  let a = length(q - vec2f(-0.25, 0.0)); let b = length(q - vec2f(0.25, 0.0));
  let field = sin(a * detail * TAU - phase) + sin(b * detail * TAU + phase * 0.7);
  return paletteAt(smoothstep(-2.0 + soft, 2.0 - soft, field));
`,
  },
  {
    id: "iridescent-surface",
    name: "Iridescent Surface",
    kind: "generator",
    properties: properties(6),
    fragment: (p) =>
      point(p) +
      `
  let normal = normalize(vec3f(sin(q.x * detail + phase) * 0.45, cos(q.y * detail - phase * 0.7) * 0.45, 1.0));
  let incidence = dot(normal, normalize(vec3f(-0.4, 0.55, 1.0)));
  let thickness = (0.45 + 0.12 * sin(q.x * 2.0 + q.y * 3.0 + phase)) * detail;
  let interference = 0.5 + 0.5 * cos(TAU * thickness * incidence * vec3f(1.0, 1.31, 1.62));
  let base = paletteAt(incidence); let specular = pow(max(incidence, 0.0), 16.0 / (1.0 + soft * 4.0));
  return premultiply(mix(straight(base), interference, 0.7) + specular * 0.18, base.a);
`,
  },
  {
    id: "metaball-field",
    version: 2,
    name: "Metaball Field",
    kind: "generator",
    properties: properties(6),
    fragment: (p) =>
      point(p) +
      `
  var field = 0.0;
  for (var i = 0u; i < 8u; i += 1u) {
    let angle = f32(i) * 2.399963;
    let radius = 0.12 + 0.24 * random(vec2i(i32(i), 35));
    let center = vec2f(cos(angle + phase * 0.6), sin(angle - phase * 0.4)) * radius;
    let delta = q - center;
    field += (0.009 + detail * 0.001) / max(dot(delta, delta), 0.0005);
  }
  let coverage = smoothstep(1.4 - soft * 4.0, 1.4 + soft * 4.0, field);
  return mix(paletteAt(0.0), paletteAt(clamp(field * 0.25, 0.0, 1.0)), coverage);
`,
  },
  {
    id: "fractal-cloud",
    name: "Fractal Cloud",
    kind: "generator",
    properties: properties(5),
    fragment: (p) =>
      point(p) +
      `
  let drift = vec2f(phase * 0.17, phase * 0.11);
  let warp = vec2f(fractalNoise(q * detail + drift), fractalNoise(q * detail + vec2f(37.0, 13.0) - drift));
  let density = fractalNoise(q * detail + warp * 2.0 + drift);
  return paletteAt(smoothstep(0.2 + soft * 0.4, 0.8 - soft * 0.2, density));
`,
  },
  {
    id: "brushed-metal",
    name: "Brushed Metal",
    kind: "generator",
    properties: properties(10),
    fragment: (p) =>
      point(p) +
      `
  let brushing = valueNoise(vec2f(q.x * 3.0, q.y * detail * 85.0));
  let tangent = sin(q.x * 3.0 + phase) * 0.5 + 0.5;
  let highlight = pow(max(1.0 - abs(tangent - q.y * 0.3 - 0.5) * 2.0, 0.0), 2.0 + soft * 30.0);
  return paletteAt(clamp(0.2 + brushing * 0.17 + highlight * 0.6, 0.0, 1.0));
`,
  },
  {
    id: "plasma-field",
    name: "Plasma Field",
    kind: "generator",
    properties: properties(7),
    fragment: (p) =>
      point(p) +
      `
  let waves = sin(q.x * detail + phase) + sin(q.y * detail - phase * 0.8) + sin((q.x + q.y) * detail * 0.7 + phase * 0.4) + sin(length(q + vec2f(0.2 * sin(phase))) * detail * 1.3);
  return paletteAt(0.5 + waves * (0.125 - soft * 0.08));
`,
  },
  {
    id: "woven-fabric",
    name: "Woven Fabric",
    kind: "generator",
    properties: properties(18),
    fragment: (p) =>
      point(p) +
      `
  let world = q * detail + vec2f(phase * 0.01); let tile = vec2i(floor(world)); let local = fract(world);
  let warp = sin(local.x * PI); let weft = sin(local.y * PI);
  let top = ((tile.x + tile.y) & 1) == 0;
  let thread = select(weft, warp, top);
  let ridge = pow(max(thread, 0.0), 0.5 + soft * 4.0);
  let dye = select(0.2, 0.8, top);
  let color = paletteAt(dye);
  let fibers = valueNoise(world * vec2f(4.0, 150.0)) * 0.08;
  return premultiply(straight(color) * (0.25 + ridge * 0.7 + fibers), color.a);
`,
  },
];

// Promotion into the public catalog requires the real GPU and visual gate.
export const CATALOG_GENERATOR_CANDIDATES = specs.map(catalogShader);
