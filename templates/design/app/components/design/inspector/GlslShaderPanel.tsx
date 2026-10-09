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
  shaderUniformLabel,
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
  IconEye,
  IconMinus,
  IconPlus,
  IconSearch,
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
import type { ScrubInputChangeMeta } from "./ScrubInput";

// ─── Cross-pipeline write-race guard ──────────────────────────────────────────
//
// This picker's persist flow (read-source-file GET -> pure transform ->
// apply-source-edit POST) is a SEPARATE round trip from the base Fill
// section's style commits (commands/commit-visual-styles.ts ->
// update-file), and both ultimately feed the SAME per-file Yjs collab
// document — one via a diff-based server-side `applyText`, the other via the
// host's own synchronous, untracked full-document `ydoc.transact` rewrite
// (see commands/apply-local-content-update.ts / commit-visual-styles.ts
// "Untracked full rewrite" comments). If a base style edit (e.g. Fill's Add
// layer / Remove layer) fires WHILE a shader apply/remove/knob-commit for the
// SAME file is still in flight, the two writes are computed from a common
// ancestor but never see each other before landing: the shader write's
// server-side diff and the style edit's own client-side full-document Y.Text
// rewrite merge as two divergent CRDT deltas, which do not converge to either
// intended document — verified to reproduce as a corrupted, doubled document
// (two concatenated <!DOCTYPE>...</html> copies) via the real
// applyShaderToHtml/applyVisualEdit/applyTextToYDoc functions.
//
// `withShaderWriteLock`/`isShaderWriteInFlight` below is a small, file-scoped
// exclusion registry (no new action, no new GlslShaderPanelContext field —
// EditPanel.tsx's context plumbing is unchanged) that
// commands/commit-visual-styles.ts imports directly to defer its own competing write until
// this picker's in-flight persist for the same file has fully settled
// (including the onApplied host-sync), closing the race at its source
// instead of papering over the corrupted result afterward.

/**
 * Per-file registry of in-flight shader persist operations (read-source-file
 * GET through apply-source-edit POST through the onApplied host-sync
 * callback). Module-scoped rather than threaded through
 * GlslShaderPanelContext so the editor can await it without EditPanel.tsx
 * needing to forward a new prop.
 */
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

/** A pure edit of one screen's HTML: what a shader apply or remove is. */
export type ShaderSourceTransform = (html: string) => {
  html: string;
  errors: string[];
};

export type ShaderSourceEditResult =
  | { status: "applied" | "unchanged" }
  | { status: "failed"; error: string };

export interface GlslShaderPanelContext {
  designId?: string;
  fileId?: string;
  /**
   * The source the editor already holds. Without it the panel fetches the
   * file, unless `editSource` says the editor owns it.
   */
  content?: string;
  nodeId?: string;
  selector?: string;
  onApplied?: (fileId: string, content: string, updatedAt?: string) => void;
  onEditCode?: (shaderId: string) => void;
  /**
   * The picker choosing the shader belongs to a gradient or image layer, not
   * the element's base fill. A fill shader replaces that layer, so applying one
   * removes the layers in the same write, then calls `onFillShaderApplied`.
   */
  replacesBackgroundLayers?: boolean;
  onFillShaderApplied?: () => void;
  /**
   * Edits the file through the editor instead of the server's source actions.
   * Set for a file those actions cannot serve: the board, which
   * `read-source-file` answers with an empty virtual file and
   * `apply-source-edit` does not find. The editor holds the board and saves it
   * itself, so a shader edit on a frame drawn there goes through it.
   */
  editSource?: (transform: ShaderSourceTransform) => ShaderSourceEditResult;
}

interface SourceFileResult {
  fileId?: string;
  path?: string;
  content?: string;
  versionHash?: string;
}

/**
 * The shader painted as the picked element's fill, read from the screen
 * source the editor holds. null when it has none, or when the source is not
 * held and would have to be fetched: the Shader pane then finds it itself.
 */
