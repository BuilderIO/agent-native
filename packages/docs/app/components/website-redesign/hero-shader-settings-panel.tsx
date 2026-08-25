import { IconSettings } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  HERO_SHADER_SETTINGS_RANGES,
  type HeroShaderSettings,
} from "./hero-shader-settings";

const FIELD_LABELS: Record<keyof HeroShaderSettings, string> = {
  particleCount: "Particle count",
  color: "Color",
  blinkRate: "Blink rate",
  spin: "Spin",
  turbulence: "Turbulence",
  intensity: "Intensity",
};

const FIELD_ORDER: Array<keyof HeroShaderSettings> = [
  "particleCount",
  "color",
  "blinkRate",
  "spin",
  "turbulence",
  "intensity",
];

interface HeroShaderSettingsPanelProps {
  settings: HeroShaderSettings;
  onChange: <K extends keyof HeroShaderSettings>(
    key: K,
    value: HeroShaderSettings[K],
  ) => void;
  onReset: () => void;
}

export function HeroShaderSettingsPanel({
  settings,
  onChange,
  onReset,
}: HeroShaderSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

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

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Shader tweak settings"
          style={{
            position: "absolute",
            left: 0,
            bottom: "calc(100% + 8px)",
            width: 260,
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-4)",
            padding: "var(--spacing-4)",
            background: "var(--b-bg-prominent)",
            border: "1px solid var(--b-border-default)",
            borderRadius: "var(--b-radius)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
          }}
        >
          {FIELD_ORDER.map((key) => {
            const range = HERO_SHADER_SETTINGS_RANGES[key];
            const label = FIELD_LABELS[key];
            return (
              <div
                key={key}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--spacing-1)",
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
                  <label htmlFor={`${panelId}-${key}`}>{label}</label>
                  {range && (
                    <span
                      style={{
                        fontFamily: "var(--b-font-mono)",
                        color: "var(--b-text-primary)",
                      }}
                    >
                      {settings[key]}
                    </span>
                  )}
                </div>
                {range ? (
                  <input
                    id={`${panelId}-${key}`}
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    value={settings[key] as number}
                    onChange={(e) =>
                      onChange(
                        key,
                        Number(
                          e.target.value,
                        ) as HeroShaderSettings[typeof key],
                      )
                    }
                    style={{
                      width: "100%",
                      accentColor: "var(--b-action-primary-bg)",
                    }}
                  />
                ) : (
                  <input
                    id={`${panelId}-${key}`}
                    type="color"
                    value={settings[key] as string}
                    onChange={(e) =>
                      onChange(
                        key,
                        e.target.value as HeroShaderSettings[typeof key],
                      )
                    }
                    style={{
                      width: "100%",
                      height: 28,
                      padding: 0,
                      border: "1px solid var(--b-border-default)",
                      borderRadius: "var(--b-radius-sm)",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  />
                )}
              </div>
            );
          })}

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
              alignSelf: "flex-start",
              transition: "color 0.15s",
            }}
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
