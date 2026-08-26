import { useCallback, useEffect, useRef, useState } from "react";

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
  | { kind: "boolean" }
  | { kind: "number"; min?: number; max?: number; step: number };

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

export type HeroShaderVariant = "constellation" | "ribbon-field";

export interface RibbonFieldSettings {
  ribbonCount: number;
  density: number;
  flowAngle: number;
  warp: number;
  speed: number;
  pointerAmount: number;
  smoothing: number;
  focusX: number;
  focusY: number;
  spread: number;
  contrast: number;
  glow: number;
  brightness: number;
  intensity: number;
  seed: number;
  vignette: number;
  paused: boolean;
}

export const DEFAULT_RIBBON_FIELD_SETTINGS: RibbonFieldSettings = {
  ribbonCount: 3,
  density: 1,
  flowAngle: -35,
  warp: 0.35,
  speed: 1,
  pointerAmount: 1,
  smoothing: 0.035,
  focusX: 0.6,
  focusY: -0.55,
  spread: 1,
  contrast: 0.5,
  glow: 0.3,
  brightness: 1.4,
  intensity: 0.7,
  seed: 0,
  vignette: 1.1,
  paused: false,
};

export const RIBBON_FIELD_FIELD_CONFIG: Record<
  keyof RibbonFieldSettings,
  HeroShaderFieldConfig
> = {
  ribbonCount: { kind: "range", min: 1, max: 4, step: 1 },
  density: { kind: "number", min: 0.1, max: 50, step: 0.1 },
  flowAngle: { kind: "range", min: -180, max: 180, step: 1 },
  warp: { kind: "range", min: 0, max: 1, step: 0.05 },
  speed: { kind: "range", min: 0, max: 3, step: 0.1 },
  pointerAmount: { kind: "range", min: 0, max: 2, step: 0.05 },
  smoothing: { kind: "range", min: 0.005, max: 0.15, step: 0.005 },
  focusX: { kind: "range", min: -1, max: 1, step: 0.05 },
  focusY: { kind: "range", min: -1, max: 1, step: 0.05 },
  spread: { kind: "range", min: 0.2, max: 2, step: 0.05 },
  contrast: { kind: "range", min: 0, max: 1, step: 0.05 },
  glow: { kind: "range", min: 0, max: 1, step: 0.05 },
  brightness: { kind: "range", min: 0, max: 3, step: 0.1 },
  intensity: { kind: "range", min: 0.1, max: 1, step: 0.05 },
  seed: { kind: "range", min: 0, max: 100, step: 1 },
  vignette: { kind: "range", min: 0, max: 2, step: 0.1 },
  paused: { kind: "boolean" },
};

const STORAGE_KEY = "website-redesign:hero-shader-settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface StoredHeroShaderState {
  variant: HeroShaderVariant;
  constellation: HeroShaderSettings;
  ribbonField: RibbonFieldSettings;
}

function readStoredHeroShaderState(): StoredHeroShaderState {
  const fallback: StoredHeroShaderState = {
    variant: "constellation",
    constellation: DEFAULT_HERO_SHADER_SETTINGS,
    ribbonField: DEFAULT_RIBBON_FIELD_SETTINGS,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return fallback;

    // Pre-variant saves are a flat HeroShaderSettings blob (no `variant`
    // key); treat the whole thing as legacy Constellation settings instead
    // of discarding tweaks people already saved.
    if (typeof parsed.variant !== "string") {
      return {
        variant: "constellation",
        constellation: { ...DEFAULT_HERO_SHADER_SETTINGS, ...parsed },
        ribbonField: DEFAULT_RIBBON_FIELD_SETTINGS,
      };
    }

    const variant: HeroShaderVariant =
      parsed.variant === "ribbon-field" ? "ribbon-field" : "constellation";
    return {
      variant,
      constellation: {
        ...DEFAULT_HERO_SHADER_SETTINGS,
        ...(isRecord(parsed.constellation) ? parsed.constellation : {}),
      },
      ribbonField: {
        ...DEFAULT_RIBBON_FIELD_SETTINGS,
        ...(isRecord(parsed.ribbonField) ? parsed.ribbonField : {}),
      },
    };
  } catch {
    return fallback;
  }
}

function writeStoredHeroShaderState(state: StoredHeroShaderState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // coercion-ok: Private-mode/quota storage failures just mean tweaks don't persist across reloads
  }
}

export function useHeroShaderSettings() {
  const [variant, setVariantState] = useState<HeroShaderVariant>("constellation");
  const [constellation, setConstellation] = useState<HeroShaderSettings>(
    DEFAULT_HERO_SHADER_SETTINGS,
  );
  const [ribbonField, setRibbonField] = useState<RibbonFieldSettings>(
    DEFAULT_RIBBON_FIELD_SETTINGS,
  );

  // Persisted writes need the latest values of all three pieces of state at
  // once, so this ref is kept in sync on every render instead of nesting
  // setState callbacks just to read current state.
  const stateRef = useRef<StoredHeroShaderState>({
    variant,
    constellation,
    ribbonField,
  });
  stateRef.current = { variant, constellation, ribbonField };

  useEffect(() => {
    const stored = readStoredHeroShaderState();
    setVariantState(stored.variant);
    setConstellation(stored.constellation);
    setRibbonField(stored.ribbonField);
  }, []);

  const setVariant = useCallback((next: HeroShaderVariant) => {
    setVariantState(next);
    writeStoredHeroShaderState({ ...stateRef.current, variant: next });
  }, []);

  const updateConstellationSetting = useCallback(
    <K extends keyof HeroShaderSettings>(
      key: K,
      value: HeroShaderSettings[K],
    ) => {
      const next = { ...stateRef.current.constellation, [key]: value };
      setConstellation(next);
      writeStoredHeroShaderState({ ...stateRef.current, constellation: next });
    },
    [],
  );

  const resetConstellationSettings = useCallback(() => {
    setConstellation(DEFAULT_HERO_SHADER_SETTINGS);
    writeStoredHeroShaderState({
      ...stateRef.current,
      constellation: DEFAULT_HERO_SHADER_SETTINGS,
    });
  }, []);

  const updateRibbonFieldSetting = useCallback(
    <K extends keyof RibbonFieldSettings>(
      key: K,
      value: RibbonFieldSettings[K],
    ) => {
      const next = { ...stateRef.current.ribbonField, [key]: value };
      setRibbonField(next);
      writeStoredHeroShaderState({ ...stateRef.current, ribbonField: next });
    },
    [],
  );

  const resetRibbonFieldSettings = useCallback(() => {
    setRibbonField(DEFAULT_RIBBON_FIELD_SETTINGS);
    writeStoredHeroShaderState({
      ...stateRef.current,
      ribbonField: DEFAULT_RIBBON_FIELD_SETTINGS,
    });
  }, []);

  return {
    variant,
    setVariant,
    constellation: {
      settings: constellation,
      updateSetting: updateConstellationSetting,
      resetSettings: resetConstellationSettings,
    },
    ribbonField: {
      settings: ribbonField,
      updateSetting: updateRibbonFieldSetting,
      resetSettings: resetRibbonFieldSettings,
    },
  };
}