export function findFillShader(
  context: GlslShaderPanelContext | undefined,
): { id: string; name: string } | null {
  const content = context?.content;
  const nodeId = context?.nodeId;
  if (!content || !nodeId || !content.includes("data-an-shader-fill")) {
    return null;
  }
  const mount = listShaderMounts(content).find(
    (candidate) => candidate.nodeId === nodeId && candidate.mode === "fill",
  );
  if (!mount) return null;
  const def = listShadersInHtml(content).find(
    (shader) => shader.id === mount.shaderId,
  );
  return def ? { id: def.id, name: def.name } : null;
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
  // A file the editor owns is never fetched: the server answers it with an
  // empty document, which would read as a design with no shaders.
  const enabled =
    Boolean(context.designId && context.fileId) &&
    context.content === undefined &&
    context.editSource === undefined;
  const query = useActionQuery<SourceFileResult>(
    "read-source-file",
    { designId: context.designId ?? "", fileId: context.fileId ?? "" },
    { enabled },
  );
  const content =
    context.content ?? (enabled ? (query.data?.content ?? "") : "");
  const shaders = useMemo(() => listShadersInHtml(content), [content]);
  const mounts = useMemo(() => listShaderMounts(content), [content]);
  return { ...query, enabled, content, shaders, mounts };
}

