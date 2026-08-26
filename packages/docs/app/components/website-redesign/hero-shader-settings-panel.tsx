import { IconCheck, IconCopy, IconSettings } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Select } from "./ds/select";
import { Toggle } from "./ds/toggle";
import {
  ATMOSPHERE_FIELD_CONFIG,
  HERO_SHADER_FIELD_CONFIG,
  RIBBON_FIELD_FIELD_CONFIG,
  type AtmosphereSettings,
  type HeroShaderFieldConfig,
  type HeroShaderSettings,
  type HeroShaderVariant,
  type RibbonFieldSettings,
} from "./hero-shader-settings";

type ShaderSettings =
  | HeroShaderSettings
  | RibbonFieldSettings
  | AtmosphereSettings;

type ShaderFieldKey =
  | keyof HeroShaderSettings
  | keyof RibbonFieldSettings
  | keyof AtmosphereSettings;

const FIELD_LABELS: Record<ShaderFieldKey, string> = {
  particleCount: "Particle count",
  color: "Color",
  colorMode: "Color mode",
  accentColor: "Accent color",
  blinkRate: "Blink rate",
  spin: "Spin",
  turbulence: "Turbulence",
  intensity: "Opacity",
  animationSpeed: "Animation speed",
  glow: "Glow",
  scale: "Scale / density",
  seed: "Seed",
  vignette: "Vignette",
  paused: "Pause animation",
  ribbonCount: "Ribbon count",
  density: "Dot density",
  flowAngle: "Flow angle",
  warp: "Warp",
  speed: "Speed",
  pointerAmount: "Pointer amount",
  smoothing: "Pointer smoothing",
  focusX: "Focus X",
  focusY: "Focus Y",
  spread: "Focus spread",
  contrast: "Contrast",
  brightness: "Brightness",
  dotScale: "Dot scale",
  planetRadius: "Planet radius",
  atmosphereThickness: "Atmosphere thickness",
  fov: "Field of view",
  eyeDistance: "Camera distance",
  centerX: "Center X",
  centerY: "Center Y",
  lightPitch: "Light pitch",
  lightYawOffset: "Light yaw offset",
  lightSpeed: "Light rotation speed",
  rayleighR: "Rayleigh red",
  rayleighG: "Rayleigh green",
  rayleighB: "Rayleigh blue",
  rayleighHeight: "Rayleigh height",
  mieStrength: "Mie strength",
  mieExtinction: "Mie extinction",
  mieHeight: "Mie height",
  mieG: "Mie anisotropy (g)",
  exposure: "Exposure",
  gamma: "Gamma",
  outScatterSteps: "Out-scatter steps",
  inScatterSteps: "In-scatter steps",
};

const CONSTELLATION_FIELD_ORDER: Array<keyof HeroShaderSettings> = [
  "particleCount",
  "scale",
  "spin",
  "animationSpeed",
  "turbulence",
  "blinkRate",
  "glow",
  "vignette",
  "seed",
  "colorMode",
  "color",
  "accentColor",
  "intensity",
  "paused",
];

const RIBBON_FIELD_ORDER: Array<keyof RibbonFieldSettings> = [
  "ribbonCount",
  "density",
  "flowAngle",
  "warp",
  "speed",
  "pointerAmount",
  "smoothing",
  "focusX",
  "focusY",
  "spread",
  "contrast",
  "glow",
  "brightness",
  "dotScale",
  "vignette",
  "seed",
  "intensity",
  "paused",
];

const ATMOSPHERE_FIELD_ORDER: Array<keyof AtmosphereSettings> = [
  "planetRadius",
  "atmosphereThickness",
  "centerX",
  "centerY",
  "fov",
  "eyeDistance",
  "lightPitch",
  "lightYawOffset",
  "lightSpeed",
  "rayleighR",
  "rayleighG",
  "rayleighB",
  "rayleighHeight",
  "mieStrength",
  "mieExtinction",
  "mieHeight",
  "mieG",
  "exposure",
  "gamma",
  "outScatterSteps",
  "inScatterSteps",
  "intensity",
  "paused",
];

interface HeroShaderSettingsPanelProps<T extends ShaderSettings> {
  variant: HeroShaderVariant;
  settings: T;
  onChange: <K extends keyof T>(key: K, value: T[K]) => void;
  onReset: () => void;
}

