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

export type HeroShaderVariant = "constellation" | "ribbon-field" | "atmosphere";

export interface RibbonFieldSettings {
  waveCount: number;
  waveScale: number;
  flowAngle: number;
  warp: number;
  speed: number;
  pointerAmount: number;
  smoothing: number;
  focusX: number;
  focusY: number;
  spread: number;
  dither: number;
  dotDensity: number;
  dotScale: number;
  contrast: number;
  glow: number;
  brightness: number;
  intensity: number;
  seed: number;
  vignette: number;
  paused: boolean;
}

export const DEFAULT_RIBBON_FIELD_SETTINGS: RibbonFieldSettings = {
  waveCount: 3,
  waveScale: 2.6,
  flowAngle: -35,
  warp: 0.4,
  speed: 0.3,
  pointerAmount: 0.45,
  smoothing: 0.09,
  focusX: 0,
  focusY: 0,
  spread: 1.5,
  dither: 0.35,
  dotDensity: 110,
  dotScale: 1.1,
  contrast: 0.5,
  glow: 0.25,
  brightness: 2.2,
  intensity: 0.9,
  seed: 56,
  vignette: 0.4,
  paused: false,
};

export const RIBBON_FIELD_FIELD_CONFIG: Record<
  keyof RibbonFieldSettings,
  HeroShaderFieldConfig
> = {
  waveCount: { kind: "range", min: 1, max: 5, step: 1 },
  waveScale: { kind: "number", min: 0.1, max: 20, step: 0.1 },
  flowAngle: { kind: "range", min: -180, max: 180, step: 1 },
  warp: { kind: "range", min: 0, max: 1, step: 0.05 },
  speed: { kind: "range", min: 0, max: 3, step: 0.1 },
  pointerAmount: { kind: "range", min: 0, max: 2, step: 0.05 },
  smoothing: { kind: "range", min: 0.005, max: 0.15, step: 0.005 },
  focusX: { kind: "range", min: -1, max: 1, step: 0.05 },
  focusY: { kind: "range", min: -1, max: 1, step: 0.05 },
  spread: { kind: "range", min: 0.2, max: 3, step: 0.05 },
  dither: { kind: "range", min: 0, max: 1.5, step: 0.05 },
  dotDensity: { kind: "number", min: 4, max: 400, step: 1 },
  dotScale: { kind: "range", min: 0.2, max: 2, step: 0.05 },
  contrast: { kind: "range", min: 0, max: 1, step: 0.05 },
  glow: { kind: "range", min: 0, max: 1, step: 0.05 },
  brightness: { kind: "range", min: 0, max: 3, step: 0.1 },
  intensity: { kind: "range", min: 0.1, max: 1, step: 0.05 },
  seed: { kind: "range", min: 0, max: 100, step: 1 },
  vignette: { kind: "range", min: 0, max: 2, step: 0.1 },
  paused: { kind: "boolean" },
};

export interface AtmosphereSettings {
  planetRadius: number;
  atmosphereThickness: number;
  fov: number;
  eyeDistance: number;
  centerX: number;
  centerY: number;
  lightPitch: number;
  lightYawStart: number;
  lightYawEnd: number;
  lightSpeed: number;
  rayleighR: number;
  rayleighG: number;
  rayleighB: number;
  rayleighHeight: number;
  mieStrength: number;
  mieExtinction: number;
  mieHeight: number;
  mieG: number;
  exposure: number;
  gamma: number;
  outScatterSteps: number;
  inScatterSteps: number;
  lightSaturation: number;
  lightScreenAmount: number;
  introDuration: number;
  warpAmount: number;
  warpScale: number;
  warpSpeed: number;
  ditherMode: "noise" | "ordered";
  ditherAmount: number;
  ditherScale: number;
  ditherSpeed: number;
  posterizeLevels: number;
  intensity: number;
  paused: boolean;
}

