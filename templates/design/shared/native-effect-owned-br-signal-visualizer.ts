import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const signalWgsl = `${NATIVE_RENDER_GLOBALS}
fn painted(color: vec4f, coverage: f32) -> vec4f {
  let alpha = color.a * clamp(coverage, 0.0, 1.0);
  return vec4f(color.rgb * alpha, alpha);
}
fn over(foreground: vec4f, background: vec4f) -> vec4f {
  return vec4f(foreground.rgb + background.rgb * (1.0 - foreground.a),
    foreground.a + background.a * (1.0 - foreground.a));
}
fn signalAt(x: f32, time: f32) -> f32 {
  let phase = x * globals.params[5].x * 6.2831853
    + globals.params[6].x + time * globals.params[7].x * 6.2831853;
  return sin(phase) * 0.72 + sin(phase * 2.13 + 1.7) * 0.28;
}
fn envelope(time: f32) -> f32 {
  let simulated = 0.58 + 0.28 * sin(time * globals.params[7].x * 1.7)
    + 0.14 * sin(time * globals.params[7].x * 3.1 + 1.2);
  let level = select(clamp(simulated * globals.params[2].x, 0.0, 1.0), globals.params[3].x,
    globals.params[1].x > 0.5);
  return clamp(globals.params[4].x * level, 0.0, 1.0);
}
fn rectCoverage(point: vec2f, center: vec2f, halfSize: vec2f, feather: f32) -> f32 {
  let outside = abs(point - center) - halfSize;
  let distance = length(max(outside, vec2f(0.0))) + min(max(outside.x, outside.y), 0.0);
  return 1.0 - smoothstep(-feather, feather, distance);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let ratio = max(globals.clock.z, 0.01);
  let cssSize = globals.viewport.xy / ratio;
  let point = input.uv * cssSize;
  let feather = 1.0 / ratio;
  let time = globals.clock.x;
  let level = envelope(time);
  let count = max(globals.params[8].x, 1.0);
  let cellWidth = cssSize.x / count;
  let column = floor(point.x / cellWidth);
  let centerX = (column + 0.5) * cellWidth;
  let columnX = centerX / cssSize.x;
  let sample = signalAt(input.uv.x, time);
  let columnSignal = signalAt(columnX, time);
  let style = globals.params[0].x;
  let primary = globals.params[11];
  let accent = globals.params[12];
  let background = painted(globals.params[13], 1.0);
  var body = 0.0;
  var highlight = 0.0;

  if (style < 0.5) {
    let height = cssSize.y * (0.04 + 0.83 * level * (0.25 + 0.75 * abs(columnSignal)));
    let barCenter = vec2f(centerX, cssSize.y * 0.9 - height * 0.5);
    let halfSize = vec2f(cellWidth * 0.36, height * 0.5);
    body = rectCoverage(point, barCenter, halfSize, feather);
    highlight = rectCoverage(point,
      vec2f(centerX, cssSize.y * 0.9 - height + min(3.0, height * 0.25)),
      vec2f(cellWidth * 0.36, min(3.0, height * 0.25)), feather) * body;
  } else if (style < 1.5) {
    let curve = cssSize.y * (0.5 - sample * level * 0.39);
    let low = min(curve, cssSize.y * 0.5);
    let high = max(curve, cssSize.y * 0.5);
    body = smoothstep(low - feather, low + feather, point.y)
      * (1.0 - smoothstep(high - feather, high + feather, point.y));
    highlight = 1.0 - smoothstep(globals.params[9].x - feather,
      globals.params[9].x + feather, abs(point.y - curve));
  } else if (style < 2.5) {
    let curve = cssSize.y * (0.5 - sample * level * 0.39);
    let distance = abs(point.y - curve);
    body = 1.0 - smoothstep(globals.params[9].x * 1.8 - feather,
      globals.params[9].x * 1.8 + feather, distance);
    highlight = 1.0 - smoothstep(globals.params[9].x * 0.5 - feather,
      globals.params[9].x * 0.5 + feather, distance);
  } else {
    let rows = 16.0;
    let rowHeight = cssSize.y * 0.82 / rows;
    let row = floor((cssSize.y * 0.91 - point.y) / rowHeight);
    let centerY = cssSize.y * 0.91 - (row + 0.5) * rowHeight;
    let radius = min(globals.params[10].x * 0.5, min(cellWidth, rowHeight) * 0.43);
    let distance = length(point - vec2f(centerX, centerY));
    let activeRows = floor(rows * level * (0.2 + 0.8 * abs(columnSignal)) + 0.5);
    let inside = select(0.0, 1.0, row >= 0.0 && row < activeRows);
    body = (1.0 - smoothstep(radius - feather, radius + feather, distance)) * inside;
    highlight = body * select(0.0, 1.0, row >= activeRows - 2.0);
  }
  let foreground = over(painted(accent, highlight), painted(primary, body));
  let result = over(foreground, background);
  return result * globals.params[14].x;
}`;

