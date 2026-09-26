import { useActionMutation } from "@agent-native/core/client/hooks";
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
  type ShaderDescriptor,
  type ShaderPresetDef,
  type ShaderPresetName,
} from "@shared/shader-presets";
import { buildFallbackGradient, isWebGLAvailable } from "@shared/shader-safety";
import {
  IconArrowLeft,
  IconPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Component, useMemo, useRef, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ShaderControls } from "./ShaderControls";

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


export function descriptorFromPreset(
  preset: ShaderPresetDef,
): ShaderDescriptor {
  const params: Record<string, number | boolean | string> = {};
  for (const p of preset.params) {
    if (p.kind !== "colors" && !Array.isArray(p.default)) {
      params[p.key] = p.default as number | boolean | string;
    }
  }
  return {
    preset: preset.name,
    params,
    colors: preset.defaultColors ?? undefined,
    speed: 0,
    frame: 0,
  };
}

export function shaderDescriptorToCss(descriptor: ShaderDescriptor): string {
  const preset = SHADER_PRESET_MAP[descriptor.preset];
  const colors =
    descriptor.colors && descriptor.colors.length > 0
      ? descriptor.colors
      : (preset?.defaultColors ?? []);
  return buildFallbackGradient(colors, preset?.defaultColorBack);
}


class ShaderBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ShaderThumbnail({
  preset,
  selected,
}: {
  preset: ShaderPresetDef;
  selected: boolean;
}) {
  const ShaderComponent = SHADER_COMPONENTS[preset.name];
  const webglOk = isWebGLAvailable();

  const fallback = buildFallbackGradient(
    preset.defaultColors ?? [preset.defaultColorFront ?? "#888888"],
    preset.defaultColorBack,
  );

  const shaderProps = useMemo(() => {
    const p: Record<string, unknown> = {};
    for (const def of preset.params) {
      if (def.kind !== "colors" && !Array.isArray(def.default)) {
        p[def.key] = def.default;
      }
    }
    if (preset.defaultColors) p.colors = preset.defaultColors;
    if (preset.defaultColorBack) p.colorBack = preset.defaultColorBack;
    if (preset.defaultColorFront) p.colorFront = preset.defaultColorFront;
    p.speed = 0;
    p.frame = 0;
    return p;
  }, [preset]);

  const fallbackEl = (
    <div className="absolute inset-0" style={{ background: fallback }} />
  );

  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-md border transition-colors",
        selected
          ? "border-primary shadow-[0_0_0_1px_var(--primary)]"
          : "border-border/60 group-hover:border-foreground/40",
      )}
    >
      {webglOk ? (
        <ShaderBoundary fallback={fallbackEl}>
          <ShaderComponent
            {...shaderProps}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          />
        </ShaderBoundary>
      ) : (
        fallbackEl
      )}
    </div>
  );
}


export interface ShaderFillsPanelProps {
  descriptor?: ShaderDescriptor;
  onApply: (descriptor: ShaderDescriptor, css: string) => void;
  onCommit?: (descriptor: ShaderDescriptor, css: string) => void;
  onBack: () => void;
  applyContext?: {
    designId?: string;
    fileId?: string;
    nodeId?: string;
    selector?: string;
  };
  disabled?: boolean;
}

