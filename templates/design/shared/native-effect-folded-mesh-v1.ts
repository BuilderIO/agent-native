import type { EffectDefinition } from "./native-effects";

export const FOLDED_MESH_V1_EFFECT: EffectDefinition = {
  id: "an-native-folded-mesh",
  name: "Folded Mesh",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    fill: {
      type: "paint",
      label: "Fill",
      maxCount: 8,
      default: {
        kind: "linear",
        angle: 112,
        interpolation: "in oklab",
        stops: [
          {
            position: 0,
            color: {
              space: "srgb",
              components: [0.23, 0.07, 0.52],
              alpha: 1,
            },
          },
          {
            position: 0.34,
            color: {
              space: "srgb",
              components: [0.73, 0.16, 0.68],
              alpha: 1,
            },
          },
          {
            position: 0.68,
            color: {
              space: "srgb",
              components: [0.99, 0.36, 0.39],
              alpha: 1,
            },
          },
          {
            position: 1,
            color: {
              space: "srgb",
              components: [1, 0.72, 0.36],
              alpha: 1,
            },
          },
        ],
      },
    },
    scale: {
      type: "float",
      label: "Scale",
      default: 1,
      min: 0.5,
      max: 2,
      step: 0.01,
    },
    twist: {
      type: "float",
      label: "Twist",
      default: 0.65,
      min: -3.141592653589793,
      max: 3.141592653589793,
      step: 0.01,
    },
    depth: {
      type: "float",
      label: "Depth",
      default: 0.62,
      min: 0,
      max: 1,
      step: 0.01,
    },
    softness: {
      type: "float",
      label: "Softness",
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  outputs: {
    color: {
      kind: "texture-2d",
      resource: "color",
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
  output: "color",
  passes: [
    {
      id: "folded-surface",
      kind: "render",
      reads: [],
      output: "color",
      mesh: {
        columns: 128,
        rows: 96,
      },
      wgsl: `
struct Globals {
  viewport: vec4f,
  clock: vec4f,
  params: array<vec4f, 32>,
};
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var effectSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var maskTexture: texture_2d<f32>;


fn foldedFillEncode(c: vec3f) -> vec3f {
  let magnitude = abs(c);
  return sign(c) * select(1.055 * pow(magnitude, vec3f(1.0 / 2.4)) - 0.055, magnitude * 12.92, magnitude <= vec3f(0.0031308));
}
fn foldedFillDecode(c: vec3f) -> vec3f {
  let magnitude = abs(c);
  return sign(c) * select(pow((magnitude + 0.055) / 1.055, vec3f(2.4)), magnitude / 12.92, magnitude <= vec3f(0.04045));
}
fn foldedFillToSpace(rgb: vec3f, mode: u32) -> vec3f {
  if (mode == 1u) { return rgb; }
  if (mode == 2u) {
    let lms = vec3f(dot(rgb, vec3f(0.4122214708, 0.5363325363, 0.0514459929)), dot(rgb, vec3f(0.2119034982, 0.6806995451, 0.1073969566)), dot(rgb, vec3f(0.0883024619, 0.2817188376, 0.6299787005)));
    let root = sign(lms) * pow(abs(lms), vec3f(1.0 / 3.0));
    return vec3f(dot(root, vec3f(0.2104542553, 0.7936177850, -0.0040720468)), dot(root, vec3f(1.9779984951, -2.4285922050, 0.4505937099)), dot(root, vec3f(0.0259040371, 0.7827717662, -0.8086757660)));
  }
  if (mode == 3u) {
    return foldedFillEncode(vec3f(dot(rgb, vec3f(0.8224620106, 0.1775379894, 0.0)), dot(rgb, vec3f(0.0331941591, 0.9668058409, 0.0)), dot(rgb, vec3f(0.0170826307, 0.0723974407, 0.9105199286))));
  }
  return foldedFillEncode(rgb);
}
fn foldedFillFromSpace(value: vec3f, mode: u32) -> vec3f {
  if (mode == 1u) { return value; }
  if (mode == 2u) {
    let root = vec3f(value.x + 0.3963377774 * value.y + 0.2158037573 * value.z, value.x - 0.1055613458 * value.y - 0.0638541728 * value.z, value.x - 0.0894841775 * value.y - 1.2914855480 * value.z);
    let lms = root * root * root;
    return vec3f(dot(lms, vec3f(4.0767416621, -3.3077115913, 0.2309699292)), dot(lms, vec3f(-1.2684380046, 2.6097574011, -0.3413193965)), dot(lms, vec3f(-0.0041960863, -0.7034186147, 1.7076147010)));
  }
  let rgb = foldedFillDecode(value);
  if (mode == 3u) {
    return vec3f(1.2249401 * rgb.r - 0.2249401 * rgb.g, -0.0420569 * rgb.r + 1.0420569 * rgb.g, -0.0196376 * rgb.r - 0.0786361 * rgb.g + 1.0982737 * rgb.b);
  }
  return rgb;
}
fn foldedFill(uv: vec2f, viewport: vec2f) -> vec4f {
  let header = globals.params[0];
  let encoded = u32(header.x);
  let kind = encoded % 8u;
  let mode = encoded / 8u;
  let count = min(u32(header.y), 8u);
  let first = globals.params[1];
  if (kind == 0u) { return vec4f(first.rgb * first.a, first.a); }
  let size = max(viewport, vec2f(0.0001));
  let pixel = (uv - 0.5) * size;
  var position = 0.0;
  if (kind == 1u) {
    let direction = vec2f(sin(header.z), -cos(header.z));
    let span = dot(abs(direction), size);
    position = 0.5 + dot(pixel, direction) / max(span, 0.0001);
  } else if (kind == 2u) {
    position = length(pixel) / max(length(size * 0.5), 0.0001);
  } else if (kind == 3u) {
    position = fract((atan2(pixel.x, -pixel.y) - header.z) / 6.283185307179586 + 1.0);
  } else {
    position = length((uv - 0.5) * 2.0);
  }
  position = clamp(position, 0.0, 1.0);
  var lower = first;
  var upper = first;
  var lowerPosition = globals.params[2].x;
  var upperPosition = lowerPosition;
  for (var i = 1u; i < count; i += 1u) {
    let color = globals.params[1u + i * 2u];
    let stopPosition = globals.params[2u + i * 2u].x;
    if (stopPosition <= position) {
      lower = color;
      lowerPosition = stopPosition;
      upper = color;
      upperPosition = stopPosition;
    } else {
      upper = color;
      upperPosition = stopPosition;
      break;
    }
  }
  if (position <= lowerPosition || upperPosition <= lowerPosition) { return vec4f(lower.rgb * lower.a, lower.a) * header.w; }
  let weight = clamp((position - lowerPosition) / (upperPosition - lowerPosition), 0.0, 1.0);
  let alpha = mix(lower.a, upper.a, weight);
  let premultiplied = mix(foldedFillToSpace(lower.rgb, mode) * lower.a, foldedFillToSpace(upper.rgb, mode) * upper.a, weight);
  if (alpha == 0.0) { return vec4f(0.0); }
  return vec4f(foldedFillFromSpace(premultiplied / alpha, mode) * alpha, alpha) * header.w;
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) ridge: f32,
};
@vertex fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let uv = vec2f(f32(vertexIndex % 129u), f32(vertexIndex / 129u)) / vec2f(128.0, 96.0);
  let aspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let scale = globals.params[17].x;
  let twist = globals.params[18].x;
  let depth = globals.params[19].x;
  let softness = globals.params[20].x;
  let time = globals.clock.x;
  let plane = vec2f((uv.x - 0.5) * aspect, 0.5 - uv.y) * (2.85 / scale);
  let diagonal = plane.x * 3.4 + plane.y * 1.15 + 0.22 * sin(plane.y * 3.1 + time * 0.42);
  let fold = sin(diagonal + time * 0.28);
  let fine = sin(diagonal * 2.0 - plane.y * 0.7 + time * 0.36);
  let relief = depth * (0.34 * fold + (0.19 - 0.11 * softness) * fine);
  let turn = twist * plane.y * 0.65 + 0.13 * sin(time * 0.38 + plane.y * 1.8);
  let world = vec3f(
    plane.x * cos(turn) - relief * sin(turn),
    plane.y + depth * 0.06 * sin(plane.x * 2.3 + time * 0.47),
    plane.x * sin(turn) + relief * cos(turn)
  );
  let camera = 3.0 + 1.5 * max(aspect, 1.0) / scale;
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
  output.world = world;
  output.ridge = fold;
  return output;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let paint = foldedFill(input.uv, globals.viewport.xy);
  let surface = cross(dpdx(input.world), dpdy(input.world));
  let oriented = select(surface, -surface, surface.z < 0.0);
  let normal = oriented / max(length(oriented), 1e-12);
  let light = normalize(vec3f(-0.42, 0.56, 0.72));
  let diffuse = max(dot(normal, light), 0.0);
  let highlight = pow(diffuse, 18.0);
  let crease = 1.0 - 0.11 * (1.0 - abs(input.ridge));
  let illumination = (0.47 + 0.68 * diffuse) * crease;
  let rgb = paint.rgb * illumination + vec3f(0.15 * highlight * paint.a);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), paint.a);
}
`,
    },
  ],
  provenance: {
    origin: "design-original",
    note: "Original vertex-deformed folded surface with packed native paint.",
  },
};
