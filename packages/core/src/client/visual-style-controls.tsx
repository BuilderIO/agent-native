import { IconColorPicker } from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover.js";
import { cn } from "./utils.js";

export type VisualControlValue = string | number | boolean;

export interface VisualControlOption {
  label: string;
  value: string;
  color?: string;
}

export interface VisualTweakDefinition {
  id: string;
  label: string;
  type: "color-swatch" | "color-swatches" | "segment" | "slider" | "toggle";
  options?: VisualControlOption[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue: VisualControlValue;
  cssVar?: string;
  unit?: string;
}

function clampNumber(value: number, min?: number, max?: number) {
  let next = value;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
}

function formatNumber(value: number, unit?: string) {
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(2));
  return unit ? `${rounded}${unit}` : String(rounded);
}

function parseDraftNumber(value: string, fallback: number) {
  const match = value.trim().match(/-?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const next = Number(match[0]);
  return Number.isFinite(next) ? next : fallback;
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface HsvaColor {
  h: number;
  s: number;
  v: number;
  a: number;
}

const CHECKERBOARD_IMAGE =
  "linear-gradient(45deg, #d4d4d4 25%, transparent 25%), linear-gradient(-45deg, #d4d4d4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d4 75%), linear-gradient(-45deg, transparent 75%, #d4d4d4 75%)";
const FALLBACK_RGBA: RgbaColor = { r: 0, g: 0, b: 0, a: 1 };

function normalizeRgba(color: RgbaColor): RgbaColor {
  return {
    r: clamp(color.r, 0, 255),
    g: clamp(color.g, 0, 255),
    b: clamp(color.b, 0, 255),
    a: clampFloat(color.a, 0, 1),
  };
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed}`.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((char) => char + char)
      .join("")}`.toUpperCase();
  }
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .split("")
      .map((char) => char + char)
      .join("")}`.toUpperCase();
  }
  return null;
}

function parseCssColor(value: string): RgbaColor | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalizedHex = normalizeHexColor(trimmed);
  if (normalizedHex) {
    return normalizeRgba({
      r: Number.parseInt(normalizedHex.slice(1, 3), 16),
      g: Number.parseInt(normalizedHex.slice(3, 5), 16),
      b: Number.parseInt(normalizedHex.slice(5, 7), 16),
      a: 1,
    });
  }
  const rgb = trimmed.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([0-9.]+%?))?/i,
  );
  if (rgb) {
    return normalizeRgba({
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: parseAlpha(rgb[4]),
    });
  }
  const lower = trimmed.toLowerCase();
  if (lower === "transparent" || lower === "rgba(0, 0, 0, 0)") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return null;
}

function channelToHex(value: number): string {
  return clamp(value, 0, 255).toString(16).padStart(2, "0");
}

function rgbaToHex(color: RgbaColor): string {
  const normalized = normalizeRgba(color);
  return `#${channelToHex(normalized.r)}${channelToHex(normalized.g)}${channelToHex(normalized.b)}`.toUpperCase();
}

function rgbaToCss(color: RgbaColor): string {
  const normalized = normalizeRgba(color);
  if (normalized.a >= 1) return rgbaToHex(normalized);
  return `rgba(${normalized.r}, ${normalized.g}, ${normalized.b}, ${trimNumber(normalized.a)})`;
}

function parseAlpha(value: string | undefined): number {
  if (!value) return 1;
  if (value.endsWith("%")) return Number(value.slice(0, -1)) / 100;
  return Number(value);
}

function trimNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

function rgbaToHsv(color: RgbaColor): HsvaColor {
  const normalized = normalizeRgba(color);
  const r = normalized.r / 255;
  const g = normalized.g / 255;
  const b = normalized.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h: Math.round(h),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
    a: normalized.a,
  };
}

