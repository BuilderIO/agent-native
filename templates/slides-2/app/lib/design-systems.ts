export interface TweakDefinition {
  id: string;
  label: string;
  type: "color-swatches" | "segment" | "toggle" | "slider";
  options?: { value: string; label: string; color?: string }[];
  defaultValue: string | number | boolean;
  cssVar?: string;
}

export interface DesignSystemPreset {
  id: string;
  name: string;
  tweaks: TweakDefinition[];
  defaultTokens: {
    accent: string;
    background: string;
    text: string;
    textMuted: string;
    headingFont: string;
    bodyFont: string;
  };
}

export const DESIGN_SYSTEM_PRESETS: DesignSystemPreset[] = [
  {
    id: "default",
    name: "Dark",
    tweaks: [
      {
        id: "accentColor",
        label: "Accent color",
        type: "color-swatches",
        options: [
          { value: "#00E5FF", label: "Cyan", color: "#00E5FF" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#609FF8", label: "Blue", color: "#609FF8" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#4ADE80", label: "Green", color: "#4ADE80" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#F472B6", label: "Pink", color: "#F472B6" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#FBBF24", label: "Gold", color: "#FBBF24" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
        ],
        defaultValue: "#00E5FF", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
        cssVar: "--ds-accent",
      },
      {
        id: "titleCase",
        label: "Title case",
        type: "segment",
        options: [
          { value: "lowercase", label: "lower" },
          { value: "capitalize", label: "Title" },
          { value: "uppercase", label: "UPPER" },
        ],
        defaultValue: "uppercase",
      },
      {
        id: "paperBackground",
        label: "Paper background",
        type: "segment",
        options: [
          { value: "warm", label: "warm" },
          { value: "cool", label: "cool" },
          { value: "dark", label: "dark" },
        ],
        defaultValue: "dark",
      },
    ],
    defaultTokens: {
      accent: "#00E5FF", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      background: "#000000", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      text: "#ffffff", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      textMuted: "rgba(255,255,255,0.55)", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      headingFont: "Poppins",
      bodyFont: "Poppins",
    },
  },
  {
    id: "light",
    name: "Light",
    tweaks: [
      {
        id: "accentColor",
        label: "Accent color",
        type: "color-swatches",
        options: [
          { value: "#2563EB", label: "Blue", color: "#2563EB" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#0891B2", label: "Teal", color: "#0891B2" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#7C3AED", label: "Violet", color: "#7C3AED" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#DC2626", label: "Red", color: "#DC2626" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#059669", label: "Emerald", color: "#059669" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
        ],
        defaultValue: "#2563EB", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
        cssVar: "--ds-accent",
      },
      {
        id: "titleCase",
        label: "Title case",
        type: "segment",
        options: [
          { value: "lowercase", label: "lower" },
          { value: "capitalize", label: "Title" },
          { value: "uppercase", label: "UPPER" },
        ],
        defaultValue: "capitalize",
      },
      {
        id: "paperBackground",
        label: "Paper background",
        type: "segment",
        options: [
          { value: "warm", label: "warm" },
          { value: "cool", label: "cool" },
          { value: "white", label: "white" },
        ],
        defaultValue: "white",
      },
    ],
    defaultTokens: {
      accent: "#2563EB", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      background: "#FFFFFF", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      text: "#1a1a1a", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      textMuted: "rgba(0,0,0,0.5)", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      headingFont: "Inter",
      bodyFont: "Inter",
    },
  },
  {
    id: "corporate",
    name: "Corporate",
    tweaks: [
      {
        id: "accentColor",
        label: "Accent color",
        type: "color-swatches",
        options: [
          { value: "#1E40AF", label: "Navy", color: "#1E40AF" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#0F766E", label: "Teal", color: "#0F766E" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#92400E", label: "Amber", color: "#92400E" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#6B21A8", label: "Purple", color: "#6B21A8" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#166534", label: "Green", color: "#166534" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
        ],
        defaultValue: "#1E40AF", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
        cssVar: "--ds-accent",
      },
      {
        id: "titleCase",
        label: "Title case",
        type: "segment",
        options: [
          { value: "lowercase", label: "lower" },
          { value: "capitalize", label: "Title" },
          { value: "uppercase", label: "UPPER" },
        ],
        defaultValue: "capitalize",
      },
      {
        id: "paperBackground",
        label: "Paper background",
        type: "segment",
        options: [
          { value: "warm", label: "warm" },
          { value: "slate", label: "slate" },
          { value: "white", label: "white" },
        ],
        defaultValue: "white",
      },
    ],
    defaultTokens: {
      accent: "#1E40AF", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      background: "#F8FAFC", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      text: "#0F172A", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      textMuted: "rgba(15,23,42,0.55)", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      headingFont: "Inter",
      bodyFont: "Inter",
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    tweaks: [
      {
        id: "accentColor",
        label: "Accent color",
        type: "color-swatches",
        options: [
          { value: "#404040", label: "Charcoal", color: "#404040" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#737373", label: "Gray", color: "#737373" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#171717", label: "Black", color: "#171717" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#A3A3A3", label: "Silver", color: "#A3A3A3" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
          { value: "#525252", label: "Zinc", color: "#525252" }, // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
        ],
        defaultValue: "#404040", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
        cssVar: "--ds-accent",
      },
      {
        id: "titleCase",
        label: "Title case",
        type: "segment",
        options: [
          { value: "lowercase", label: "lower" },
          { value: "capitalize", label: "Title" },
          { value: "uppercase", label: "UPPER" },
        ],
        defaultValue: "lowercase",
      },
      {
        id: "paperBackground",
        label: "Paper background",
        type: "segment",
        options: [
          { value: "warm", label: "warm" },
          { value: "cool", label: "cool" },
          { value: "white", label: "white" },
        ],
        defaultValue: "cool",
      },
    ],
    defaultTokens: {
      accent: "#404040", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      background: "#FAFAFA", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      text: "#262626", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      textMuted: "rgba(38,38,38,0.5)", // guard:allow-raw-color — saved slide design-system palette value, not app chrome.
      headingFont: "Inter",
      bodyFont: "Inter",
    },
  },
];

export function getPreset(id: string): DesignSystemPreset {
  return (
    DESIGN_SYSTEM_PRESETS.find((p) => p.id === id) || DESIGN_SYSTEM_PRESETS[0]
  );
}
