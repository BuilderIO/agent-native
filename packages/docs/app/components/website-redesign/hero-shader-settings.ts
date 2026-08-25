import { useCallback, useEffect, useState } from "react";

export interface HeroShaderSettings {
  particleCount: number;
  color: string;
  blinkRate: number;
  spin: number;
  turbulence: number;
  intensity: number;
}

export const DEFAULT_HERO_SHADER_SETTINGS: HeroShaderSettings = {
  particleCount: 4,
  color: "#595959",
  blinkRate: 5,
  spin: 0.03,
  turbulence: 0.4,
  intensity: 0.7,
};

export const HERO_SHADER_SETTINGS_RANGES: Record<
  keyof HeroShaderSettings,
  { min: number; max: number; step: number } | null
> = {
  particleCount: { min: 1, max: 8, step: 1 },
  color: null,
  blinkRate: { min: 1, max: 15, step: 0.5 },
  spin: { min: -0.15, max: 0.15, step: 0.005 },
  turbulence: { min: 0, max: 1, step: 0.05 },
  intensity: { min: 0.1, max: 1, step: 0.05 },
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