export function ShaderFillsPanel({
  descriptor,
  onApply,
  onCommit,
  onBack,
  applyContext,
  disabled = false,
}: ShaderFillsPanelProps) {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<ShaderDescriptor | null>(
    descriptor ?? null,
  );
  const applyShader = useActionMutation("apply-shader");
  const lastAppliedRef = useRef<ShaderDescriptor | null>(descriptor ?? null);
  const dirtyRef = useRef(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return SHADER_PRESETS;
    return SHADER_PRESETS.filter(
      (preset) =>
        preset.label.toLowerCase().includes(query) ||
        preset.description.toLowerCase().includes(query),
    );
  }, [search]);

  const preview = (next: ShaderDescriptor) => {
    setActive(next);
    lastAppliedRef.current = next;
    dirtyRef.current = true;
    onApply(next, shaderDescriptorToCss(next));
  };

  const commitNow = (next: ShaderDescriptor) => {
    dirtyRef.current = false;
    const css = shaderDescriptorToCss(next);
    onCommit?.(next, css);
    applyShader.mutate(
      {
        surface: SHADER_PRESET_MAP[next.preset]?.isEffect ? "effect" : "fill",
        descriptor: {
          preset: next.preset,
          params: next.params,
          colors: next.colors,
          speed: next.speed,
          frame: next.frame,
          fit: next.fit,
          scale: next.scale,
          rotation: next.rotation,
          offsetX: next.offsetX,
          offsetY: next.offsetY,
        },
        ...(applyContext?.designId || applyContext?.fileId
          ? {
              source: {
                kind: "design-file" as const,
                designId: applyContext.designId,
                fileId: applyContext.fileId,
              },
            }
          : {}),
        ...(applyContext?.nodeId || applyContext?.selector
          ? {
              target: {
                nodeId: applyContext.nodeId,
                selector: applyContext.selector,
              },
            }
          : {}),
      },
      { onError: () => undefined },
    );
  };

  const pick = (next: ShaderDescriptor) => {
    preview(next);
    commitNow(next);
  };

  const commitLastPreview = () => {
    if (dirtyRef.current && lastAppliedRef.current) {
      commitNow(lastAppliedRef.current);
    }
  };

  if (active) {
    const preset = SHADER_PRESET_MAP[active.preset];
    return (
      <div className="flex flex-col">
        {/* Detail header: ← preset-name × */}
        <div className="flex h-6 items-center gap-1.5 px-3">
          <button
            type="button"
            aria-label={"Back to shader fills" /* i18n-ignore */}
            onClick={() => setActive(null)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconArrowLeft className="size-3.5" />
          </button>
          <span className="design-sidebar-section-title flex-1 truncate text-foreground">
            {preset?.label ?? active.preset}
          </span>
          <button
            type="button"
            aria-label={"Close shader fills" /* i18n-ignore */}
            onClick={onBack}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconX className="size-3" />
          </button>
        </div>
        {/* onPointerUp/onBlur here catch the bubbled event that ends a
            ShaderControls drag/type gesture (pointer capture redirects the
            event's target but it still bubbles through this ancestor), so
            the expensive apply-shader mutation commits exactly once per
            gesture instead of once per preview tick. */}
        <div
          className="border-t border-border/70 p-2"
          onPointerUp={commitLastPreview}
          onPointerCancel={() => {
            dirtyRef.current = false;
          }}
          onBlur={commitLastPreview}
        >
          <ShaderControls
            descriptor={active}
            onChange={(next) => preview(next)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header: "Shader fills" title + + button + × button */}
      <div className="flex h-6 items-center gap-1 px-3">
        <span className="design-sidebar-section-title flex-1 truncate text-foreground">
          {"Shader fills" /* i18n-ignore design panel title */}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={"Create new shader" /* i18n-ignore */}
              disabled={disabled}
              onClick={() => pick(descriptorFromPreset(SHADER_PRESETS[0]))}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <IconPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {"Create new shader" /* i18n-ignore */}
          </TooltipContent>
        </Tooltip>
        <button
          type="button"
          aria-label={"Close shader fills" /* i18n-ignore */}
          onClick={onBack}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconX className="size-3" />
        </button>
      </div>

      {/* Search field */}
      <div className="border-t border-border/70 px-3 py-2">
        <div className="flex h-6 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2">
          <IconSearch className="size-3 shrink-0 text-muted-foreground" />
          <Input
            value={search}
            disabled={disabled}
            placeholder={"Search" /* i18n-ignore */}
            aria-label={"Search shaders" /* i18n-ignore */}
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 !text-[11px] shadow-none focus-visible:ring-0 md:!text-[11px]"
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              aria-label={"Clear search" /* i18n-ignore */}
              onClick={() => setSearch("")}
              className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <IconX className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[360px] overflow-y-auto px-3 pb-3">
        {/* ── Created by you ── */}
        {!search && (
          <section className="mb-3">
            <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground">
              {"Created by you" /* i18n-ignore design section */}
            </p>
            {/* 2-col grid — "Create new" tile occupies the first cell */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => pick(descriptorFromPreset(SHADER_PRESETS[0]))}
                className={cn(
                  "group relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--design-editor-control-border)] text-muted-foreground transition-colors",
                  "hover:border-foreground/40 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  disabled && "pointer-events-none opacity-40",
                )}
              >
                {/* AI badge — top-right corner */}
                <span className="absolute right-1.5 top-1.5 rounded bg-[var(--design-editor-control-bg)] px-1 py-px text-[9px] font-semibold leading-none text-muted-foreground">
                  {"AI" /* i18n-ignore */}
                </span>
                <IconPlus className="size-4" />
                <span className="text-[10px]">
                  {"Create new" /* i18n-ignore design create tile */}
                </span>
              </button>
            </div>
          </section>
        )}

        {/* ── Library presets — 2-col preset thumbnail grid ── */}
        <section>
          {!search && (
            <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground">
              {"Library presets" /* i18n-ignore design section */}
            </p>
          )}
          {filtered.length === 0 ? (
            <p className="py-4 text-center !text-[11px] text-muted-foreground">
              {"No shaders match your search" /* i18n-ignore */}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map((preset) => (
                <Tooltip key={preset.name}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={preset.label}
                      onClick={() => pick(descriptorFromPreset(preset))}
                      className={cn(
                        "group flex flex-col gap-1 text-left focus-visible:outline-none",
                        disabled && "pointer-events-none opacity-40",
                      )}
                    >
                      <ShaderThumbnail preset={preset} selected={false} />
                      <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground">
                        {preset.label}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{preset.description}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
