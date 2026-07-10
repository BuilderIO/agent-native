/**
 * GlslShaderPanel — the code-backed "Shader" paint-type / effect-type picker.
 *
 * Mirrors Figma UI3's Shader picker structure:
 *   • "Created by you"  — shaders already saved in this design's screen HTML
 *     (parsed live from the source via shared/shader-fills.ts), plus the
 *     "Create new" AI tile that prefills the agent chat.
 *   • "Presets"         — the curated GLSL preset library from
 *     shared/shader-presets.ts (our "By Figma" equivalent).
 *
 * Unlike the legacy ShaderFillsPanel (paper-design GPU presets persisted as
 * CSS gradient approximations), applying a shader here persists the real GLSL
 * fragment source + uniforms manifest into the screen HTML — readable and
 * editable in the Code panel — and the embedded WebGL runtime renders it live
 * in the editor and in exported standalone HTML.
 *
 * Persistence path (no new actions):
 *   read-source-file → applyShaderToHtml() → apply-source-edit(full-replace,
 *   expectedVersionHash) → onApplied(fileId, content) so the host editor can
 *   sync its local/collab state (same contract as component prop edits).
 *
 * Live preview path: postMessage broadcast to every screen iframe; the
 * shader-fill-preview bridge forwards to the injected runtime, which only
 * mounts on the iframe that actually contains the target node.
 *
 * See the "Cross-pipeline write-race guard" section below for why this
 * picker's persist flow registers itself in a small exclusion registry that
 * DesignEditor.tsx's commitVisualStyles checks before its own competing
 * content write (Fill section Add layer / Remove layer, concurrent with an
 * in-flight shader apply, otherwise corrupts the document).
 */

