import { useT } from "@agent-native/core/client/i18n";
import type { EffectColor } from "@shared/native-effects";
import { IconColorPicker } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  ColorTrack,
  SaturationBrightnessField,
  beginEyedropperPick,
  hasEyeDropperSupport,
  hsvToNormalizedRgb,
  type HsvaColor,
} from "./DesignColorControls";
import type { ScrubInputChangeMeta } from "./ScrubInput";

export function nativeColorToHsv(color: EffectColor): HsvaColor {
  const [r, g, b] = color.components;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return {
    h,
    s: max === 0 ? 0 : (delta / max) * 100,
    v: max * 100,
    a: color.alpha,
  };
}

export function nativeColorFromHsv(
  source: EffectColor,
  hsv: HsvaColor,
): EffectColor {
  return {
    ...source,
    components: hsvToNormalizedRgb(hsv),
  };
}

export function PrecisionColorChannel({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setDraft(String(value));
  }, [value]);
  const commit = () => {
    if (dirty.current) {
      const parsed = Number(draft);
      if (
        draft.trim() &&
        Number.isFinite(parsed) &&
        parsed >= 0 &&
        parsed <= 1 &&
        parsed !== value
      )
        onCommit(parsed);
    }
    dirty.current = false;
    setDraft(String(value));
  };
  return (
    <label className="flex h-6 items-center gap-2 text-xs">
      <span className="w-10 shrink-0">{label}</span>
      <Input
        aria-label={label}
        value={draft}
        disabled={disabled}
        className="h-6 min-w-0 flex-1 font-mono text-xs"
        onChange={(event) => {
          setDraft(event.target.value);
          dirty.current = true;
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            dirty.current = false;
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function sameNativeColor(a: EffectColor, b: EffectColor): boolean {
  return (
    a.space === b.space &&
    a.alpha === b.alpha &&
    a.components.every((value, index) => value === b.components[index])
  );
}

function colorHex(color: EffectColor): string {
  return `#${color.components
    .map((component) =>
      Math.round(component * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function colorFromHex(color: EffectColor, hex: string): EffectColor | null {
  if (!/^#[a-f0-9]{6}$/i.test(hex)) return null;
  return {
    ...color,
    components: [
      Number.parseInt(hex.slice(1, 3), 16) / 255,
      Number.parseInt(hex.slice(3, 5), 16) / 255,
      Number.parseInt(hex.slice(5, 7), 16) / 255,
    ],
  };
}

export function nativeEffectColorCss(color: EffectColor): string {
  const [r, g, b] = color.components;
  return color.space === "display-p3"
    ? `color(display-p3 ${r} ${g} ${b} / ${color.alpha})`
    : // guard:allow-raw-color — this CSS renders the authored effect color, not app chrome.
      `rgb(${r * 100}% ${g * 100}% ${b * 100}% / ${color.alpha})`;
}

export function nativeEffectColorChannel(
  color: EffectColor,
  channel: 0 | 1 | 2 | 3,
  value: number,
): EffectColor {
  if (channel === 3) return { ...color, alpha: value };
  const components: [number, number, number] = [...color.components];
  components[channel] = value;
  return { ...color, components };
}

export function NativeEffectColorControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: EffectColor;
  disabled: boolean;
  onChange: (next: EffectColor, phase: ScrubInputChangeMeta["phase"]) => void;
}) {
  const t = useT();
  const hsv = nativeColorToHsv(value);
  const pendingColor = useRef(value);
  pendingColor.current = value;
  const mounted = useRef(true);
  const pickerRevision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pickerRevision.current += 1;
    };
  }, []);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const preview = (next: EffectColor) => {
    pendingColor.current = next;
    onChange(next, "preview");
  };
  const commit = () => onChange(pendingColor.current, "commit");
  const channels = [
    t("editPanel.shaders.nativeColorRed"),
    t("editPanel.shaders.nativeColorGreen"),
    t("editPanel.shaders.nativeColorBlue"),
    t("editPanel.shaders.nativeColorAlpha"),
  ];
  return (
    <Popover>
      <div className="flex h-7 min-w-0 items-center justify-between gap-2 text-xs">
        <span className="truncate">{label}</span>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            className="size-6 shrink-0 rounded border border-border shadow-sm disabled:opacity-40"
            style={{ backgroundColor: nativeEffectColorCss(value) }}
          />
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-56 space-y-2 p-3" align="end">
        <p className="text-xs text-muted-foreground">
          {value.space === "display-p3" ? "Display P3" : "sRGB"}
        </p>
        <SaturationBrightnessField
          hsv={hsv}
          label={t("editPanel.shaders.nativeColorSaturationBrightness")}
          disabled={disabled}
          onChange={(next) => preview(nativeColorFromHsv(value, next))}
          onCommit={commit}
        />
        <div className="grid grid-cols-[1.5rem_1fr] items-center gap-2">
          <button
            type="button"
            aria-label={t("editPanel.shaders.nativeColorEyedropper")}
            disabled={
              disabled || value.space !== "srgb" || !hasEyeDropperSupport()
            }
            className="flex size-6 items-center justify-center rounded text-muted-foreground disabled:opacity-40"
            onClick={() => {
              const revision = ++pickerRevision.current;
              const source = pendingColor.current;
              const current = () =>
                mounted.current &&
                pickerRevision.current === revision &&
                sameNativeColor(source, pendingColor.current);
              void beginEyedropperPick()
                .then((hex) => {
                  if (!hex || !current()) return;
                  const next = colorFromHex(source, hex);
                  if (next) onChange(next, "commit");
                })
                .catch(() => {
                  if (current())
                    toast.error(t("editPanel.shaders.nativeColorPickFailed"));
                });
            }}
          >
            <IconColorPicker className="size-4" />
          </button>
          <ColorTrack
            label={t("editPanel.shaders.nativeColorHue")}
            value={hsv.h}
            min={0}
            max={360}
            disabled={disabled}
            // guard:allow-raw-color — this track must display the hue spectrum's fixed primary stops.
            backgroundImage="linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)"
            onChange={(h) => preview(nativeColorFromHsv(value, { ...hsv, h }))}
            onCommit={commit}
          />
        </div>
        <ColorTrack
          label={t("editPanel.shaders.nativeColorAlpha")}
          value={value.alpha * 100}
          min={0}
          max={100}
          disabled={disabled}
          backgroundImage={`linear-gradient(90deg, ${nativeEffectColorCss({ ...value, alpha: 0 })}, ${nativeEffectColorCss({ ...value, alpha: 1 })})`}
          onChange={(alpha) => preview({ ...value, alpha: alpha / 100 })}
          onCommit={commit}
        />
        <Input
          aria-label={t("editPanel.shaders.nativeColorHex")}
          value={hexDraft ?? colorHex(value)}
          disabled={disabled || value.space !== "srgb"}
          className="h-6 font-mono text-xs"
          onChange={(event) => setHexDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={() => {
            if (hexDraft !== null) {
              const next = colorFromHex(value, hexDraft);
              if (next && hexDraft.toLowerCase() !== colorHex(value))
                onChange(next, "commit");
            }
            setHexDraft(null);
          }}
        />
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {t("editPanel.shaders.nativeColorPrecision")}
          </summary>
          {([0, 1, 2, 3] as const).map((channel) => (
            <PrecisionColorChannel
              key={channel}
              label={channels[channel]}
              value={channel === 3 ? value.alpha : value.components[channel]}
              disabled={disabled}
              onCommit={(next) =>
                onChange(
                  nativeEffectColorChannel(value, channel, next),
                  "commit",
                )
              }
            />
          ))}
        </details>
      </PopoverContent>
    </Popover>
  );
}
