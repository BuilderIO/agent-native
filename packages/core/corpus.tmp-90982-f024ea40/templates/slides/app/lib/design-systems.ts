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
          { value: "#00E5FF", label: "Cyan", color: "#00E5FF" },
          { value: "#609FF8", label: "Blue", color: "#609FF8" },
          { value: "#4ADE80", label: "Green", color: "#4ADE80" },
          { value: "#F472B6", label: "Pink", color: "#F472B6" },
          { value: "#FBBF24", label: "Gold", color: "#FBBF24" },
        ],
        defaultValue: "#00E5FF",
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
      accent: "#00E5FF",
      background: "#000000",
      text: "#ffffff",
      textMuted: "rgba(255,255,255,0.55)",
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
          { value: "#2563EB", label: "Blue", color: "#2563EB" },
          { value: "#0891B2", label: "Teal", color: "#0891B2" },
          { value: "#7C3AED", label: "Violet", color: "#7C3AED" },
          { value: "#DC2626", label: "Red", color: "#DC2626" },
          { value: "#059669", label: "Emerald", color: "#059669" },
        ],
        defaultValue: "#2563EB",
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
      accent: "#2563EB",
      background: "#FFFFFF",
      text: "#1a1a1a",
      textMuted: "rgba(0,0,0,0.5)",
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
          { value: "#1E40AF", label: "Navy", color: "#1E40AF" },
          { value: "#0F766E", label: "Teal", color: "#0F766E" },
          { value: "#92400E", label: "Amber", color: "#92400E" },
          { value: "#6B21A8", label: "Purple", color: "#6B21A8" },
          { value: "#166534", label: "Green", color: "#166534" },
        ],
        defaultValue: "#1E40AF",
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
      accent: "#1E40AF",
      background: "#F8FAFC",
      text: "#0F172A",
      textMuted: "rgba(15,23,42,0.55)",
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
          { value: "#404040", label: "Charcoal", color: "#404040" },
          { value: "#737373", label: "Gray", color: "#737373" },
          { value: "#171717", label: "Black", color: "#171717" },
          { value: "#A3A3A3", label: "Silver", color: "#A3A3A3" },
          { value: "#525252", label: "Zinc", color: "#525252" },
        ],
        defaultValue: "#404040",
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
      accent: "#404040",
      background: "#FAFAFA",
      text: "#262626",
      textMuted: "rgba(38,38,38,0.5)",
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
