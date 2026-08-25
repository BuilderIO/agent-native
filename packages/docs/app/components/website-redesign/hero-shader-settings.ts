import { useCallback, useEffect, useState } from "react";

export interface HeroShaderSettings {
  particleCount: number;
  color: string;
  colorMode: "solid" | "gradient";
  accentColor: string;
  blinkRate: number;
  spin: number;
  turbulence: number;
  intensity: number;
  animationSpeed: number;
  glow: number;
  scale: number;
  seed: number;
  vignette: number;
  paused: boolean;
}

export const DEFAULT_HERO_SHADER_SETTINGS: HeroShaderSettings = {
  particleCount: 3,
  color: "#595959",
  colorMode: "gradient",
  accentColor: "#1e4245",
  blinkRate: 2,
  spin: 0,
  turbulence: 0.4,
  intensity: 0.3,
  animationSpeed: 0.3,
  glow: 0.1,
  scale: 0.6,
  seed: 0,
  vignette: 1.1,
  paused: false,
};

export type HeroShaderFieldConfig =
  | { kind: "range"; min: number; max: number; step: number }
  | { kind: "color" }
  | { kind: "select"; options: Array<{ label: string; value: string }> }
  | { kind: "boolean" };

export const HERO_SHADER_FIELD_CONFIG: Record<
  keyof HeroShaderSettings,
  HeroShaderFieldConfig
> = {
  particleCount: { kind: "range", min: 1, max: 8, step: 1 },
  color: { kind: "color" },
  colorMode: {
    kind: "select",
    options: [
      { label: "Solid", value: "solid" },
      { label: "Gradient", value: "gradient" },
    ],
  },
  accentColor: { kind: "color" },
  // No lower clamp above zero: 0 fully disables the sparkle blink/pulse.
  blinkRate: { kind: "range", min: 0, max: 15, step: 0.5 },
  spin: { kind: "range", min: -0.15, max: 0.15, step: 0.005 },
  turbulence: { kind: "range", min: 0, max: 1, step: 0.05 },
  intensity: { kind: "range", min: 0.1, max: 1, step: 0.05 },
  animationSpeed: { kind: "range", min: 0, max: 3, step: 0.1 },
  glow: { kind: "range", min: 0, max: 3, step: 0.1 },
  scale: { kind: "range", min: 0.5, max: 3, step: 0.1 },
  seed: { kind: "range", min: 0, max: 100, step: 1 },
  vignette: { kind: "range", min: 0, max: 2, step: 0.1 },
  paused: { kind: "boolean" },
};

const STORAGE_KEY = "website-redesign:hero-shader-settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStoredHeroShaderSettings(): HeroShaderSettings {
  if (typeof window === "undefined") return DEFAULT_HERO_SHADER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HERO_SHADER_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_HERO_SHADER_SETTINGS;
    return { ...DEFAULT_HERO_SHADER_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_HERO_SHADER_SETTINGS;
  }
}

function writeStoredHeroShaderSettings(settings: HeroShaderSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private-mode/quota storage failures just mean tweaks don't persist
    // across reloads — the shader keeps rendering with the in-memory values.
  }
}

export function useHeroShaderSettings() {
  const [settings, setSettings] = useState<HeroShaderSettings>(
    DEFAULT_HERO_SHADER_SETTINGS,
  );

  useEffect(() => {
    setSettings(readStoredHeroShaderSettings());
  }, []);

  const updateSetting = useCallback(
    <K extends keyof HeroShaderSettings>(
      key: K,
      value: HeroShaderSettings[K],
    ) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        writeStoredHeroShaderSettings(next);
        return next;
      });
    },
    [],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_HERO_SHADER_SETTINGS);
    writeStoredHeroShaderSettings(DEFAULT_HERO_SHADER_SETTINGS);
  }, []);

  return { settings, updateSetting, resetSettings };
}