export const SIGNAL_VISUALIZER_EFFECT: EffectDefinition = {
  id: "an-native-owned-br-signal-visualizer",
  name: "Signal Visualizer",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    visualStyle: {
      type: "enum",
      label: "Visualizer style",
      default: "Equalizer Bars",
      options: [
        "Equalizer Bars",
        "Filled Wave",
        "Oscilloscope Line",
        "Dot Matrix",
      ],
    },
    signalMode: {
      type: "enum",
      label: "Signal mode",
      default: "Simulated",
      options: ["Simulated", "Level"],
    },
    signalLevel: {
      type: "float",
      label: "Simulated level",
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.01,
    },
    scalarLevel: {
      type: "float",
      label: "Scalar level",
      default: 0.75,
      min: 0,
      max: 1,
      step: 0.01,
    },
    amplitude: {
      type: "float",
      label: "Amplitude",
      default: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
    },
    signalFrequency: {
      type: "float",
      label: "Signal frequency",
      default: 4,
      min: 0.25,
      max: 20,
      step: 0.05,
    },
    signalPhase: {
      type: "float",
      label: "Signal phase",
      default: 0,
      min: -6.28,
      max: 6.28,
      step: 0.01,
    },
    signalSpeed: {
      type: "float",
      label: "Signal speed",
      default: 0.7,
      min: 0,
      max: 3,
      step: 0.01,
    },
    bandCount: {
      type: "int",
      label: "Band count",
      default: 32,
      min: 4,
      max: 128,
      step: 1,
    },
    lineWidth: {
      type: "float",
      label: "Line width",
      default: 2,
      min: 0.5,
      max: 12,
      step: 0.1,
      unit: "px",
    },
    dotSize: {
      type: "float",
      label: "Dot size",
      default: 6,
      min: 1,
      max: 18,
      step: 0.5,
      unit: "px",
    },
    signalColor: {
      type: "color",
      label: "Signal color",
      default: color([0.09, 0.9, 0.65]),
    },
    peakColor: {
      type: "color",
      label: "Peak color",
      default: color([0.82, 1, 0.78], 0.9),
    },
    backgroundColor: {
      type: "color",
      label: "Background",
      default: color([0.015, 0.035, 0.055]),
    },
    opacity: {
      type: "float",
      label: "Opacity",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["sampled", "render"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "render-signal",
      kind: "render",
      reads: [],
      output: "color",
      wgsl: signalWgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "Original analytic signal visualization with four bounded geometry styles. Level mode uses an editable scalar; it does not capture audio samples.",
  },
};

export const SIGNAL_VISUALIZER_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-br-pulse-bars",
    name: "Pulse Bars",
    definitionId: SIGNAL_VISUALIZER_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      visualStyle: "Equalizer Bars",
      signalMode: "Simulated",
      signalFrequency: 6,
      bandCount: 48,
      signalSpeed: 0.9,
      signalColor: color([0.12, 0.81, 0.89]),
      peakColor: color([0.9, 1, 0.78], 0.95),
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-br-level-dots",
    name: "Level Dots",
    definitionId: SIGNAL_VISUALIZER_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      visualStyle: "Dot Matrix",
      signalMode: "Level",
      scalarLevel: 0.8,
      amplitude: 1,
      signalFrequency: 3,
      signalSpeed: 0.3,
      bandCount: 36,
      dotSize: 7,
      signalColor: color([1, 0.37, 0.24]),
      peakColor: color([1, 0.84, 0.46]),
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