import {
  callAction,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
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
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

import { ScrubInput, type ScrubInputChangeMeta } from "./ScrubInput";

// ─── Cross-pipeline write-race guard ──────────────────────────────────────────
//
// This picker's persist flow (read-source-file GET -> pure transform ->
// apply-source-edit POST) is a SEPARATE round trip from the base Fill
// section's style commits (DesignEditor.tsx's commitVisualStyles ->
// update-file), and both ultimately feed the SAME per-file Yjs collab
// document — one via a diff-based server-side `applyText`, the other via the
// host's own synchronous, untracked full-document `ydoc.transact` rewrite
// (see DesignEditor.tsx's applyLocalContentUpdate/commitVisualStyles
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
// EditPanel.tsx's context plumbing is unchanged) that DesignEditor.tsx's
// commitVisualStyles imports directly to defer its own competing write until
// this picker's in-flight persist for the same file has fully settled
// (including the onApplied host-sync), closing the race at its source
// instead of papering over the corrupted result afterward.

/**
 * Per-file registry of in-flight shader persist operations (read-source-file
 * GET through apply-source-edit POST through the onApplied host-sync
 * callback). Module-scoped rather than threaded through
 * GlslShaderPanelContext so DesignEditor.tsx can await it without EditPanel.tsx
 * needing to forward a new prop.
 */
const shaderWriteLocks = new Map<string, Promise<void>>();

/** True while a shader persist for this file id has not yet settled. */
export function isShaderWriteInFlight(fileId: string | undefined): boolean {
  return !!fileId && shaderWriteLocks.has(fileId);
}

/**
 * Resolves once every shader persist registered for this file id (at the time
 * of the call) has settled. Callers that are about to perform their own
 * competing full-document content write for the same file should await this
 * first so their write is always computed from — and lands after — the
 * shader's already-settled result, instead of racing it.
 */
export async function waitForShaderWriteToSettle(
  fileId: string | undefined,
): Promise<void> {
  if (!fileId) return;
  const pending = shaderWriteLocks.get(fileId);
  if (pending) await pending.catch(() => {});
}

/**
 * Registers `fn` as the in-flight shader write for `fileId` until it settles,
 * chaining behind any already-registered write for the same file so two
 * shader operations on one file stay ordered too. Mirrors the identity-guard
 * pattern DesignEditor.tsx's fileSaveChainsRef already uses for update-file
 * saves: only clear the registry entry if nothing newer replaced it while
 * this one was running.
 */
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

// ─── Context contract ─────────────────────────────────────────────────────────

export interface GlslShaderPanelContext {
  designId?: string;
  fileId?: string;
  /** Stable data-agent-native-node-id of the target element. */
  nodeId?: string;
  selector?: string;
  /**
   * Called after a persisted apply with the patched file content so the host
   * editor can sync local/collab state (same contract as component prop
   * edits' onComponentPropApplied).
   */
  onApplied?: (fileId: string, content: string, updatedAt?: string) => void;
  /**
   * Optional: focus the Code panel on this screen's source so the user can
   * edit the GLSL directly. When absent the Edit-code affordance still
   * explains where the source lives.
   */
  onEditCode?: (shaderId: string) => void;
}

// ─── Screen-source plumbing ───────────────────────────────────────────────────

interface SourceFileResult {
  fileId?: string;
  path?: string;
  content?: string;
  versionHash?: string;
}

/** Broadcast a bridge message to every screen iframe (runtime filters by target). */
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

/**
 * Read the target screen's saved shaders + element mounts. Co-located data
 * hook for the shader picker and the effects rows.
 */
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

/**
 * One persisted shader write: fresh read → pure HTML transform → guarded
 * full-replace write → host sync + iframe rescan.
 */
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
      // Serialize against any other in-flight shader write for this file, AND
      // register this operation in the shared registry so DesignEditor.tsx's
      // commitVisualStyles (Add layer / Remove layer / any other base style
      // commit) can await waitForShaderWriteToSettle(fileId) before doing its
      // own competing full-document ydoc rewrite — see the module doc comment
      // above for why an un-serialized race here corrupts the document.
      return await withShaderWriteLock(fileId, async () => {
        // read-source-file is a read-only GET action (see useScreenGlslShaders'
        // useActionQuery above and the code-workbench inline provider's
        // readFile) — it must be called imperatively via callAction with
        // method: "GET", never useActionMutation (which always POSTs and the
        // server rejects with "Method not allowed. Use GET.").
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

// ─── Small building blocks ────────────────────────────────────────────────────

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
    <div className="flex h-6 items-center gap-1.5">
      <span className="w-20 shrink-0 truncate !text-[11px] text-muted-foreground">
        {label}
      </span>
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
        className="h-6 min-w-0 flex-1 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] uppercase shadow-none md:!text-[11px]"
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
}

/**
 * Localized preset-category labels. `shared/shader-presets.ts` only carries
 * the stable English `GLSL_SHADER_PRESET_CATEGORY_LABELS` (shared code, not
 * i18n-aware), so the picker maps category -> catalog key here instead.
 */
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

// ─── Uniform knobs (shared by fill picker + effect rows) ─────────────────────

export function GlslShaderKnobs({
  def,
  values,
  disabled,
  onValuesChange,
}: {
  def: GlslShaderDef;
  values: Record<string, GlslUniformValue>;
  disabled?: boolean;
  /**
   * phase "preview" = live scrub tick (cheap, broadcast-only);
   * phase "commit" = gesture end (persist).
   */
  onValuesChange: (
    next: Record<string, GlslUniformValue>,
    changedName: string,
    phase: "preview" | "commit",
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
    phase: "preview" | "commit",
  ) => {
    onValuesChange({ ...values, [name]: value }, name, phase);
  };
  return (
    <div className="space-y-1">
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
              onChange={(next, phase) => emit(name, next, phase)}
            />
          );
        }
        if (u.type === "vec2") {
          const pair = Array.isArray(current) ? current : [0, 0];
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
        return (
          <ScrubInput
            key={name}
            label={label}
            value={typeof current === "number" ? current : Number(current) || 0}
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

// ─── Main panel ───────────────────────────────────────────────────────────────

export interface GlslShaderPanelProps {
  mode: GlslShaderMode;
  context: GlslShaderPanelContext;
  /**
   * Return to the previous picker view (fill picker) or close the popover.
   * `hasShader` reports whether the target element has a persisted shader of
   * this panel's mode — callers use it to decide whether to revert the paint
   * type (never revert when a shader is actually applied).
   */
  onBack: (hasShader: boolean) => void;
  disabled?: boolean;
}

export function GlslShaderPanel({
  mode,
  context,
  onBack,
  disabled = false,
}: GlslShaderPanelProps) {
  const t = useT();
  const categoryLabel = useShaderPresetCategoryLabel();
  const [search, setSearch] = useState("");
  // View state: detail view shows whenever the target node has a shader of
  // this mode (or one was just applied) UNLESS the user explicitly backed
  // out to browse for a replacement.
  const [browsing, setBrowsing] = useState(false);
  const [justAppliedId, setJustAppliedId] = useState<string | null>(null);
  const screen = useScreenGlslShaders(context);
  const { persist, busy } = usePersistShaderEdit(context);

  const nodeId = context.nodeId;
  const modeAttrTitle =
    mode === "effect"
      ? t("editPanel.shaders.effectsTitle")
      : t("editPanel.shaders.fillsTitle");

  // The shader currently mounted on the target node (persisted state).
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
    phase: "preview" | "commit",
  ) => {
    if (!activeDef) return;
    setDraftValues(next);
    // Live-update the mounted shader in whichever iframe hosts the node.
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

  // ── Detail view — knobs for the applied shader ────────────────────────────
  if (activeDef) {
    return (
      <div className="flex flex-col">
        <div className="flex h-6 items-center gap-1.5 px-3">
          <button
            type="button"
            aria-label={t("editPanel.shaders.backToBrowser")}
            onClick={() => {
              setBrowsing(true);
              setJustAppliedId(null);
              setDraftValues(null);
            }}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconArrowLeft className="size-3.5" />
          </button>
          <span className="flex-1 truncate !text-[11px] font-semibold text-foreground">
            {activeDef.name}
          </span>
          {context.onEditCode ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("editPanel.shaders.editCode")}
                  onClick={() => context.onEditCode?.(activeDef.id)}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <IconCode className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("editPanel.shaders.editCode")}</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("editPanel.shaders.removeShader")}
                disabled={disabled || busy || !nodeMount}
                onClick={() => void removeFromNode()}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
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
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconX className="size-3" />
          </button>
        </div>
        <div className="space-y-2 border-t border-border/70 p-2">
          <GlslShaderKnobs
            def={activeDef}
            values={values}
            disabled={disabled || busy}
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

  // ── Browse view ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex h-6 items-center gap-1 px-3">
        <span className="flex-1 truncate !text-[11px] font-semibold text-foreground">
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

      {/* Search */}
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

// ─── Effects-section integration ─────────────────────────────────────────────

/**
 * Shader rows + picker for EditPanel's Effects section. Rendered alongside
 * the shadow/blur rows; the "Add effect ▸ Shader" menu item controls
 * `pickerOpen`. One shader effect per element (it can coexist with a shader
 * fill — different attribute namespaces).
 */
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
        /* design effect row: [name + knobs popover trigger (flex-1)] [remove] */
        <Popover>
          <div className="group flex items-center gap-1.5">
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
              >
                <IconWaveSine className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {effectDef.name}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {t("editPanel.labels.shaderEffectType")}
                </span>
              </button>
            </PopoverTrigger>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("editPanel.shaders.removeShaderEffect")}
                  disabled={disabled || busy}
                  onClick={removeEffect}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none"
                >
                  <IconTrash className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t("editPanel.shaders.removeShaderEffect")}
              </TooltipContent>
            </Tooltip>
          </div>
          <PopoverContent
            side="left"
            align="start"
            sideOffset={8}
            className="z-[10000] w-[252px] p-0 shadow-xl"
          >
            <GlslShaderPanel
              mode="effect"
              context={context}
              disabled={disabled}
              onBack={() => onPickerOpenChange(false)}
            />
          </PopoverContent>
        </Popover>
      ) : null}

      {pickerOpen && !effectMount ? (
        /* Inline browse panel while choosing the first shader effect. */
        <div className="rounded-md border border-[var(--design-editor-control-border)] bg-popover py-1.5">
          <GlslShaderPanel
            mode="effect"
            context={context}
            disabled={disabled}
            onBack={() => onPickerOpenChange(false)}
          />
        </div>
      ) : null}
    </>
  );
}