function hsvToRgba(color: HsvaColor): RgbaColor {
  const h = ((color.h % 360) + 360) % 360;
  const s = clampFloat(color.s, 0, 100) / 100;
  const v = clampFloat(color.v, 0, 100) / 100;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [chroma, x, 0];
  else if (h < 120) [r, g, b] = [x, chroma, 0];
  else if (h < 180) [r, g, b] = [0, chroma, x];
  else if (h < 240) [r, g, b] = [0, x, chroma];
  else if (h < 300) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return normalizeRgba({
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: clampFloat(color.a, 0, 1),
  });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function swatchBackground(value: string) {
  if (value === "transparent" || value === "rgba(0, 0, 0, 0)") {
    return {
      background: CHECKERBOARD_IMAGE,
      backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
      backgroundSize: "8px 8px",
    };
  }
  return { background: value };
}

export function VisualInspectorPanel({
  title,
  subtitle,
  children,
  className,
  headerAction,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
}) {
  return (
    <aside
      className={cn(
        "w-64 overflow-hidden rounded-xl border border-border bg-card/95 text-card-foreground shadow-2xl shadow-black/35 backdrop-blur",
        className,
      )}
    >
      <div className="flex min-h-10 items-start justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 truncate text-[12px] text-foreground">
              {subtitle}
            </div>
          )}
        </div>
        {headerAction}
      </div>
      <div className="max-h-[min(680px,calc(100vh-7rem))] overflow-y-auto p-2">
        {children}
      </div>
    </aside>
  );
}

