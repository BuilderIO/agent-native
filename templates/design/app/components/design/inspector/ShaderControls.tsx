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
  prefersReducedMotion,
} from "@shared/shader-safety";
import { IconX } from "@tabler/icons-react";
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

  try {
    return (
      <div
        className="relative w-full overflow-hidden rounded-md"
        style={{ aspectRatio: "16 / 7" }}
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
            className="w-full rounded-md"
            style={{ aspectRatio: "16 / 7", ...fallbackStyle }}
          />
        </TooltipTrigger>
        <TooltipContent>
          {
            "WebGL unavailable – showing fallback" /* i18n-ignore shader tooltip */
          }
        </TooltipContent>
      </Tooltip>
    );
  }
}

// ---------------------------------------------------------------------------
// Shared row wrapper: label-left, control-right, h-6 density
// ---------------------------------------------------------------------------

function ParamLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-[5.5rem] shrink-0 truncate text-[11px] text-muted-foreground">
      {children}
    </span>
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
          <SelectTrigger className="h-6 flex-1 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((opt: string) => (
              <SelectItem key={opt} value={opt} className="text-[11px]">
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
        <Label htmlFor={switchId} className="text-[11px] text-muted-foreground">
          {label}
        </Label>
        <Switch
          id={switchId}
          checked={boolVal}
          onCheckedChange={(checked) => onChange(key, checked)}
          className="scale-[0.8] origin-right"
        />
      </div>
    );
  }

  if (kind === "color") {
    const strVal = typeof value === "string" ? value : String(paramDef.default);
    return (
      <div className="flex h-6 items-center gap-1.5">
        <ParamLabel>{label}</ParamLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <input
              type="color"
              value={strVal}
              onChange={(e) => onChange(key, e.target.value)}
              className="h-6 w-6 shrink-0 cursor-pointer rounded border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-0.5"
              aria-label={label}
            />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {strVal}
        </span>
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
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <div className="flex flex-wrap items-center gap-1">
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
                      className="h-6 w-6 cursor-pointer rounded border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-0"
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
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
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

  function handleSpeedChange(v: number, _meta: ScrubInputChangeMeta) {
    onChange({ ...descriptor, speed: v });
  }

  const animateSwitchId = "shader-animate";

  return (
    <div className={cn("flex flex-col gap-0", className)}>
      {/* Live preview — full width, sits at top */}
      <div className="px-3 pb-2 pt-1">
        <ShaderPreview descriptor={descriptor} animated={animated} />
      </div>

      {/* Preset picker */}
      <div className="flex h-6 items-center gap-1.5 px-3">
        <span className="w-[5.5rem] shrink-0 text-[11px] text-muted-foreground">
          Preset
        </span>
        <Select value={descriptor.preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="h-6 flex-1 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(SHADER_PRESETS as readonly ShaderPresetDef[]).map((p) => (
              <SelectItem key={p.name} value={p.name} className="text-[11px]">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Animate toggle */}
      <div className="flex h-6 items-center justify-between gap-1.5 px-3 pt-1">
        <Label
          htmlFor={animateSwitchId}
          className={cn(
            "text-[11px] text-muted-foreground",
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
          className="scale-[0.8] origin-right"
        />
      </div>

      {/* Speed scrub — only when animating */}
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

      {/* Shader-specific params */}
      {preset && preset.params.length > 0 && (
        <>
          <div className="mx-3 mt-2 mb-1 border-t border-border/40" />
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

      {/* Expensive param performance warning */}
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