export function usePersistShaderEdit(context: GlslShaderPanelContext) {
  const t = useT();
  const applyEdit = useActionMutation("apply-source-edit");
  const [busy, setBusy] = useState(false);

  const persist = async (
    transform: ShaderSourceTransform,
  ): Promise<boolean> => {
    if (context.editSource) {
      const result = context.editSource(transform);
      if (result.status === "failed") {
        toast.error(result.error);
        return false;
      }
      if (result.status === "applied") {
        broadcastShaderMessage({ type: "glsl-shader-preview-clear" });
        broadcastShaderMessage({ type: "glsl-shader-rescan" });
      }
      return true;
    }
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

/**
 * A definition that is a built-in preset exactly as stamped into the design.
 * Applying a preset copies its code under a new id, so the name and the code
 * tell it apart; once the code is edited it is the user's.
 */
export function isPresetStamp(def: GlslShaderDef): boolean {
  return GLSL_SHADER_PRESETS.some(
    (preset) =>
      preset.mode === def.mode &&
      preset.label === def.name &&
      preset.glsl.trim() === def.glsl.trim(),
  );
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
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (next: string, phase: "preview" | "commit") => void;
}) {
  const hex = normalizeHex(value);
  return (
    <InspectorControlField label={label}>
      <div className="flex h-6 min-w-0 items-center gap-2 rounded-md bg-[var(--design-editor-control-bg)] px-1.5">
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
    </InspectorControlField>
  );
}

export function useShaderPresetCategoryLabel() {
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

export function PresetThumb({
  preset,
  disabled,
  labelClassName,
  onPick,
}: {
  preset: GlslShaderPreset;
  disabled?: boolean;
  labelClassName?: string;
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
          <span
            className={cn(
              "truncate text-[10px] text-muted-foreground group-hover:text-foreground",
              labelClassName,
            )}
          >
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
  onValuesChange,
}: {
  def: GlslShaderDef;
  values: Record<string, GlslUniformValue>;
  disabled?: boolean;
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
  return (
    <div className="design-inspector-popover-stack">
      {entries.map(([name, u]) => {
        const label = shaderUniformLabel(name, u);
        const current = values[name] ?? u.value;
        if (u.type === "color") {
          return (
            <ColorKnob
              key={name}
              label={label}
              value={typeof current === "string" ? current : "#808080"}
              disabled={disabled}
              onChange={(next, phase) => emit(name, next, phase)}
            />
          );
        }
        if (u.type === "vec2") {
          const pair = Array.isArray(current) ? current : [0, 0];
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
        const numericValue =
          typeof current === "number" ? current : Number(current) || 0;
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
      })}
    </div>
  );
}

/**
 * What the shader browser and the shader controls share: the shader on the
 * element, the presets and saved shaders to browse, and the writes. Every
 * write goes through `usePersistShaderEdit`.
 */
export function useGlslShaderSession({
  mode,
  context,
}: {
  mode: GlslShaderMode;
  context: GlslShaderPanelContext;
}) {
  const t = useT();
  const categoryLabel = useShaderPresetCategoryLabel();
  const [search, setSearch] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [justAppliedId, setJustAppliedId] = useState<string | null>(null);
  const screen = useScreenGlslShaders(context);
  const { persist, busy } = usePersistShaderEdit(context);

  const nodeId = context.nodeId;

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
  // The element points at a shader whose code is not in the design (written by
  // hand, or its block was lost). That is not "no shader": it is said, and the
  // reference can be removed.
  const missingShaderId =
    nodeMount &&
    !browsing &&
    !justAppliedId &&
    !screen.shaders.some((shader) => shader.id === nodeMount.shaderId)
      ? nodeMount.shaderId
      : null;
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

  // "Created by you": the shaders in this design's HTML that are the user's own
  // (written by the agent or edited from a preset), not a preset stamped in as
  // it is. A preset applied to another element is already in the grid below.
  const savedShaders = useMemo(() => {
    const byMode = screen.shaders.filter(
      (shader) => shader.mode === mode && !isPresetStamp(shader),
    );
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
        clearBackgroundLayers: context.replacesBackgroundLayers,
      }),
    );
    if (ok) {
      setJustAppliedId(def.id);
      setBrowsing(false);
      setDraftValues(null);
      // The preset select in the controls lists every preset; a search typed
      // while browsing must not carry over and narrow it.
      setSearch("");
      void screen.refetch();
      if (def.mode === "fill") context.onFillShaderApplied?.();
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

  /** Back to the browser, leaving the shader on the element. */
  const browse = () => {
    setBrowsing(true);
    setJustAppliedId(null);
    setDraftValues(null);
  };

  /** Whether the shader came off the element. */
  const removeFromNode = async (): Promise<boolean> => {
    if (!nodeId) return false;
    // Scope removal to this panel's mode — a fill and an effect can coexist
    // on one node (see shared/shader-fills.ts), so clearing the fill picker
    // must not also wipe a coexisting shader effect (and vice versa).
    const ok = await persist((html) =>
      removeShaderFromNode(html, nodeId, mode),
    );
    if (ok) {
      setJustAppliedId(null);
      setBrowsing(true);
      setDraftValues(null);
      void screen.refetch();
    }
    return ok;
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

  return {
    search,
    setSearch,
    busy,
    nodeMount,
    activeDef,
    missingShaderId,
    values,
    presets,
    savedShaders,
    applyPreset,
    applySaved,
    browse,
    removeFromNode,
    createWithAi,
    handleValuesChange,
  };
}

export interface GlslShaderPanelProps {
  mode: GlslShaderMode;
  context: GlslShaderPanelContext;
  disabled?: boolean;
}

/** The shader browser and controls an effect's popover shows. The fill picker has its own pane. */
export function GlslShaderPanel({
  mode,
  context,
  disabled = false,
}: GlslShaderPanelProps) {
  const t = useT();
  const session = useGlslShaderSession({ mode, context });
  const { search, setSearch, busy, activeDef, values, presets, savedShaders } =
    session;

  if (activeDef) {
    return (
      <div className="flex flex-col">
        <div className="grid gap-2">
          <GlslShaderKnobs
            def={activeDef}
            values={values}
            disabled={disabled || busy}
            onValuesChange={session.handleValuesChange}
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
      {/* Search */}
      <div className="px-3 py-2">
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
                onClick={session.createWithAi}
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
                      onClick={() => session.applySaved(shader)}
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
                  onClick={() => session.applySaved(shader)}
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
                  onPick={session.applyPreset}
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
            />
          </InspectorControlPopoverContent>
        </Popover>
      ) : null}
    </>
  );
}