export const DEFAULT_ATMOSPHERE_SETTINGS: AtmosphereSettings = {
  planetRadius: 1.35,
  atmosphereThickness: 0.55,
  fov: 61,
  eyeDistance: 5.5,
  centerX: 0.95,
  centerY: 0.5,
  lightPitch: 3,
  lightYawStart: -180,
  lightYawEnd: -91,
  lightSpeed: 0.06,
  rayleighR: 3.8,
  rayleighG: 13.5,
  rayleighB: 33.1,
  rayleighHeight: 0.05,
  mieStrength: 21,
  mieExtinction: 1.1,
  mieHeight: 0.02,
  mieG: -0.78,
  exposure: 6,
  gamma: 1.05,
  outScatterSteps: 5,
  inScatterSteps: 52,
  lightSaturation: 4,
  lightScreenAmount: 0.65,
  introDuration: 2.4,
  warpAmount: 60,
  warpScale: 2.4,
  warpSpeed: 0.11,
  ditherMode: "ordered",
  ditherAmount: 5.5,
  ditherScale: 3,
  ditherSpeed: 0,
  posterizeLevels: 8,
  intensity: 0.9,
  paused: false,
};

export const ATMOSPHERE_FIELD_CONFIG: Record<
  keyof AtmosphereSettings,
  HeroShaderFieldConfig
> = {
  planetRadius: { kind: "range", min: 0.3, max: 2.2, step: 0.05 },
  atmosphereThickness: { kind: "range", min: 0.05, max: 2, step: 0.05 },
  fov: { kind: "range", min: 15, max: 100, step: 1 },
  eyeDistance: { kind: "range", min: 1.2, max: 8, step: 0.1 },
  centerX: { kind: "range", min: 0, max: 1, step: 0.01 },
  centerY: { kind: "range", min: -0.5, max: 1.5, step: 0.01 },
  lightPitch: { kind: "range", min: -90, max: 90, step: 1 },
  lightYawStart: { kind: "range", min: -180, max: 180, step: 1 },
  lightYawEnd: { kind: "range", min: -180, max: 180, step: 1 },
  lightSpeed: { kind: "range", min: -2, max: 2, step: 0.02 },
  rayleighR: { kind: "range", min: 0, max: 50, step: 0.1 },
  rayleighG: { kind: "range", min: 0, max: 50, step: 0.1 },
  rayleighB: { kind: "range", min: 0, max: 50, step: 0.1 },
  rayleighHeight: { kind: "range", min: 0.005, max: 0.3, step: 0.005 },
  mieStrength: { kind: "range", min: 0, max: 60, step: 0.5 },
  mieExtinction: { kind: "range", min: 0.1, max: 3, step: 0.05 },
  mieHeight: { kind: "range", min: 0.002, max: 0.2, step: 0.002 },
  mieG: { kind: "range", min: -0.999, max: -0.05, step: 0.01 },
  exposure: { kind: "range", min: 1, max: 40, step: 0.5 },
  gamma: { kind: "range", min: 1, max: 3, step: 0.05 },
  outScatterSteps: { kind: "range", min: 2, max: 16, step: 1 },
  inScatterSteps: { kind: "range", min: 8, max: 128, step: 4 },
  lightSaturation: { kind: "range", min: 0, max: 4, step: 0.05 },
  lightScreenAmount: { kind: "range", min: 0, max: 1, step: 0.05 },
  introDuration: { kind: "range", min: 0, max: 8, step: 0.1 },
  warpAmount: { kind: "range", min: 0, max: 150, step: 1 },
  warpScale: { kind: "range", min: 0.1, max: 6, step: 0.1 },
  warpSpeed: { kind: "range", min: 0, max: 2, step: 0.01 },
  ditherMode: {
    kind: "select",
    options: [
      { label: "Noise (grain)", value: "noise" },
      { label: "Ordered (Bayer)", value: "ordered" },
    ],
  },
  ditherAmount: { kind: "range", min: 0, max: 48, step: 0.5 },
  ditherScale: { kind: "range", min: 1, max: 16, step: 1 },
  ditherSpeed: { kind: "range", min: 0, max: 30, step: 1 },
  posterizeLevels: { kind: "range", min: 2, max: 24, step: 1 },
  intensity: { kind: "range", min: 0.1, max: 1, step: 0.05 },
  paused: { kind: "boolean" },
};

