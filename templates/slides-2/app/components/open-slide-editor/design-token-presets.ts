import type { SlideDesignTokens } from "../open-slide-runtime/protocol";

const DESIGN_PRESETS: readonly SlideDesignTokens[] = [
  {
    background: "#f7f5f0", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#1a1814", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#6d4cff", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 1,
    bodyScale: 1,
    radius: 12,
  },
  {
    background: "#0f1115", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#f5f3ee", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#7cc4ff", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 192 / 168,
    bodyScale: 32 / 36,
    radius: 6,
  },
  {
    background: "#eef1f4", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#1c2733", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#ff6a5b", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Helvetica",
    bodyFont: "system-ui",
    heroScale: 156 / 168,
    bodyScale: 30 / 36,
    radius: 8,
  },
  {
    background: "#fdf6e3", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#073642", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#b58900", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 144 / 168,
    bodyScale: 28 / 36,
    radius: 14,
  },
  {
    background: "#ede2cc", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#3a2a1a", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#2f6e3a", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Times New Roman",
    bodyFont: "Georgia",
    heroScale: 1,
    bodyScale: 32 / 36,
    radius: 4,
  },
  {
    background: "#ffffff", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#0a0a0a", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#e11d48", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Helvetica",
    bodyFont: "Helvetica",
    heroScale: 200 / 168,
    bodyScale: 28 / 36,
    radius: 0,
  },
  {
    background: "#fde9d9", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#3a1f3d", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#f97316", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 184 / 168,
    bodyScale: 1,
    radius: 24,
  },
  {
    background: "#e9f5ee", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#0f3324", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#ec4899", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "system-ui",
    bodyFont: "system-ui",
    heroScale: 160 / 168,
    bodyScale: 32 / 36,
    radius: 16,
  },
  {
    background: "#0a0a0a", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#f3edd9", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#eab308", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Georgia",
    bodyFont: "Helvetica",
    heroScale: 200 / 168,
    bodyScale: 32 / 36,
    radius: 2,
  },
  {
    background: "#ece2f5", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#2a1c4a", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#facc15", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Georgia",
    bodyFont: "system-ui",
    heroScale: 1,
    bodyScale: 34 / 36,
    radius: 20,
  },
  {
    background: "#101418", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#a7f3d0", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#fbbf24", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    displayFont: "Courier New",
    bodyFont: "Courier New",
    heroScale: 144 / 168,
    bodyScale: 24 / 36,
    radius: 4,
  },
  {
    background: "#fafafa", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    text: "#0a0a0a", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
    accent: "#facc15", // guard:allow-raw-color — saved slide theme preset value, not app chrome.
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