export function HeroShaderSettingsPanel<T extends ShaderSettings>({
  variant,
  settings,
  onChange,
  onReset,
}: HeroShaderSettingsPanelProps<T>) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const fieldOrder = (
    variant === "ribbon-field"
      ? RIBBON_FIELD_ORDER
      : variant === "atmosphere"
        ? ATMOSPHERE_FIELD_ORDER
        : CONSTELLATION_FIELD_ORDER
  ) as Array<keyof T>;
  const fieldConfigMap = (
    variant === "ribbon-field"
      ? RIBBON_FIELD_FIELD_CONFIG
      : variant === "atmosphere"
        ? ATMOSPHERE_FIELD_CONFIG
        : HERO_SHADER_FIELD_CONFIG
  ) as Record<keyof T, HeroShaderFieldConfig>;

  async function handleCopySettings() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ variant, settings }, null, 2),
      );
    } catch {
      // coercion-ok: clipboard permission/availability failures mean the
      // copy silently didn't happen, so skip the success feedback below
      // rather than falsely claiming it worked
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  useEffect(() => {
    if (!open) return;

    function close(e: MouseEvent | TouchEvent) {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div
      style={{
        position: "absolute",
        left: "var(--spacing-6)",
        bottom: "var(--spacing-6)",
        zIndex: 2,
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Shader tweak settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        className="border-[var(--b-action-secondary-border)] hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]"
        style={{
          width: 40,
          height: 40,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderStyle: "solid",
          borderRadius: "var(--b-radius)",
          background: "var(--b-bg-page)",
          color: "var(--b-text-primary)",
          cursor: "pointer",
          outline: "none",
          transition: "background 0.15s, border-color 0.15s",
        }}
      >
        <IconSettings size={18} stroke={1.5} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Shader tweak settings"
            // Portaling to <body> escapes the .builder-brand-tokens wrapper
            // that defines every --b-* var, so it must be reapplied here or
            // the "solid" background resolves to transparent and page
            // content shows through. Pinned as a full-height sidebar
            // (rather than anchored to the trigger button) so it stays put
            // regardless of scroll position.
            className="builder-brand-tokens"
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              height: "100vh",
              width: 300,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "var(--spacing-4)",
              padding: "var(--spacing-4)",
              background: "var(--b-bg-prominent)",
              borderRight: "1px solid var(--b-border-default)",
              boxShadow: "8px 0 24px rgba(0, 0, 0, 0.35)",
              zIndex: 2147483647,
            }}
          >
            {fieldOrder.map((key) => {
              const field = fieldConfigMap[key];
              const label = FIELD_LABELS[key as keyof typeof FIELD_LABELS];
              // Solid color mode must always render solid: gray out (and
              // disable) the accent color input instead of letting it blend
              // in while nothing in the shader is using it. Only applies to
              // Constellation -- Ribbon Field has no color fields at all.
              const disabled =
                variant === "constellation" &&
                key === "accentColor" &&
                (settings as HeroShaderSettings).colorMode !== "gradient";

              return (
                <div
                  key={key as string}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--spacing-1)",
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontFamily: "var(--b-font-sans)",
                      fontSize: "var(--b-t-paragraph-3)",
                      color: "var(--b-text-secondary)",
                    }}
                  >
                    <label
                      htmlFor={
                        field.kind === "number"
                          ? `${panelId}-${String(key)}-number`
                          : `${panelId}-${String(key)}`
                      }
                    >
                      {label}
                    </label>
                    {field.kind === "range" && (
                      <span
                        style={{
                          fontFamily: "var(--b-font-mono)",
                          color: "var(--b-text-primary)",
                        }}
                      >
                        {settings[key] as number}
                      </span>
                    )}
                  </div>

                  {field.kind === "range" && (
                    <input
                      id={`${panelId}-${String(key)}`}
                      type="range"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={settings[key] as number}
                      onChange={(e) =>
                        onChange(key, Number(e.target.value) as T[typeof key])
                      }
                      style={{
                        width: "100%",
                        accentColor: "var(--b-action-primary-bg)",
                      }}
                    />
                  )}

                  {field.kind === "number" && (
                    <input
                      id={`${panelId}-${String(key)}-number`}
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={settings[key] as number}
                      onChange={(e) =>
                        onChange(key, Number(e.target.value) as T[typeof key])
                      }
                      style={{
                        width: "100%",
                        padding: "var(--spacing-1) var(--spacing-2)",
                        fontFamily: "var(--b-font-mono)",
                        fontSize: "var(--b-t-paragraph-3)",
                        color: "var(--b-text-primary)",
                        background: "var(--b-bg-page)",
                        border: "1px solid var(--b-border-default)",
                        borderRadius: "var(--b-radius-sm)",
                      }}
                    />
                  )}

                  {field.kind === "color" && (
                    <input
                      id={`${panelId}-${String(key)}`}
                      type="color"
                      value={settings[key] as string}
                      disabled={disabled}
                      onChange={(e) =>
                        onChange(key, e.target.value as T[typeof key])
                      }
                      style={{
                        width: "100%",
                        height: 28,
                        padding: 0,
                        border: "1px solid var(--b-border-default)",
                        borderRadius: "var(--b-radius-sm)",
                        background: "transparent",
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    />
                  )}

                  {field.kind === "select" && (
                    <Select
                      options={field.options}
                      value={settings[key] as string}
                      onChange={(value) =>
                        onChange(key, value as T[typeof key])
                      }
                    />
                  )}

                  {field.kind === "boolean" && (
                    <Toggle
                      checked={settings[key] as boolean}
                      onChange={(checked) =>
                        onChange(key, checked as T[typeof key])
                      }
                      label={label}
                    />
                  )}
                </div>
              );
            })}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--spacing-3)",
              }}
            >
              <button
                type="button"
                onClick={onReset}
                className="hover:text-[var(--b-text-primary)]"
                style={{
                  fontFamily: "var(--b-font-mono)",
                  fontSize: "var(--b-t-label-2)",
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                  color: "var(--b-text-secondary)",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  transition: "color 0.15s",
                }}
              >
                Reset to defaults
              </button>

              <button
                type="button"
                onClick={handleCopySettings}
                className="hover:text-[var(--b-text-primary)]"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--spacing-1)",
                  fontFamily: "var(--b-font-mono)",
                  fontSize: "var(--b-t-label-2)",
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                  color: "var(--b-text-secondary)",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  transition: "color 0.15s",
                }}
              >
                {copied ? (
                  <IconCheck size={13} stroke={2} />
                ) : (
                  <IconCopy size={13} stroke={2} />
                )}
                {copied ? "Copied" : "Copy settings JSON"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