export function VisualInspectorSection({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg px-1.5 py-2", className)}>
      <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/75">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function VisualControlRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1", className)}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function VisualSwatchControl({
  options,
  value,
  onChange,
  columns = 8,
  className,
}: {
  options: VisualControlOption[];
  value: string;
  onChange: (value: string) => void;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-1.5", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const swatch = option.color ?? option.value;
        const isTransparent = swatch === "transparent";
        return (
          <button
            key={`${option.value}-${option.label}`}
            type="button"
            title={option.label}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "size-5 cursor-pointer rounded-md border border-border/70 transition-[transform,border-color] hover:scale-105 hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === option.value &&
                "border-foreground/70 ring-2 ring-foreground/40 ring-offset-1 ring-offset-card",
            )}
            style={{
              background: isTransparent
                ? "linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)"
                : swatch,
              backgroundPosition: isTransparent
                ? "0 0, 0 4px, 4px -4px, -4px 0"
                : undefined,
              backgroundSize: isTransparent ? "8px 8px" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

export function VisualColorPicker({
  label,
  value,
  onChange,
  documentColors = [],
  allowTransparent = false,
  hexLabel = "Hex",
  documentColorsLabel = "Document colors",
  transparentLabel = "Transparent",
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  documentColors?: string[];
  allowTransparent?: boolean;
  hexLabel?: string;
  documentColorsLabel?: string;
  transparentLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const color = parseCssColor(value) ?? FALLBACK_RGBA;
  const colorHex = rgbaToHex(color);
  const [draft, setDraft] = useState(colorHex.replace(/^#/, ""));
  const [picking, setPicking] = useState(false);
  const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

  useEffect(() => {
    if (!open) setDraft(colorHex.replace(/^#/, ""));
  }, [colorHex, open]);

  const commitDraft = (nextDraft = draft) => {
    const normalized = normalizeHexColor(nextDraft);
    if (!normalized) {
      setDraft(colorHex.replace(/^#/, ""));
      return;
    }
    setDraft(normalized.replace(/^#/, ""));
    onChange(normalized);
  };

  const emitHsv = (nextHsv: HsvaColor) => {
    const nextColor = hsvToRgba({ ...nextHsv, a: color.a });
    const nextValue = rgbaToCss(nextColor);
    setDraft(rgbaToHex(nextColor).replace(/^#/, ""));
    onChange(nextValue);
  };

  const pickScreenColor = async () => {
    if (!hasEyeDropper || picking) return;
    try {
      setPicking(true);
      const EyeDropperCtor = (
        window as unknown as {
          EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
        }
      ).EyeDropper;
      if (!EyeDropperCtor) return;
      const result = await new EyeDropperCtor().open();
      if (result?.sRGBHex) {
        const next = normalizeHexColor(result.sRGBHex);
        if (next) {
          setDraft(next.replace(/^#/, ""));
          onChange(next);
        }
      }
    } finally {
      setPicking(false);
    }
  };

  const uniqueDocumentColors = Array.from(
    new Set(
      documentColors
        .map((color) =>
          color === "transparent" ? color : normalizeHexColor(color),
        )
        .filter(Boolean) as string[],
    ),
  ).slice(0, 16);
  const displayValue =
    value === "transparent" || color.a === 0
      ? transparentLabel
      : colorHex.replace(/^#/, "");
  const hsv = rgbaToHsv(color);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 text-[11px] shadow-none transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <span
            className="size-4 shrink-0 rounded-[3px] border border-border/70"
            style={swatchBackground(value)}
          />
          <span className="min-w-0 flex-1 truncate text-left font-medium tabular-nums text-foreground">
            {displayValue}
          </span>
          <span
            aria-hidden="true"
            className="size-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-muted-foreground/70"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="z-[10000] w-[252px] p-0 text-[11px] shadow-xl"
        onFocusOutside={(event) => event.preventDefault()}
      >
        <div className="rounded-md bg-popover text-popover-foreground">
          <VisualSaturationBrightnessField
            hsv={hsv}
            label={label}
            onChange={emitHsv}
          />

          <div className="mt-2.5 px-3">
            <div className="grid grid-cols-[1.5rem_1fr] items-center gap-x-2">
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  aria-label={label}
                  disabled={!hasEyeDropper || picking}
                  onClick={() => void pickScreenColor()}
                  className={cn(
                    "flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    (!hasEyeDropper || picking) &&
                      "pointer-events-none opacity-40",
                    picking &&
                      "bg-primary/10 text-primary ring-1 ring-primary/50",
                  )}
                >
                  <IconColorPicker className="size-4" />
                </button>
              </div>
              <VisualColorTrack
                label={label}
                value={hsv.h}
                min={0}
                max={360}
                backgroundImage="linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)"
                onChange={(nextHue) =>
                  emitHsv({ ...hsv, h: nextHue === 360 ? 0 : nextHue })
                }
              />
              <span
                className="mt-2 size-[18px] shrink-0 rounded-[3px] border border-border/60"
                style={swatchBackground(rgbaToCss(color))}
              />
              <VisualColorTrack
                label={transparentLabel}
                value={Math.round(color.a * 100)}
                min={0}
                max={100}
                backgroundImage={`${CHECKERBOARD_IMAGE}, linear-gradient(90deg, rgba(${color.r}, ${color.g}, ${color.b}, 0), rgba(${color.r}, ${color.g}, ${color.b}, 1))`}
                backgroundSize="8px 8px, 8px 8px, 8px 8px, 8px 8px, 100% 100%"
                backgroundPosition="0 0, 0 4px, 4px -4px, -4px 0, 0 0"
                onChange={(nextOpacity) => {
                  const nextColor = normalizeRgba({
                    ...color,
                    a: nextOpacity / 100,
                  });
                  const nextValue = rgbaToCss(nextColor);
                  setDraft(rgbaToHex(nextColor).replace(/^#/, ""));
                  onChange(nextValue);
                }}
              />
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-[4.5rem_1fr] items-center gap-1 border-b border-border/70 px-3 pb-3">
            <span className="text-[11px] font-medium text-muted-foreground">
              {hexLabel}
            </span>
            <input
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={() => commitDraft()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraft();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(colorHex.replace(/^#/, ""));
                  event.currentTarget.blur();
                }
              }}
              className="h-6 min-w-0 rounded-md border border-input bg-background/70 px-2 text-right text-[11px] uppercase tabular-nums outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </div>
          {(allowTransparent || uniqueDocumentColors.length > 0) && (
            <div className="px-3 py-2.5">
              <div className="mb-2 flex h-5 items-center justify-between text-[11px] text-muted-foreground">
                <span>{documentColorsLabel}</span>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {allowTransparent && (
                  <button
                    type="button"
                    aria-label={transparentLabel}
                    aria-pressed={value === "transparent"}
                    className={cn(
                      "size-5 cursor-pointer rounded-sm border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      value === "transparent" || color.a === 0
                        ? "border-primary ring-1 ring-primary"
                        : "border-border/60",
                    )}
                    style={swatchBackground("transparent")}
                    onClick={() => {
                      setDraft(colorHex.replace(/^#/, ""));
                      onChange("transparent");
                    }}
                  />
                )}
                {uniqueDocumentColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={color}
                    aria-pressed={colorHex === color}
                    className={cn(
                      "size-5 cursor-pointer rounded-sm border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      colorHex === color
                        ? "border-primary ring-1 ring-primary"
                        : "border-border/60",
                    )}
                    style={swatchBackground(color)}
                    onClick={() => {
                      setDraft(color);
                      onChange(color);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function VisualSaturationBrightnessField({
  hsv,
  label,
  onChange,
}: {
  hsv: HsvaColor;
  label: string;
  onChange: (value: HsvaColor) => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const hueColor = rgbaToCss(hsvToRgba({ h: hsv.h, s: 100, v: 100, a: 1 }));

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    onChange({
      ...hsv,
      s: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      v: clamp(100 - ((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    });
  };

  const stepWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onChange({ ...hsv, s: clamp(hsv.s + step, 0, 100) });
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onChange({ ...hsv, s: clamp(hsv.s - step, 0, 100) });
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onChange({ ...hsv, v: clamp(hsv.v + step, 0, 100) });
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onChange({ ...hsv, v: clamp(hsv.v - step, 0, 100) });
    }
  };

  return (
    <div
      ref={fieldRef}
      tabIndex={0}
      aria-label={label}
      onPointerDown={(event) => {
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return;
        updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
      onKeyDown={stepWithKeyboard}
      className="relative h-40 w-full cursor-crosshair overflow-hidden rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing"
      style={{
        backgroundImage: `linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, ${hueColor} 100%)`,
      }}
    >
      <span
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_hsl(var(--foreground)/0.6)]"
        style={{
          left: `${hsv.s}%`,
          top: `${100 - hsv.v}%`,
        }}
      />
    </div>
  );
}

function VisualColorTrack({
  label,
  value,
  min,
  max,
  backgroundImage,
  backgroundSize,
  backgroundPosition,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  backgroundImage: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const percent = ((value - min) / (max - min)) * 100;

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = min + ((event.clientX - rect.left) / rect.width) * (max - min);
    onChange(clamp(next, min, max));
  };

  const stepWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(clamp(value + step, min, max));
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(clamp(value - step, min, max));
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(max);
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onKeyDown={stepWithKeyboard}
      onPointerDown={(event) => {
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return;
        updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
      className="relative h-3.5 cursor-pointer rounded-full border border-border/60 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:cursor-grabbing"
      style={{ backgroundImage, backgroundSize, backgroundPosition }}
    >
      <span
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_hsl(var(--foreground)/0.6)]"
        style={{ left: `${clamp(percent, 0, 100)}%` }}
      />
    </div>
  );
}

export function VisualSegmentedControl({
  options,
  value,
  onChange,
  className,
}: {
  options: VisualControlOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-7 overflow-hidden rounded-md border border-border bg-background/60",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "min-w-0 flex-1 cursor-pointer px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground",
            value === option.value && "bg-accent text-foreground",
          )}
        >
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function VisualToggleControl({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 cursor-pointer rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-primary/35" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-foreground shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

export function VisualSliderControl({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const safeValue = clampNumber(Number.isFinite(value) ? value : min, min, max);
  return (
    <div className="flex h-7 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="min-w-0 flex-1 cursor-pointer accent-foreground"
      />
      <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
        {formatNumber(safeValue, unit)}
      </span>
    </div>
  );
}

export function VisualScrubInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => formatNumber(value, unit));
  const [focused, setFocused] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    prevX: number;
    dragged: boolean;
  } | null>(null);

  useEffect(() => {
    if (!focused) setDraft(formatNumber(value, unit));
  }, [focused, unit, value]);

  const commit = (nextDraft = draft) => {
    const parsed = parseDraftNumber(nextDraft, value);
    const next = clampNumber(parsed, min, max);
    onChange(next);
    setDraft(formatNumber(next, unit));
  };

  const setNext = (next: number) => {
    const clamped = clampNumber(next, min, max);
    onChange(clamped);
    setDraft(formatNumber(clamped, unit));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(formatNumber(value, unit));
      event.currentTarget.blur();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const mult =
        event.shiftKey || event.metaKey ? 10 : event.altKey ? 0.1 : 1;
      const direction = event.key === "ArrowUp" ? 1 : -1;
      const base = parseDraftNumber(draft, value);
      setNext(base + direction * step * mult);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLLabelElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      prevX: event.clientX,
      dragged: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLLabelElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.prevX;
    if (delta === 0) return;
    drag.prevX = event.clientX;
    drag.dragged = true;
    const mult = event.shiftKey || event.metaKey ? 10 : event.altKey ? 0.1 : 1;
    setNext(value + delta * step * mult);
  };

  const onPointerUp = (event: PointerEvent<HTMLLabelElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (!drag.dragged) {
      document.getElementById(id)?.focus();
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <label
        htmlFor={id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "flex w-8 shrink-0 cursor-ew-resize select-none items-center justify-center rounded border border-transparent px-1 text-[10px] font-semibold text-muted-foreground hover:border-border hover:bg-accent/60",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {label}
      </label>
      <input
        id={id}
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background/70 px-2 text-right text-[11px] tabular-nums text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
    </div>
  );
}

export function VisualTweakControl({
  tweak,
  value,
  onChange,
  className,
}: {
  tweak: VisualTweakDefinition;
  value: VisualControlValue;
  onChange: (value: VisualControlValue) => void;
  className?: string;
}) {
  if (tweak.type === "toggle") {
    return (
      <div
        className={cn("flex h-7 items-center justify-between gap-2", className)}
      >
        <span className="truncate text-[11px] text-muted-foreground">
          {tweak.label}
        </span>
        <VisualToggleControl
          checked={Boolean(value)}
          onChange={onChange}
          label={tweak.label}
        />
      </div>
    );
  }

  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number(tweak.defaultValue);

  return (
    <VisualControlRow label={tweak.label} className={className}>
      {((tweak.type as string) === "color-swatch" ||
        (tweak.type as string) === "color-swatches") && (
        <VisualColorPicker
          label={tweak.label}
          value={String(value)}
          documentColors={(tweak.options ?? []).map(
            (option) => option.color ?? option.value,
          )}
          onChange={onChange}
        />
      )}
      {tweak.type === "segment" && (
        <VisualSegmentedControl
          options={tweak.options ?? []}
          value={String(value)}
          onChange={onChange}
        />
      )}
      {tweak.type === "slider" && (
        <VisualSliderControl
          min={tweak.min ?? 0}
          max={tweak.max ?? 100}
          step={tweak.step ?? 1}
          unit={
            tweak.unit ??
            (tweak.cssVar?.toLowerCase().includes("radius") ? "px" : undefined)
          }
          value={Number.isFinite(numericValue) ? numericValue : 0}
          onChange={onChange}
        />
      )}
    </VisualControlRow>
  );
}
