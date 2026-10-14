export type FigmaMotionPresetCategory = "Enter" | "Cycle" | "Exit";

export type FigmaMotionPresetSpeed = "Fast" | "Medium" | "Slow";

export interface FigmaMotionPresetMetadata {
  category: FigmaMotionPresetCategory;
  name: string;
  speed: FigmaMotionPresetSpeed;
}

export const FIGMA_MOTION_BUILT_IN_PRESETS = [
  { category: "Enter", name: "Burst", speed: "Fast" },
  { category: "Enter", name: "Ignite", speed: "Fast" },
  { category: "Enter", name: "Sweep", speed: "Fast" },
  { category: "Enter", name: "Slam", speed: "Fast" },
  { category: "Enter", name: "Descend", speed: "Medium" },
  { category: "Enter", name: "Magnify", speed: "Medium" },
  { category: "Enter", name: "Glide", speed: "Medium" },
  { category: "Enter", name: "Drop", speed: "Medium" },
  { category: "Enter", name: "Reveal", speed: "Slow" },
  { category: "Enter", name: "Rise", speed: "Slow" },
  { category: "Enter", name: "Tip", speed: "Slow" },
  { category: "Enter", name: "Feather", speed: "Slow" },
  { category: "Cycle", name: "Crank", speed: "Fast" },
  { category: "Cycle", name: "Press", speed: "Fast" },
  { category: "Cycle", name: "Pop", speed: "Fast" },
  { category: "Cycle", name: "Scoot", speed: "Fast" },
  { category: "Cycle", name: "Spin", speed: "Medium" },
  { category: "Cycle", name: "Flip", speed: "Medium" },
  { category: "Cycle", name: "Tick", speed: "Medium" },
  { category: "Cycle", name: "Creep", speed: "Medium" },
  { category: "Cycle", name: "Float", speed: "Slow" },
  { category: "Cycle", name: "Orbit", speed: "Slow" },
  { category: "Cycle", name: "Breathe", speed: "Slow" },
  { category: "Cycle", name: "Pulse", speed: "Slow" },
  { category: "Exit", name: "Launch", speed: "Fast" },
  { category: "Exit", name: "Vanish", speed: "Fast" },
  { category: "Exit", name: "Flick", speed: "Fast" },
  { category: "Exit", name: "Swipe", speed: "Fast" },
  { category: "Exit", name: "Poof", speed: "Medium" },
  { category: "Exit", name: "Deflate", speed: "Medium" },
  { category: "Exit", name: "Fling", speed: "Medium" },
  { category: "Exit", name: "Splat", speed: "Medium" },
  { category: "Exit", name: "Evaporate", speed: "Slow" },
  { category: "Exit", name: "Recede", speed: "Slow" },
  { category: "Exit", name: "Sink", speed: "Slow" },
  { category: "Exit", name: "Tumble", speed: "Slow" },
] as const satisfies readonly FigmaMotionPresetMetadata[];

export type FigmaMotionBuiltInPreset =
  (typeof FIGMA_MOTION_BUILT_IN_PRESETS)[number];
