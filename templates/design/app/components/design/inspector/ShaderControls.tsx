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
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ScrubInput } from "./ScrubInput";

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
// Reduced-motion helper (inline, SSR-safe)
// ---------------------------------------------------------------------------

function getPreferreducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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
  const fallbackColors =
    (preset?.defaultColors ?? preset?.defaultColorBack)
      ? [preset.defaultColorBack ?? "#555", preset.defaultColors?.[0] ?? "#888"]
      : ["#555555", "#888888"];

  const fallbackStyle = {
    background: `linear-gradient(135deg, ${fallbackColors.join(", ")})`,
  };

  try {
    return (
      <div
        className="relative overflow-hidden rounded"
        style={{ width: 120, height: 80 }}
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
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="rounded"
            style={{ width: 120, height: 80, ...fallbackStyle }}
          />
        </TooltipTrigger>
        <TooltipContent>
          {
            "WebGL unavailable - showing fallback" /* i18n-ignore shader tooltip */
          }
        </TooltipContent>
      </Tooltip>
    );
  }
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
        onChange={(v) => onChange(key, v)}
        className="w-full"
      />
    );
  }

  if (kind === "enum") {
    const strVal = typeof value === "string" ? value : String(paramDef.default);
    return (
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">
          {label}
        </span>
        <Select value={strVal} onValueChange={(v) => onChange(key, v)}>
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((opt: string) => (
              <SelectItem key={opt} value={opt} className="text-xs">
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
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={switchId} className="text-xs text-muted-foreground">
          {label}
        </Label>
        <Switch
          id={switchId}
          checked={boolVal}
          onCheckedChange={(checked) => onChange(key, checked)}
          className="scale-90"
        />
      </div>
    );
  }

  if (kind === "color") {
    const strVal = typeof value === "string" ? value : String(paramDef.default);
    return (
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">
          {label}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <input
              type="color"
              value={strVal}
              onChange={(e) => onChange(key, e.target.value)}
              className="h-7 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
              aria-label={label}
            />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <span className="text-[10px] text-muted-foreground">{strVal}</span>
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
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex flex-wrap gap-1">
          {arrVal.map((color, i) => {
            const colorLabel = `Color ${i + 1}`;
            return (
              <div key={i} className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => {
                        const next = [...arrVal];
                        next[i] = e.target.value;
                        onChange(key, next);
                      }}
                      className="h-6 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
                      aria-label={colorLabel}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{colorLabel}</TooltipContent>
                </Tooltip>
                {arrVal.length > 1 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          const next = arrVal.filter((_, idx) => idx !== i);
                          onChange(key, next);
                        }}
                        className="text-[10px] leading-none text-muted-foreground hover:text-destructive"
                        aria-label={
                          "Remove color" /* i18n-ignore shader tooltip */
                        }
                      >
                        x
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
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => onChange(key, [...arrVal, "#ffffff"])}
            >
              {"+ Add" /* i18n-ignore shader compact add button */}
            </Button>
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
  className?: string;
}

export function ShaderControls({
  descriptor,
  onChange,
  className,
}: ShaderControlsProps) {
  const prefersReducedMotion = getPreferreducedMotion();

  const [animated, setAnimated] = useState(
    () => (descriptor.speed ?? 0) !== 0 && !prefersReducedMotion,
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

    onChange({
      preset: newPreset.name,
      params: defaults,
      colors: newPreset.defaultColors ?? undefined,
      speed: descriptor.speed,
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

  function handleSpeedChange(v: number) {
    onChange({ ...descriptor, speed: v });
  }

  const animateSwitchId = "shader-animate";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md bg-[#1a1a1a] p-3 text-xs",
        className,
      )}
    >
      {/* Preset picker */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Preset
        </span>
        <Select value={descriptor.preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(SHADER_PRESETS as readonly ShaderPresetDef[]).map((p) => (
              <SelectItem key={p.name} value={p.name} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Live preview */}
      <div className="flex justify-center">
        <ShaderPreview descriptor={descriptor} animated={animated} />
      </div>

      {/* Animate toggle */}
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={animateSwitchId}
          className={cn(
            "text-xs text-muted-foreground",
            prefersReducedMotion && "opacity-50",
          )}
        >
          Animate
          {prefersReducedMotion && (
            <span className="ml-1 text-[10px]">(reduced motion)</span>
          )}
        </Label>
        <Switch
          id={animateSwitchId}
          checked={animated}
          onCheckedChange={handleAnimatedChange}
          disabled={prefersReducedMotion}
          className="scale-90"
        />
      </div>

      {/* Speed scrub — only when animating */}
      {animated && (
        <ScrubInput
          label="Speed"
          value={descriptor.speed ?? 1}
          min={-5}
          max={5}
          step={0.1}
          onChange={handleSpeedChange}
          className="w-full"
        />
      )}

      {/* Shader-specific params */}
      {preset && preset.params.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Parameters
          </span>
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
                  onChange={(k, v) => handleColorsParamChange(k, v as string[])}
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
      )}

      {/* Expensive param performance warning */}
      {hasExpensiveParam && (
        <p className="rounded bg-yellow-950/50 px-2 py-1 text-[10px] text-yellow-400">
          {
            "grainMixer / grainOverlay may impact performance on mobile" /* i18n-ignore shader performance warning */
          }
        </p>
      )}
    </div>
  );
}
