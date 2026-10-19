import type { SlideDesignTokens } from "../open-slide-runtime/protocol";

const DESIGN_PRESETS: readonly SlideDesignTokens[] = [
  {
    background: "#f7f5f0",
    text: "#1a1814",
    accent: "#6d4cff",
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 1,
    bodyScale: 1,
    radius: 12,
  },
  {
    background: "#0f1115",
    text: "#f5f3ee",
    accent: "#7cc4ff",
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 192 / 168,
    bodyScale: 32 / 36,
    radius: 6,
  },
  {
    background: "#eef1f4",
    text: "#1c2733",
    accent: "#ff6a5b",
    displayFont: "Helvetica",
    bodyFont: "system-ui",
    heroScale: 156 / 168,
    bodyScale: 30 / 36,
    radius: 8,
  },
  {
    background: "#fdf6e3",
    text: "#073642",
    accent: "#b58900",
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 144 / 168,
    bodyScale: 28 / 36,
    radius: 14,
  },
  {
    background: "#ede2cc",
    text: "#3a2a1a",
    accent: "#2f6e3a",
    displayFont: "Times New Roman",
    bodyFont: "Georgia",
    heroScale: 1,
    bodyScale: 32 / 36,
    radius: 4,
  },
  {
    background: "#ffffff",
    text: "#0a0a0a",
    accent: "#e11d48",
    displayFont: "Helvetica",
    bodyFont: "Helvetica",
    heroScale: 200 / 168,
    bodyScale: 28 / 36,
    radius: 0,
  },
  {
    background: "#fde9d9",
    text: "#3a1f3d",
    accent: "#f97316",
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 184 / 168,
    bodyScale: 1,
    radius: 24,
  },
  {
    background: "#e9f5ee",
    text: "#0f3324",
    accent: "#ec4899",
    displayFont: "system-ui",
    bodyFont: "system-ui",
    heroScale: 160 / 168,
    bodyScale: 32 / 36,
    radius: 16,
  },
  {
    background: "#0a0a0a",
    text: "#f3edd9",
    accent: "#eab308",
    displayFont: "Georgia",
    bodyFont: "Helvetica",
    heroScale: 200 / 168,
    bodyScale: 32 / 36,
    radius: 2,
  },
  {
    background: "#ece2f5",
    text: "#2a1c4a",
    accent: "#facc15",
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 1,
    bodyScale: 34 / 36,
    radius: 20,
  },
  {
    background: "#101418",
    text: "#a7f3d0",
    accent: "#fbbf24",
    displayFont: "Courier New",
    bodyFont: "Courier New",
    heroScale: 144 / 168,
    bodyScale: 24 / 36,
    radius: 4,
  },
  {
    background: "#fafafa",
    text: "#0a0a0a",
    accent: "#facc15",
    displayFont: "Helvetica",
    bodyFont: "Helvetica",
    heroScale: 220 / 168,
    bodyScale: 32 / 36,
    radius: 0,
  },
];

export function shuffleSlideDesignTokens(
  current: SlideDesignTokens,
): SlideDesignTokens {
  const currentSignature = JSON.stringify(current);
  const matchesPreset = DESIGN_PRESETS.some(
    (preset) => JSON.stringify(preset) === JSON.stringify(current),
  );
  const available = matchesPreset
    ? DESIGN_PRESETS.filter(
        (preset) => JSON.stringify(preset) !== currentSignature,
      )
    : DESIGN_PRESETS;
  const selected = available[Math.floor(Math.random() * available.length)]!;
  return { ...selected };
}
