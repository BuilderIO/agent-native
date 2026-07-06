import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Switch } from "@agent-native/toolkit/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  Dithering,
  GodRays,
  GrainGradient,
  MeshGradient,
  Metaballs,
  PaperTexture,
  Voronoi,
  Warp,
} from "@paper-design/shaders-react";
import {
  SHADER_PRESET_MAP,
  SHADER_PRESETS,
  type ParamDef,
  type ShaderDescriptor,
  type ShaderPresetDef,
  type ShaderPresetName,
} from "@shared/shader-presets";
import {
  buildFallbackGradient,
  isWebGLAvailable,
  prefersReducedMotion,
} from "@shared/shader-safety";
import { IconArrowLeft, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { type ScrubInputChangeMeta, ScrubInput } from "./ScrubInput";

// ---------------------------------------------------------------------------
// Dynamic shader component map
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyShaderComponent = React.ComponentType<Record<string, any>>;

const SHADER_COMPONENTS: Record<ShaderPresetName, AnyShaderComponent> = {
  MeshGradient: MeshGradient as AnyShaderComponent,
  GrainGradient: GrainGradient as AnyShaderComponent,
  Voronoi: Voronoi as AnyShaderComponent,
  Metaballs: Metaballs as AnyShaderComponent,
  Warp: Warp as AnyShaderComponent,
  GodRays: GodRays as AnyShaderComponent,
  Dithering: Dithering as AnyShaderComponent,
  PaperTexture: PaperTexture as AnyShaderComponent,
};

// ---------------------------------------------------------------------------
// ShaderPreview sub-component
// ---------------------------------------------------------------------------

interface ShaderPreviewProps {
  descriptor: ShaderDescriptor;
  animated: boolean;
}

function ShaderPreview({ descriptor, animated }: ShaderPreviewProps) {
  const preset = SHADER_PRESET_MAP[descriptor.preset];
  const ShaderComponent = SHADER_COMPONENTS[descriptor.preset];
  const webglOk = isWebGLAvailable();

  // Build props — memoized to avoid identity churn on the WebGL layer
  const shaderProps = useMemo(() => {
    const p: Record<string, unknown> = { ...descriptor.params };
    if (descriptor.colors !== undefined) p.colors = descriptor.colors;
    if (descriptor.fit !== undefined) p.fit = descriptor.fit;
    if (descriptor.scale !== undefined) p.scale = descriptor.scale;
    if (descriptor.rotation !== undefined) p.rotation = descriptor.rotation;
    if (descriptor.offsetX !== undefined) p.offsetX = descriptor.offsetX;
    if (descriptor.offsetY !== undefined) p.offsetY = descriptor.offsetY;
    p.speed = animated ? (descriptor.speed ?? 1) : 0;
    if (!animated) p.frame = descriptor.frame ?? 0;
    return p;
  }, [descriptor, animated]);

  // Fallback gradient from the preset's default colors
  const fallbackStyle = {
    background: buildFallbackGradient(
      preset?.defaultColors ?? [],
      preset?.defaultColorBack,
    ),
  };

  const fallbackEl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="w-full rounded-lg"
          style={{ aspectRatio: "16 / 9", ...fallbackStyle }}
        />
      </TooltipTrigger>
      <TooltipContent>
        {
          "WebGL unavailable – showing fallback" /* i18n-ignore shader tooltip */
        }
      </TooltipContent>
    </Tooltip>
  );

  if (!webglOk) {
    return fallbackEl;
  }

  try {
    return (
      <div
        className="relative w-full overflow-hidden rounded-lg"
        style={{ aspectRatio: "16 / 9" }}
      >
        <ShaderComponent
          {...shaderProps}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />
      </div>
    );
  } catch {
    return fallbackEl;
  }
}

// ---------------------------------------------------------------------------
// Shared row wrapper: label-left, control-right, h-6 density
// ---------------------------------------------------------------------------

function ParamLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-[5.5rem] shrink-0 truncate !text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Color swatch button — design-editor style: rounded rect swatch + hex label inline
// ---------------------------------------------------------------------------

interface ColorSwatchProps {
  color: string;
  label: string;
  onChange: (value: string) => void;
}

function ColorSwatch({ color, label, onChange }: ColorSwatchProps) {
  // <input type="color"> only accepts 6-digit hex; strip any alpha suffix before
  // passing as value, then reattach it when the user picks a new color so alpha
  // is preserved rather than silently dropped.
  const sixDigit =
    color.length === 9 && color.startsWith("#") ? color.slice(0, 7) : color;
  const alphaSuffix =
    color.length === 9 && color.startsWith("#") ? color.slice(7) : "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The label wraps the native color input so clicking the swatch opens the picker */}
        <label
          className="flex h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded px-1 !text-[11px] text-muted-foreground transition-colors hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-within:bg-[var(--design-editor-control-bg)]"
          title={label}
        >
          <span
            className="inline-block size-4 shrink-0 rounded-[3px] border border-black/20 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]"
            style={{ background: color }}
          />
          <span className="min-w-0 truncate font-mono uppercase">
            {color.startsWith("#") ? color.slice(1).toUpperCase() : color}
          </span>
          <input
            type="color"
            value={sixDigit}
            onChange={(e) => onChange(e.target.value + alphaSuffix)}
            className="sr-only"
            aria-label={label}
          />
        </label>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Param row renderers
// ---------------------------------------------------------------------------

interface ParamRowProps {
  paramDef: ParamDef;
  value: number | boolean | string | string[];
  onChange: (key: string, value: number | boolean | string | string[]) => void;
}

function ParamRow({ paramDef, value, onChange }: ParamRowProps) {
  const { key, kind, label, min, max, step, options, maxCount } = paramDef;

  if (kind === "number") {
    const numVal = typeof value === "number" ? value : Number(paramDef.default);
    return (
      <ScrubInput
        label={label}
        value={numVal}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(v: number, _meta: ScrubInputChangeMeta) => onChange(key, v)}
        className="w-full"
      />
    );
  }

  if (kind === "enum") {
    const strVal = typeof value === "string" ? value : String(paramDef.default);
    return (
      <div className="flex h-6 items-center gap-1.5">
        <ParamLabel>{label}</ParamLabel>
        <Select value={strVal} onValueChange={(v) => onChange(key, v)}>
          <SelectTrigger className="h-6 flex-1 !text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((opt: string) => (
              <SelectItem key={opt} value={opt} className="!text-[11px]">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (kind === "bool") {
    const boolVal =
      typeof value === "boolean" ? value : Boolean(paramDef.default);
    const switchId = `shader-param-${key}`;
    return (
      <div className="flex h-6 items-center justify-between gap-1.5">
        <Label
          htmlFor={switchId}
          className="!text-[11px] text-muted-foreground"
        >
          {label}
        </Label>
        <Switch
          id={switchId}
          checked={boolVal}
          onCheckedChange={(checked) => onChange(key, checked)}
          className="origin-right scale-[0.8]"
        />
      </div>
    );
  }

  if (kind === "color") {
    const strVal = typeof value === "string" ? value : String(paramDef.default);
    return (
      <div className="flex h-6 items-center gap-1.5">
        <ParamLabel>{label}</ParamLabel>
        <ColorSwatch
          color={strVal}
          label={label}
          onChange={(v) => onChange(key, v)}
        />
      </div>
    );
  }

  if (kind === "colors") {
    const arrVal = Array.isArray(value)
      ? value
      : (paramDef.default as string[]);
    const limit = maxCount ?? 10;
    return (
      <div className="flex flex-col gap-1">
        {/* Section label sits at the top of the stop list */}
        <span className="!text-[11px] text-muted-foreground">{label}</span>
        {/* Color stop rows — each a swatch + hex + remove button */}
        <div className="flex flex-col gap-0.5">
          {arrVal.map((color, i) => {
            const colorLabel = `Color ${i + 1}`;
            return (
              <div key={i} className="flex h-6 items-center gap-1">
                <ColorSwatch
                  color={color}
                  label={colorLabel}
                  onChange={(v) => {
                    const next = [...arrVal];
                    next[i] = v;
                    onChange(key, next);
                  }}
                />
                <span className="flex-1" />
                {arrVal.length > 1 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          const next = arrVal.filter((_, idx) => idx !== i);
                          onChange(key, next);
                        }}
                        className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        aria-label={
                          "Remove color" /* i18n-ignore shader tooltip */
                        }
                      >
                        <IconX className="size-2.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {"Remove color" /* i18n-ignore shader tooltip */}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
          {arrVal.length < limit && (
            <button
              type="button"
              className="flex h-6 items-center gap-1.5 rounded px-1 !text-[11px] text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => onChange(key, [...arrVal, "#ffffff"])}
            >
              <span className="flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-dashed border-muted-foreground/50 text-[10px]">
                +
              </span>
              <span>
                {"Add color" /* i18n-ignore shader compact add button */}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main ShaderControls component
// ---------------------------------------------------------------------------

export interface ShaderControlsProps {
  descriptor: ShaderDescriptor;
  onChange: (descriptor: ShaderDescriptor) => void;
  /** Optional callback to navigate back to the preset browser. */
  onBack?: () => void;
  className?: string;
}

export function ShaderControls({
  descriptor,
  onChange,
  onBack,
  className,
}: ShaderControlsProps) {
  const reducedMotion = prefersReducedMotion();

  const [animated, setAnimated] = useState(
    () => (descriptor.speed ?? 0) !== 0 && !reducedMotion,
  );

  const preset = SHADER_PRESET_MAP[descriptor.preset];

  // Check if any expensive param is non-zero
  const hasExpensiveParam = preset?.params.some(
    (p: ParamDef) =>
      p.isExpensive && Number(descriptor.params[p.key] ?? p.default) > 0,
  );

  function handlePresetChange(name: string) {
    const newPreset = SHADER_PRESET_MAP[name as ShaderPresetName];
    if (!newPreset) return;

    const defaults: Record<string, number | boolean | string> = {};
    for (const p of newPreset.params) {
      if (p.kind !== "colors" && !Array.isArray(p.default)) {
        defaults[p.key] = p.default as number | boolean | string;
      }
    }

    setAnimated(false);
    onChange({
      preset: newPreset.name,
      params: defaults,
      colors: newPreset.defaultColors ?? undefined,
      speed: 0,
      frame: descriptor.frame,
    });
  }

  function handleParamChange(
    key: string,
    value: number | boolean | string | string[],
  ) {
    if (Array.isArray(value)) {
      // colors-kind param
      onChange({
        ...descriptor,
        params: { ...descriptor.params, [key]: value as unknown as string },
      });
    } else {
      onChange({
        ...descriptor,
        params: { ...descriptor.params, [key]: value },
      });
    }
  }

  function handleColorsParamChange(key: string, value: string[]) {
    // The shader-specific colors[] key may differ from the universal one;
    // for now store on descriptor.colors when the param key matches "colors".
    if (key === "colors") {
      onChange({ ...descriptor, colors: value });
    } else {
      // Store as JSON string in params for non-standard color arrays
      onChange({
        ...descriptor,
        params: { ...descriptor.params, [key]: JSON.stringify(value) },
      });
    }
  }

  function handleAnimatedChange(on: boolean) {
    setAnimated(on);
    if (!on) {
      onChange({ ...descriptor, speed: 0 });
    } else {
      onChange({
        ...descriptor,
        speed:
          descriptor.speed && descriptor.speed !== 0 ? descriptor.speed : 1,
      });
    }
  }

  function handleSpeedChange(v: number, _meta: ScrubInputChangeMeta) {
    onChange({ ...descriptor, speed: v });
  }

  const animateSwitchId = "shader-animate";

  return (
    <div className={cn("flex flex-col gap-0", className)}>
      {/* ── Live preview ─ full-width, rounded, sits at top ─────────────── */}
      <div className="px-3 pb-2 pt-1">
        <ShaderPreview descriptor={descriptor} animated={animated} />
      </div>

      {/* ── "Back to presets" affordance ─────────────────────────────────── */}
      {onBack && (
        <div className="px-3 pb-1.5">
          <button
            type="button"
            onClick={onBack}
            className="flex h-6 items-center gap-1 rounded px-1 !text-[11px] text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <IconArrowLeft className="size-3" />
            <span>{"Back to presets" /* i18n-ignore shader nav */}</span>
          </button>
        </div>
      )}

      {/* ── Preset picker ────────────────────────────────────────────────── */}
      <div className="flex h-6 items-center gap-1.5 px-3">
        <ParamLabel>{"Preset" /* i18n-ignore */}</ParamLabel>
        <Select value={descriptor.preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="h-6 flex-1 !text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(SHADER_PRESETS as readonly ShaderPresetDef[]).map((p) => (
              <SelectItem key={p.name} value={p.name} className="!text-[11px]">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Animate toggle ───────────────────────────────────────────────── */}
      <div className="flex h-6 items-center justify-between gap-1.5 px-3 pt-1">
        <Label
          htmlFor={animateSwitchId}
          className={cn(
            "!text-[11px] text-muted-foreground",
            reducedMotion && "opacity-50",
          )}
        >
          {"Animate" /* i18n-ignore shader label */}
          {reducedMotion && (
            <span className="ml-1 text-[10px]">
              {"(reduced motion)" /* i18n-ignore */}
            </span>
          )}
        </Label>
        <Switch
          id={animateSwitchId}
          checked={animated}
          onCheckedChange={handleAnimatedChange}
          disabled={reducedMotion}
          className="origin-right scale-[0.8]"
        />
      </div>

      {/* ── Speed scrub — only when animating ───────────────────────────── */}
      {animated && (
        <div className="px-3 pt-1">
          <ScrubInput
            label="Speed"
            value={descriptor.speed ?? 1}
            min={-5}
            max={5}
            step={0.1}
            onChange={handleSpeedChange}
            className="w-full"
          />
        </div>
      )}

      {/* ── Shader-specific params ───────────────────────────────────────── */}
      {preset && preset.params.length > 0 && (
        <>
          <div className="mx-3 mb-1 mt-2 border-t border-border/40" />
          <div className="flex flex-col gap-1 px-3 pb-2">
            {preset.params.map((paramDef: ParamDef) => {
              if (paramDef.kind === "colors") {
                // Resolve the current color array
                const val: string[] =
                  descriptor.colors ?? preset.defaultColors ?? [];
                return (
                  <ParamRow
                    key={paramDef.key}
                    paramDef={paramDef}
                    value={val}
                    onChange={(k, v) =>
                      handleColorsParamChange(k, v as string[])
                    }
                  />
                );
              }

              const val = descriptor.params[paramDef.key] ?? paramDef.default;

              return (
                <ParamRow
                  key={paramDef.key}
                  paramDef={paramDef}
                  value={val as number | boolean | string}
                  onChange={handleParamChange}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── Expensive param performance warning ─────────────────────────── */}
      {hasExpensiveParam && (
        <p className="mx-3 mb-2 rounded bg-yellow-950/50 px-2 py-1 text-[10px] text-yellow-400">
          {
            "grainMixer / grainOverlay may impact performance on mobile" /* i18n-ignore shader performance warning */
          }
        </p>
      )}
    </div>
  );
}