const STORAGE_KEY = "website-redesign:hero-shader-settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface StoredHeroShaderState {
  variant: HeroShaderVariant;
  constellation: HeroShaderSettings;
  // Persisted as `ribbonWaves`, not `ribbonField`. The Ribbon Field shader was
  // rewritten from a halftone dot matrix to posterized waves, and the shared
  // parameter names (focus, spread, contrast, glow) changed meaning in the
  // process -- values tuned for the old shader render the new one invisible.
  // A new key means those stale blobs are simply not read, so everyone lands
  // on the current defaults instead of a broken-looking field.
  ribbonWaves: RibbonFieldSettings;
  atmosphere: AtmosphereSettings;
}

function readStoredHeroShaderState(): StoredHeroShaderState {
  const fallback: StoredHeroShaderState = {
    variant: "constellation",
    constellation: DEFAULT_HERO_SHADER_SETTINGS,
    ribbonWaves: DEFAULT_RIBBON_FIELD_SETTINGS,
    atmosphere: DEFAULT_ATMOSPHERE_SETTINGS,
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
        ribbonWaves: DEFAULT_RIBBON_FIELD_SETTINGS,
        atmosphere: DEFAULT_ATMOSPHERE_SETTINGS,
      };
    }

    const variant: HeroShaderVariant =
      parsed.variant === "ribbon-field"
        ? "ribbon-field"
        : parsed.variant === "atmosphere"
          ? "atmosphere"
          : "constellation";
    return {
      variant,
      constellation: {
        ...DEFAULT_HERO_SHADER_SETTINGS,
        ...(isRecord(parsed.constellation) ? parsed.constellation : {}),
      },
      ribbonWaves: {
        ...DEFAULT_RIBBON_FIELD_SETTINGS,
        ...(isRecord(parsed.ribbonWaves) ? parsed.ribbonWaves : {}),
      },
      atmosphere: {
        ...DEFAULT_ATMOSPHERE_SETTINGS,
        ...(isRecord(parsed.atmosphere) ? parsed.atmosphere : {}),
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
  const [ribbonWaves, setRibbonWaves] = useState<RibbonFieldSettings>(
    DEFAULT_RIBBON_FIELD_SETTINGS,
  );
  const [atmosphere, setAtmosphere] = useState<AtmosphereSettings>(
    DEFAULT_ATMOSPHERE_SETTINGS,
  );

  // Persisted writes need the latest values of all four pieces of state at
  // once, so this ref is kept in sync on every render instead of nesting
  // setState callbacks just to read current state.
  const stateRef = useRef<StoredHeroShaderState>({
    variant,
    constellation,
    ribbonWaves,
    atmosphere,
  });
  stateRef.current = { variant, constellation, ribbonWaves, atmosphere };

  useEffect(() => {
    const stored = readStoredHeroShaderState();
    setVariantState(stored.variant);
    setConstellation(stored.constellation);
    setRibbonWaves(stored.ribbonWaves);
    setAtmosphere(stored.atmosphere);
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
      const next = { ...stateRef.current.ribbonWaves, [key]: value };
      setRibbonWaves(next);
      writeStoredHeroShaderState({ ...stateRef.current, ribbonWaves: next });
    },
    [],
  );

  const resetRibbonFieldSettings = useCallback(() => {
    setRibbonWaves(DEFAULT_RIBBON_FIELD_SETTINGS);
    writeStoredHeroShaderState({
      ...stateRef.current,
      ribbonWaves: DEFAULT_RIBBON_FIELD_SETTINGS,
    });
  }, []);

  const updateAtmosphereSetting = useCallback(function updateAtmosphereSetting<
    K extends keyof AtmosphereSettings,
  >(key: K, value: AtmosphereSettings[K]) {
    const next = { ...stateRef.current.atmosphere, [key]: value };
    setAtmosphere(next);
    writeStoredHeroShaderState({ ...stateRef.current, atmosphere: next });
  }, []);

  const resetAtmosphereSettings = useCallback(() => {
    setAtmosphere(DEFAULT_ATMOSPHERE_SETTINGS);
    writeStoredHeroShaderState({
      ...stateRef.current,
      atmosphere: DEFAULT_ATMOSPHERE_SETTINGS,
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
      settings: ribbonWaves,
      updateSetting: updateRibbonFieldSetting,
      resetSettings: resetRibbonFieldSettings,
    },
    atmosphere: {
      settings: atmosphere,
      updateSetting: updateAtmosphereSetting,
      resetSettings: resetAtmosphereSettings,
    },
  };
}
