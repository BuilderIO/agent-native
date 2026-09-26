import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  applyShaderToHtml,
  annotateNodeWithShader,
  defaultUniformValues,
  listShaderMounts,
  listShadersInHtml,
  newShaderId,
  removeShaderFromNode,
  type GlslShaderDef,
  type GlslShaderMode,
  type GlslUniformValue,
} from "@shared/shader-fills";
import {
  GLSL_SHADER_PRESETS,
  type GlslShaderPreset,
  type GlslShaderPresetCategory,
} from "@shared/shader-presets";
import {
  IconArrowLeft,
  IconCode,
  IconEye,
  IconMinus,
  IconPlus,
  IconSearch,
  IconTrash,
  IconWaveSine,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

import { SectionIconButton } from "../edit-panel/inspector-controls";
import {
  InspectorGridCell,
  InspectorPaintRow,
} from "../edit-panel/inspector-grid";
import {
  InspectorControlField,
  InspectorControlPopoverContent,
} from "./InspectorControlPopover";
import { ScrubInput, type ScrubInputChangeMeta } from "./ScrubInput";


const shaderWriteLocks = new Map<string, Promise<void>>();

export function isShaderWriteInFlight(fileId: string | undefined): boolean {
  return !!fileId && shaderWriteLocks.has(fileId);
}

export async function waitForShaderWriteToSettle(
  fileId: string | undefined,
): Promise<void> {
  if (!fileId) return;
  const pending = shaderWriteLocks.get(fileId);
  if (pending) await pending.catch(() => {});
}

function withShaderWriteLock<T>(
  fileId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = shaderWriteLocks.get(fileId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const settleMarker = run.then(
    () => undefined,
    () => undefined,
  );
  shaderWriteLocks.set(fileId, settleMarker);
  void settleMarker.finally(() => {
    if (shaderWriteLocks.get(fileId) === settleMarker) {
      shaderWriteLocks.delete(fileId);
    }
  });
  return run;
}


export interface GlslShaderPanelContext {
  designId?: string;
  fileId?: string;
  nodeId?: string;
  selector?: string;
  onApplied?: (fileId: string, content: string, updatedAt?: string) => void;
  onEditCode?: (shaderId: string) => void;
}


interface SourceFileResult {
  fileId?: string;
  path?: string;
  content?: string;
  versionHash?: string;
}

export function broadcastShaderMessage(message: Record<string, unknown>): void {
  if (typeof document === "undefined") return;
  const frames = document.querySelectorAll<HTMLIFrameElement>("iframe");
  frames.forEach((frame) => {
    try {
      frame.contentWindow?.postMessage(message, "*");
    } catch {
      /* inaccessible frame — ignore */
    }
  });
}

export function useScreenGlslShaders(context: GlslShaderPanelContext) {
  const enabled = Boolean(context.designId && context.fileId);
  const query = useActionQuery<SourceFileResult>(
    "read-source-file",
    { designId: context.designId ?? "", fileId: context.fileId ?? "" },
    { enabled },
  );
  const content = enabled ? (query.data?.content ?? "") : "";
  const shaders = useMemo(() => listShadersInHtml(content), [content]);
  const mounts = useMemo(() => listShaderMounts(content), [content]);
  return { ...query, enabled, content, shaders, mounts };
}

export function usePersistShaderEdit(context: GlslShaderPanelContext) {
  const t = useT();
  const applyEdit = useActionMutation("apply-source-edit");
  const [busy, setBusy] = useState(false);

  const persist = async (
    transform: (html: string) => { html: string; errors: string[] },
  ): Promise<boolean> => {
    if (!context.designId || !context.fileId) {
      toast.error(t("editPanel.shaders.selectElementFirst"));
      return false;
    }
    const fileId = context.fileId;
    const designId = context.designId;
    setBusy(true);
    try {
      return await withShaderWriteLock(fileId, async () => {
        const source = await callAction<SourceFileResult>(
          "read-source-file",
          { designId, fileId },
          { method: "GET" },
        );
        const baseHtml = source.content ?? "";
        const transformed = transform(baseHtml);
        if (transformed.errors.length > 0) {
          toast.error(transformed.errors[0]);
          return false;
        }
        if (transformed.html === baseHtml) return true;
        const written = (await applyEdit.mutateAsync({
          designId,
          fileId,
          edit: { kind: "full-replace", content: transformed.html },
          ...(source.versionHash
            ? { expectedVersionHash: source.versionHash }
            : {}),
        })) as { fileId?: string; updatedAt?: string };
        context.onApplied?.(
          written.fileId ?? fileId,
          transformed.html,
          typeof written.updatedAt === "string" ? written.updatedAt : undefined,
        );
        broadcastShaderMessage({ type: "glsl-shader-preview-clear" });
        broadcastShaderMessage({ type: "glsl-shader-rescan" });
        return true;
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("editPanel.shaders.saveFailed"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { persist, busy };
}


function normalizeHex(value: string): string {
  const hex = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return (
      "#" +
      hex
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    ).toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  return "#808080";
}

function ColorKnob({
  label,
  value,
  disabled,
  presentation = "compact",
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  presentation?: "compact" | "popover";
  onChange: (next: string, phase: "preview" | "commit") => void;
}) {
  const hex = normalizeHex(value);
  const roomy = presentation === "popover";
  const control = (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        roomy && "h-6 rounded-md bg-[var(--design-editor-control-bg)] px-1.5",
      )}
    >
      <label
        className={cn(
          "relative size-4 shrink-0 cursor-pointer overflow-hidden rounded-[3px] border border-[var(--design-editor-control-border)]",
          disabled && "pointer-events-none opacity-40",
        )}
        style={{ background: hex }}
      >
        <input
          type="color"
          value={hex}
          disabled={disabled}
          aria-label={label}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          onChange={(event) => onChange(event.target.value, "preview")}
          onBlur={(event) => onChange(event.target.value, "commit")}
        />
      </label>
      <Input
        value={hex.toUpperCase()}
        disabled={disabled}
        aria-label={`${label} hex`}
        className={cn(
          "min-w-0 flex-1 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 uppercase shadow-none",
          "h-6 !text-[11px] md:!text-[11px]",
        )}
        onChange={(event) => {
          const next = event.target.value;
          if (
            /^#[0-9a-fA-F]{6}$/.test(next) ||
            /^#[0-9a-fA-F]{3}$/.test(next)
          ) {
            onChange(normalizeHex(next), "commit");
          }
        }}
      />
    </div>
  );
  if (roomy) {
    return (
      <InspectorControlField label={label}>{control}</InspectorControlField>
    );
  }
  return (
    <div className="flex h-6 items-center gap-1.5">
      <span className="w-20 shrink-0 truncate !text-[11px] text-muted-foreground">
        {label}
      </span>
      {control}
    </div>
  );
}

function useShaderPresetCategoryLabel() {
  const t = useT();
  return (category: GlslShaderPresetCategory): string => {
    switch (category) {
      case "gradient-flow":
        return t("editPanel.shaders.categories.gradientFlow");
      case "waves":
        return t("editPanel.shaders.categories.waves");
      case "noise":
        return t("editPanel.shaders.categories.noise");
      case "pattern":
        return t("editPanel.shaders.categories.pattern");
      case "texture":
        return t("editPanel.shaders.categories.texture");
      case "retro":
        return t("editPanel.shaders.categories.retro");
      default:
        return category;
    }
  };
}

function PresetThumb({
  preset,
  disabled,
  onPick,
}: {
  preset: GlslShaderPreset;
  disabled?: boolean;
  onPick: (preset: GlslShaderPreset) => void;
}) {
  const categoryLabel = useShaderPresetCategoryLabel();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={preset.label}
          onClick={() => onPick(preset)}
          className={cn(
            "group flex flex-col gap-1 text-left focus-visible:outline-none",
            disabled && "pointer-events-none opacity-40",
          )}
        >
          <div
            className="aspect-[4/3] w-full rounded-md border border-border/60 transition-colors group-hover:border-foreground/40"
            style={{ background: preset.previewCss }}
          />
          <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground">
            {preset.label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {categoryLabel(preset.category)} — {preset.description}
      </TooltipContent>
    </Tooltip>
  );
}


export function GlslShaderKnobs({
  def,
  values,
  disabled,
  presentation = "compact",
  onValuesChange,
}: {
  def: GlslShaderDef;
  values: Record<string, GlslUniformValue>;
  disabled?: boolean;
  presentation?: "compact" | "popover";
  onValuesChange: (
    next: Record<string, GlslUniformValue>,
    changedName: string,
    phase: ScrubInputChangeMeta["phase"],
  ) => void;
}) {
  const t = useT();
  const entries = Object.entries(def.uniforms);
  if (entries.length === 0) {
    return (
      <p className="px-0.5 py-1 !text-[11px] text-muted-foreground">
        {t("editPanel.shaders.noUniforms")}
      </p>
    );
  }
  const emit = (
    name: string,
    value: GlslUniformValue,
    phase: ScrubInputChangeMeta["phase"],
  ) => {
    onValuesChange({ ...values, [name]: value }, name, phase);
  };
  const roomy = presentation === "popover";
  return (
    <div
      className={cn(roomy ? "design-inspector-popover-stack" : "grid gap-1")}
    >
      {entries.map(([name, u]) => {
        const label = u.label ?? name.replace(/^u_/, "").replace(/_/g, " ");
        const current = values[name] ?? u.value;
        if (u.type === "color") {
          return (
            <ColorKnob
              key={name}
              label={label}
              value={typeof current === "string" ? current : "#808080"}
              disabled={disabled}
              presentation={presentation}
              onChange={(next, phase) => emit(name, next, phase)}
            />
          );
        }
        if (u.type === "vec2") {
          const pair = Array.isArray(current) ? current : [0, 0];
          if (roomy) {
            const emitAxis = (
              axis: 0 | 1,
              value: number,
              phase: ScrubInputChangeMeta["phase"],
            ) => {
              const next: [number, number] = [pair[0] ?? 0, pair[1] ?? 0];
              next[axis] = value;
              emit(name, next, phase);
            };
            return (
              <InspectorControlField key={name} label={label}>
                <div className="grid h-6 min-w-0 grid-cols-2 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)]">
                  {([0, 1] as const).map((axis) => (
                    <label
                      key={axis}
                      className="flex min-w-0 items-center border-r border-border/60 last:border-r-0"
                    >
                      <span className="px-2 text-xs text-muted-foreground">
                        {axis === 0 ? "X" : "Y"}
                      </span>
                      <Input
                        type="number"
                        value={Number(pair[axis]) || 0}
                        disabled={disabled}
                        aria-label={`${label} ${axis === 0 ? "X" : "Y"}`}
                        step={0.01}
                        className="h-6 min-w-0 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
                        onChange={(event) =>
                          emitAxis(axis, Number(event.target.value), "preview")
                        }
                        onBlur={(event) =>
                          emitAxis(axis, Number(event.target.value), "commit")
                        }
                      />
                    </label>
                  ))}
                </div>
              </InspectorControlField>
            );
          }
          const emitAxis = (
            axis: 0 | 1,
            value: number,
            meta: ScrubInputChangeMeta,
          ) => {
            const next: [number, number] = [pair[0] ?? 0, pair[1] ?? 0];
            next[axis] = value;
            emit(name, next, meta.phase);
          };
          return (
            <div key={name} className="flex h-6 items-center gap-1.5">
              <span className="w-20 shrink-0 truncate !text-[11px] text-muted-foreground">
                {label}
              </span>
              <ScrubInput
                label="X"
                value={Number(pair[0]) || 0}
                step={0.01}
                precision={2}
                disabled={disabled}
                onChange={(value, meta) => emitAxis(0, value, meta)}
                labelClassName="w-3"
                inputClassName="h-6"
                className="min-w-0 flex-1"
              />
              <ScrubInput
                label="Y"
                value={Number(pair[1]) || 0}
                step={0.01}
                precision={2}
                disabled={disabled}
                onChange={(value, meta) => emitAxis(1, value, meta)}
                labelClassName="w-3"
                inputClassName="h-6"
                className="min-w-0 flex-1"
              />
            </div>
          );
        }
        const numericValue =
          typeof current === "number" ? current : Number(current) || 0;
        if (roomy) {
          const min = u.min ?? 0;
          const max = u.max ?? Math.max(1, numericValue * 2);
          const step = u.step ?? 0.01;
          return (
            <InspectorControlField key={name} label={label}>
              <div className="design-inspector-popover-slider grid h-6 min-w-0 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)]">
                <div className="flex min-w-0 items-center px-2">
                  <Slider
                    value={[numericValue]}
                    min={min}
                    max={max}
                    step={step}
                    disabled={disabled}
                    aria-label={label}
                    onValueChange={([value]) =>
                      emit(name, value ?? numericValue, "preview")
                    }
                    onValueCommit={([value]) =>
                      emit(name, value ?? numericValue, "commit")
                    }
                  />
                </div>
                <Input
                  type="number"
                  value={numericValue}
                  min={min}
                  max={max}
                  step={step}
                  disabled={disabled}
                  aria-label={`${label} value`}
                  className="h-6 rounded-none border-0 border-l border-border/60 bg-transparent px-2 !text-[11px] shadow-none focus-visible:ring-0"
                  onChange={(event) =>
                    emit(name, Number(event.target.value), "preview")
                  }
                  onBlur={(event) =>
                    emit(name, Number(event.target.value), "commit")
                  }
                />
              </div>
            </InspectorControlField>
          );
        }
        return (
          <ScrubInput
            key={name}
            label={label}
            value={numericValue}
            min={u.min}
            max={u.max}
            step={u.step ?? 0.01}
            precision={u.step !== undefined && u.step >= 1 ? 0 : 2}
            disabled={disabled}
            onChange={(value, meta) => emit(name, value, meta.phase)}
            labelClassName="w-20"
            inputClassName="h-6"
          />
        );
      })}
    </div>
  );
}


export interface GlslShaderPanelProps {
  mode: GlslShaderMode;
  context: GlslShaderPanelContext;
  presentation?: "compact" | "popover";
  onBack: (hasShader: boolean) => void;
  disabled?: boolean;
}

export function GlslShaderPanel({
  mode,
  context,
  onBack,
  disabled = false,
  presentation = "compact",
}: GlslShaderPanelProps) {
  const t = useT();
  const categoryLabel = useShaderPresetCategoryLabel();
  const [search, setSearch] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [justAppliedId, setJustAppliedId] = useState<string | null>(null);
  const screen = useScreenGlslShaders(context);
  const { persist, busy } = usePersistShaderEdit(context);

  const nodeId = context.nodeId;
  const modeAttrTitle =
    mode === "effect"
      ? t("editPanel.shaders.effectsTitle")
      : t("editPanel.shaders.fillsTitle");
  const roomy = presentation === "popover";

  const nodeMount = useMemo(
    () =>
      screen.mounts.find(
        (mount) => mount.nodeId === nodeId && mount.mode === mode,
      ),
    [screen.mounts, nodeId, mode],
  );
  const activeId = browsing
    ? null
    : (justAppliedId ?? nodeMount?.shaderId ?? null);
  const activeDef = useMemo(
    () => screen.shaders.find((shader) => shader.id === activeId) ?? null,
    [screen.shaders, activeId],
  );
  const [draftValues, setDraftValues] = useState<Record<
    string,
    GlslUniformValue
  > | null>(null);
  const values = useMemo(() => {
    if (!activeDef) return {};
    return {
      ...defaultUniformValues(activeDef),
      ...(nodeMount?.shaderId === activeDef.id ? (nodeMount.values ?? {}) : {}),
      ...(draftValues ?? {}),
    };
  }, [activeDef, nodeMount, draftValues]);

  const presets = useMemo(() => {
    const byMode = GLSL_SHADER_PRESETS.filter((preset) => preset.mode === mode);
    const query = search.trim().toLowerCase();
    if (!query) return byMode;
    return byMode.filter(
      (preset) =>
        preset.label.toLowerCase().includes(query) ||
        preset.description.toLowerCase().includes(query) ||
        categoryLabel(preset.category).toLowerCase().includes(query),
    );
  }, [mode, search, categoryLabel]);

  const savedShaders = useMemo(() => {
    const byMode = screen.shaders.filter((shader) => shader.mode === mode);
    const query = search.trim().toLowerCase();
    if (!query) return byMode;
    return byMode.filter((shader) => shader.name.toLowerCase().includes(query));
  }, [screen.shaders, mode, search]);

  const fallbackFromDef = (def: GlslShaderDef): string | undefined => {
    for (const u of Object.values(def.uniforms)) {
      if (u.type === "color" && typeof u.value === "string") return u.value;
    }
    return undefined;
  };

  const applyDef = async (def: GlslShaderDef) => {
    if (!nodeId) {
      toast.error(t("editPanel.shaders.selectCanvasElementFirst"));
      return;
    }
    const ok = await persist((html) =>
      applyShaderToHtml(html, {
        nodeId,
        def,
        ...(def.mode === "fill" ? { fallbackColor: fallbackFromDef(def) } : {}),
      }),
    );
    if (ok) {
      setJustAppliedId(def.id);
      setBrowsing(false);
      setDraftValues(null);
      void screen.refetch();
    }
  };

  const applyPreset = (preset: GlslShaderPreset) => {
    void applyDef({
      id: newShaderId(),
      name: preset.label,
      mode,
      glsl: preset.glsl,
      uniforms: preset.uniforms,
    });
  };

  const applySaved = (def: GlslShaderDef) => {
    void applyDef(def);
  };

  const removeFromNode = async () => {
    if (!nodeId) return;
    const ok = await persist((html) =>
      removeShaderFromNode(html, nodeId, mode),
    );
    if (ok) {
      setJustAppliedId(null);
      setBrowsing(true);
      setDraftValues(null);
      void screen.refetch();
    }
  };

  const createWithAi = () => {
    sendToDesignAgentChat({
      message:
        mode === "effect"
          ? "Create a custom shader effect for the selected element."
          : "Create a custom shader fill for the selected element.",
      context: [
        "Use the code-backed GLSL shader format from the shader-fills skill:",
        'persist a <script type="application/x-agent-native-shader"> block',
        "(uniforms manifest comment + GLSL fragment source) in the screen",
        "HTML and reference it from the element.",
        context.designId ? `designId: ${context.designId}` : "",
        context.fileId ? `fileId: ${context.fileId}` : "",
        nodeId ? `target nodeId (data-agent-native-node-id): ${nodeId}` : "",
        `mode: ${mode}`,
      ]
        .filter(Boolean)
        .join("\n"),
      submit: false,
    });
  };

  const handleValuesChange = (
    next: Record<string, GlslUniformValue>,
    changedName: string,
    phase: ScrubInputChangeMeta["phase"],
  ) => {
    if (!activeDef) return;
    setDraftValues(next);
    broadcastShaderMessage({
      type: "glsl-shader-set-uniform",
      filter: { shaderId: activeDef.id, ...(nodeId ? { nodeId } : {}) },
      name: changedName,
      value: next[changedName],
    });
    if (phase === "commit" && nodeId) {
      void persist((html) =>
        annotateNodeWithShader(html, {
          nodeId,
          shaderId: activeDef.id,
          mode,
          values: next,
        }),
      ).then((ok) => {
        if (ok) void screen.refetch();
      });
    }
  };

  if (activeDef) {
    return (
      <div className="flex flex-col">
        {!roomy ? (
          <div className="flex h-6 items-center gap-1.5 px-3">
            <button
              type="button"
              aria-label={t("editPanel.shaders.backToBrowser")}
              onClick={() => {
                setBrowsing(true);
                setJustAppliedId(null);
                setDraftValues(null);
              }}
              className={cn(
                "flex items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                roomy ? "size-7" : "size-5",
              )}
            >
              <IconArrowLeft className="size-3.5" />
            </button>
            <span
              className={cn(
                "flex-1 truncate font-semibold text-foreground",
                roomy ? "text-sm" : "!text-[11px]",
              )}
            >
              {activeDef.name}
            </span>
            {context.onEditCode ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("editPanel.shaders.editCode")}
                    onClick={() => context.onEditCode?.(activeDef.id)}
                    className={cn(
                      "flex items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      roomy ? "size-7" : "size-5",
                    )}
                  >
                    <IconCode className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("editPanel.shaders.editCode")}
                </TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("editPanel.shaders.removeShader")}
                  disabled={disabled || busy || !nodeMount}
                  onClick={() => void removeFromNode()}
                  className={cn(
                    "flex items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
                    roomy ? "size-7" : "size-5",
                  )}
                >
                  <IconTrash className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t("editPanel.shaders.removeShader")}
              </TooltipContent>
            </Tooltip>
            <button
              type="button"
              aria-label={t("editPanel.shaders.closePanel")}
              onClick={() => onBack(Boolean(nodeMount))}
              className={cn(
                "flex items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                roomy ? "size-7" : "size-5",
              )}
            >
              <IconX className="size-3" />
            </button>
          </div>
        ) : null}
        <div
          className={cn(
            "grid",
            roomy ? "gap-2" : "gap-2 border-t border-border/70 p-2",
          )}
        >
          <GlslShaderKnobs
            def={activeDef}
            values={values}
            disabled={disabled || busy}
            presentation={presentation}
            onValuesChange={handleValuesChange}
          />
          {!context.onEditCode ? (
            <p className="px-0.5 !text-[10px] leading-snug text-muted-foreground">
              {t("editPanel.shaders.codeHint")}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {!roomy ? (
        <div className="flex h-6 items-center gap-1 px-3">
          <span className="design-sidebar-section-title flex-1 truncate text-foreground">
            {modeAttrTitle}
          </span>
          <button
            type="button"
            aria-label={t("editPanel.shaders.closePanel")}
            onClick={() => onBack(Boolean(nodeMount))}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconX className="size-3" />
          </button>
        </div>
      ) : null}

      {/* Search */}
      <div className={cn("px-3 py-2", !roomy && "border-t border-border/70")}>
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

      <div className="max-h-[380px] overflow-y-auto px-3 pb-3">
        {/* Created by you */}
        {!search && (
          <section className="mb-3">
            <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground">
              {t("editPanel.shaders.createdByYou")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={createWithAi}
                className={cn(
                  "group relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--design-editor-control-border)] text-muted-foreground transition-colors",
                  "hover:border-foreground/40 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  disabled && "pointer-events-none opacity-40",
                )}
              >
                <span className="absolute right-1.5 top-1.5 rounded bg-[var(--design-editor-control-bg)] px-1 py-px text-[9px] font-semibold leading-none text-muted-foreground">
                  {t("editPanel.shaders.ai")}
                </span>
                <IconPlus className="size-4" />
                <span className="text-[10px]">
                  {t("editPanel.shaders.createNew")}
                </span>
              </button>
              {savedShaders.map((shader) => (
                <Tooltip key={shader.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={disabled || busy}
                      aria-label={shader.name}
                      onClick={() => applySaved(shader)}
                      className={cn(
                        "group flex flex-col gap-1 text-left focus-visible:outline-none",
                        (disabled || busy) && "pointer-events-none opacity-40",
                      )}
                    >
                      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-border/60 bg-[var(--design-editor-control-bg)] transition-colors group-hover:border-foreground/40">
                        <IconWaveSine className="size-4 text-muted-foreground" />
                      </div>
                      <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground">
                        {shader.name}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("editPanel.shaders.savedInThisDesign")}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </section>
        )}

        {/* Saved shaders matching a search */}
        {search && savedShaders.length > 0 && (
          <section className="mb-3">
            <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground">
              {t("editPanel.shaders.createdByYou")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {savedShaders.map((shader) => (
                <button
                  key={shader.id}
                  type="button"
                  disabled={disabled || busy}
                  aria-label={shader.name}
                  onClick={() => applySaved(shader)}
                  className="group flex flex-col gap-1 text-left focus-visible:outline-none"
                >
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-border/60 bg-[var(--design-editor-control-bg)] transition-colors group-hover:border-foreground/40">
                    <IconWaveSine className="size-4 text-muted-foreground" />
                  </div>
                  <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground">
                    {shader.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Presets */}
        <section>
          <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground">
            {t("editPanel.shaders.presets")}
          </p>
          {presets.length === 0 ? (
            <p className="py-4 text-center !text-[11px] text-muted-foreground">
              {t("editPanel.shaders.noMatches")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => (
                <PresetThumb
                  key={preset.name}
                  preset={preset}
                  disabled={disabled || busy}
                  onPick={applyPreset}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


export function GlslShaderEffectSection({
  context,
  pickerOpen,
  onPickerOpenChange,
  disabled = false,
}: {
  context: GlslShaderPanelContext;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [effectPopoverOpen, setEffectPopoverOpen] = useState(false);
  const screen = useScreenGlslShaders(context);
  const { persist, busy } = usePersistShaderEdit(context);
  const nodeId = context.nodeId;

  const effectMount = useMemo(
    () =>
      screen.mounts.find(
        (mount) => mount.nodeId === nodeId && mount.mode === "effect",
      ),
    [screen.mounts, nodeId],
  );
  const effectDef = useMemo(
    () =>
      effectMount
        ? (screen.shaders.find(
            (shader) => shader.id === effectMount.shaderId,
          ) ?? null)
        : null,
    [screen.shaders, effectMount],
  );

  const removeEffect = () => {
    if (!nodeId) return;
    setEffectPopoverOpen(false);
    void persist((html) => removeShaderFromNode(html, nodeId, "effect")).then(
      (ok) => {
        if (ok) void screen.refetch();
      },
    );
  };

  if (!effectMount && !pickerOpen) return null;

  return (
    <>
      {effectDef && effectMount ? (
        <Popover open={effectPopoverOpen} onOpenChange={setEffectPopoverOpen}>
          <InspectorPaintRow>
            <InspectorGridCell span={20}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                >
                  <IconWaveSine className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {effectDef.name}
                  </span>
                </button>
              </PopoverTrigger>
            </InspectorGridCell>
            <InspectorGridCell span={4} className="flex justify-center">
              <SectionIconButton
                label={
                  "Shader effects are always visible" /* i18n-ignore design shader state */
                }
                disabled
                className="disabled:opacity-100"
              >
                <IconEye className="size-3.5" />
              </SectionIconButton>
            </InspectorGridCell>
            <InspectorGridCell span={4} className="flex justify-center">
              <SectionIconButton
                label={t("editPanel.shaders.removeShaderEffect")}
                disabled={disabled || busy}
                onClick={removeEffect}
              >
                <IconMinus className="size-3.5" />
              </SectionIconButton>
            </InspectorGridCell>
          </InspectorPaintRow>
          <InspectorControlPopoverContent
            title={effectDef.name}
            icon={<IconWaveSine className="size-3.5" />}
            onClose={() => setEffectPopoverOpen(false)}
          >
            <GlslShaderPanel
              mode="effect"
              context={context}
              disabled={disabled}
              presentation="popover"
              onBack={() => setEffectPopoverOpen(false)}
            />
          </InspectorControlPopoverContent>
        </Popover>
      ) : null}

      {pickerOpen && !effectMount ? (
        <Popover open onOpenChange={onPickerOpenChange}>
          <PopoverAnchor asChild>
            <span className="block h-0 w-full" />
          </PopoverAnchor>
          {/* The menu handoff can move focus while the canvas reprojects. */}
          <InspectorControlPopoverContent
            title={t("editPanel.shaders.effectsTitle")}
            icon={<IconWaveSine className="size-3.5" />}
            onClose={() => onPickerOpenChange(false)}
            onFocusOutside={(event) => event.preventDefault()}
            bodyClassName="p-0"
          >
            <GlslShaderPanel
              mode="effect"
              context={context}
              disabled={disabled}
              presentation="popover"
              onBack={() => onPickerOpenChange(false)}
            />
          </InspectorControlPopoverContent>
        </Popover>
      ) : null}
    </>
  );
}
