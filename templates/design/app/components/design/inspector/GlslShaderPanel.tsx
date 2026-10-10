import {
  actionErrorMessage,
  callAction,
  getBrowserTabId,
  setClientAppState,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { nativeEffectAnimationCapability } from "@shared/native-effect-animation-capability";
import type { NativeEffectEdit } from "@shared/native-effect-edits";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_PRESETS,
} from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import {
  parseEffectsFromHtml,
  type EffectDefinition,
  type EffectInstance,
  type EffectPreviewPolicy,
  type EffectPreset,
  type EffectTransform2D,
  type EffectValue,
} from "@shared/native-effects";
import { hashEffectInstance } from "@shared/native-instance-preview-contract";
import {
  annotateNodeWithShader,
  defaultUniformValues,
  listShaderMounts,
  listShadersInHtml,
  removeShaderFromNode,
  type GlslShaderDef,
  type GlslShaderMode,
  type GlslUniformValue,
} from "@shared/shader-fills";
import {
  IconArrowLeft,
  IconBookmark,
  IconChevronDown,
  IconCode,
  IconEye,
  IconMinus,
  IconSearch,
  IconTrash,
  IconWaveSine,
  IconX,
} from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { designShaderFocusStateKeyForTab } from "@/hooks/use-navigation-state";
import { cn } from "@/lib/utils";

import type {
  NativeColorCapability,
  NativeColorMode,
  NativeDynamicRangeMode,
} from "../bridge/native-color-mode";
import {
  readNativeShaderRuntimeStatus,
  type NativeShaderRuntimeStatus,
} from "../design-canvas/native-status-bridge";
import { SectionIconButton } from "../edit-panel/inspector-controls";
import {
  InspectorGridCell,
  InspectorPaintRow,
} from "../edit-panel/inspector-grid";
import {
  InspectorControlField,
  InspectorControlPopoverContent,
} from "./InspectorControlPopover";
import { nativeCatalogDefinitionKey } from "./native-catalog-display";
import { readNativeColorCapability } from "./native-color-preview-client";
import { sendNativeInstancePreviewMessage } from "./native-instance-preview-client";
import { NativeInstanceScrubSession } from "./native-instance-scrub-session";
import {
  defaultNativeIntrinsicSourceSizing,
  nativeApplySourceSizing,
  NativeIntrinsicSourceClientError,
} from "./native-intrinsic-source-client";
import { readNativeInstancePlaybackState } from "./native-playback-client";
import {
  readSelectedNativePreviewStatus,
  type NativePreviewStatus,
} from "./native-preview-policy-client";
import { nativeRuntimeDiagnosticKey } from "./native-runtime-diagnostic";
import { findNativeDraftFrame } from "./native-shader-draft-client";
import {
  nativeTransformDisplayValue,
  updateNativeTransform,
  type NativeTransformField,
} from "./native-transform-controls";
import { NativeEffectApproval } from "./NativeEffectApproval";
import { NativeEffectControls } from "./NativeEffectControls";
import { nativeEffectValuesEqual } from "./NativeEffectControls";
import { NativeShaderLibraryBrowser } from "./NativeShaderLibraryBrowser";
import { ScrubInput, type ScrubInputChangeMeta } from "./ScrubInput";

const NativeShaderLab = lazy(() =>
  import("./NativeShaderLab").then((module) => ({
    default: module.NativeShaderLab,
  })),
);

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
  /** The screen source the editor already holds; without it the panel fetches it. */
  content?: string;
  nodeId?: string;
  nodeIds?: string[];
  selector?: string;
  nativeOnly?: boolean;
  boardFile?: boolean;
  onApplied?: (
    fileId: string,
    content: string,
    updatedAt?: string,
    beforeContent?: string,
  ) => void;
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
  const enabled =
    Boolean(context.designId && context.fileId) &&
    context.content === undefined;
  const query = useActionQuery<SourceFileResult>(
    "read-source-file",
    { designId: context.designId ?? "", fileId: context.fileId ?? "" },
    { enabled },
  );
  const content =
    context.content ?? (enabled ? (query.data?.content ?? "") : "");
  const shaders = useMemo(() => listShadersInHtml(content), [content]);
  const mounts = useMemo(() => listShaderMounts(content), [content]);
  const nativeEffects = useMemo(() => parseEffectsFromHtml(content), [content]);
  return { ...query, enabled, content, shaders, mounts, nativeEffects };
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
        if (!source.versionHash || typeof source.content !== "string")
          throw new Error(t("editPanel.shaders.saveFailed"));
        const baseHtml = source.content;
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
          expectedVersionHash: source.versionHash,
        })) as { fileId?: string; updatedAt?: string };
        context.onApplied?.(
          written.fileId ?? fileId,
          transformed.html,
          typeof written.updatedAt === "string" ? written.updatedAt : undefined,
          baseHtml,
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

export function usePersistNativeShaderEdit(context: GlslShaderPanelContext) {
  const t = useT();
  const editNative = useActionMutation("edit-native-shader");
  const [busy, setBusy] = useState(false);

  const persistNative = async (
    operation: NativeEffectEdit,
    options?: { expectedVersionHash?: string },
  ): Promise<{ content: string; instanceIds: string[] } | null> => {
    if (!context.designId || !context.fileId) {
      toast.error(t("editPanel.shaders.selectElementFirst"));
      return null;
    }
    const { designId, fileId } = context;
    setBusy(true);
    try {
      return await withShaderWriteLock(fileId, async () => {
        const source = await callAction<SourceFileResult>(
          "read-source-file",
          { designId, fileId },
          { method: "GET" },
        );
        if (!source.versionHash || typeof source.content !== "string")
          throw new Error(t("editPanel.shaders.saveFailed"));
        if (
          options?.expectedVersionHash &&
          options.expectedVersionHash !== source.versionHash
        )
          throw new Error(t("editPanel.shaders.labSourceStale"));
        const written = (await editNative.mutateAsync({
          designId,
          fileId,
          expectedVersionHash: source.versionHash,
          operation,
        })) as {
          content: string;
          instanceIds: string[];
          updatedAt?: string;
        };
        context.onApplied?.(
          fileId,
          written.content,
          written.updatedAt,
          source.content,
        );
        broadcastShaderMessage({ type: "glsl-shader-preview-clear" });
        broadcastShaderMessage({ type: "glsl-shader-rescan" });
        return written;
      });
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("editPanel.shaders.saveFailed"),
      );
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { persistNative, busy };
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
  nativeInstanceId?: string;
  initialView?: "browser" | "current";
  presentation?: "compact" | "popover";
  onBack: (hasShader: boolean) => void;
  disabled?: boolean;
}

export function GlslShaderPanel({
  mode,
  context,
  nativeInstanceId,
  initialView = "current",
  onBack,
  disabled = false,
  presentation = "compact",
}: GlslShaderPanelProps) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const { formatNumber } = useFormatters();
  const [search, setSearch] = useState("");
  const [browsing, setBrowsing] = useState(initialView === "browser");
  const [justAppliedNativeId, setJustAppliedNativeId] = useState<string | null>(
    null,
  );
  const [draftNativeParams, setDraftNativeParams] = useState<Record<
    string,
    EffectValue
  > | null>(null);
  const [labOpen, setLabOpen] = useState(false);
  const [transformOpen, setTransformOpen] = useState(false);
  const [draftNativeInstance, setDraftNativeInstance] = useState<{
    instanceId: string;
    transform: EffectTransform2D | null;
    opacity: number;
  } | null>(null);
  const draftNativeInstanceRef = useRef(draftNativeInstance);
  draftNativeInstanceRef.current = draftNativeInstance;
  const scrubSessionRef = useRef<NativeInstanceScrubSession | null>(null);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [colorCapability, setColorCapability] =
    useState<NativeColorCapability | null>(null);
  const [colorCapabilityUnreadable, setColorCapabilityUnreadable] =
    useState(false);
  const [colorChanging, setColorChanging] = useState(false);
  const [previewStatus, setPreviewStatus] =
    useState<NativePreviewStatus | null>(null);
  const [previewStatusUnreadable, setPreviewStatusUnreadable] = useState(false);
  const [optimisticPreview, setOptimisticPreview] =
    useState<EffectPreviewPolicy | null>(null);
  const [nativeRuntimeStatus, setNativeRuntimeStatus] = useState<{
    status: NativeShaderRuntimeStatus["status"] | "pending";
    backend: NativeShaderRuntimeStatus["backend"];
    code?: string;
    message?: string;
    runtimeEpoch?: string;
  }>({ status: "pending", backend: "unavailable" });
  const screen = useScreenGlslShaders(context);
  const { persist, busy: legacyBusy } = usePersistShaderEdit(context);
  const { persistNative, busy: nativeBusy } =
    usePersistNativeShaderEdit(context);
  const busy = legacyBusy || nativeBusy;
  const storedPreview = screen.nativeEffects.document?.preview;
  const previewPolicy = optimisticPreview ??
    storedPreview ?? {
      quality: "auto" as const,
      frameRateTarget: 60 as const,
    };

  useEffect(() => setOptimisticPreview(null), [screen.content]);

  const nodeId = context.nodeId;
  const selectedNodeIds = context.nodeIds?.length
    ? context.nodeIds
    : nodeId
      ? [nodeId]
      : [];
  const multiTarget = selectedNodeIds.length > 1;
  const modeAttrTitle =
    mode === "effect"
      ? t("editPanel.shaders.effectsTitle")
      : t("editPanel.shaders.fillsTitle");
  const roomy = presentation === "popover";
  const transformControls: {
    field: NativeTransformField;
    label: string;
    min: number;
    max: number;
    step: number;
    unit: string;
  }[] = [
    {
      field: "translateX",
      label: t("editPanel.shaders.nativeTranslateX"),
      min: -100_000,
      max: 100_000,
      step: 0.1,
      unit: "px",
    },
    {
      field: "translateY",
      label: t("editPanel.shaders.nativeTranslateY"),
      min: -100_000,
      max: 100_000,
      step: 0.1,
      unit: "px",
    },
    {
      field: "scaleX",
      label: t("editPanel.shaders.nativeScaleX"),
      min: 0.01,
      max: 10_000,
      step: 0.1,
      unit: "%",
    },
    {
      field: "scaleY",
      label: t("editPanel.shaders.nativeScaleY"),
      min: 0.01,
      max: 10_000,
      step: 0.1,
      unit: "%",
    },
    {
      field: "rotate",
      label: t("editPanel.shaders.nativeRotate"),
      min: -18_000,
      max: 18_000,
      step: 0.1,
      unit: "°",
    },
    {
      field: "originX",
      label: t("editPanel.shaders.nativeOriginX"),
      min: 0,
      max: 100,
      step: 0.1,
      unit: "%",
    },
    {
      field: "originY",
      label: t("editPanel.shaders.nativeOriginY"),
      min: 0,
      max: 100,
      step: 0.1,
      unit: "%",
    },
  ];

  const nodeMount = useMemo(
    () =>
      context.nativeOnly
        ? undefined
        : screen.mounts.find(
            (mount) => mount.nodeId === nodeId && mount.mode === mode,
          ),
    [screen.mounts, nodeId, mode, context.nativeOnly],
  );
  const activeId =
    browsing || context.nativeOnly ? null : (nodeMount?.shaderId ?? null);
  const activeDef = useMemo(
    () => screen.shaders.find((shader) => shader.id === activeId) ?? null,
    [screen.shaders, activeId],
  );
  const nativeInstances = useMemo(
    () =>
      (screen.nativeEffects.document?.instances ?? []).filter(
        (instance) =>
          instance.nodeId === nodeId &&
          (mode === "fill"
            ? instance.placement === "fill"
            : instance.placement !== "fill"),
      ),
    [screen.nativeEffects.document, nodeId, mode],
  );
  const activeNativeInstance = browsing
    ? null
    : (nativeInstances.find(
        (instance) => instance.id === (justAppliedNativeId ?? nativeInstanceId),
      ) ??
      nativeInstances[0] ??
      null);
  const commonNativeInstances = activeNativeInstance
    ? selectedNodeIds.map((selectedNodeId) =>
        (screen.nativeEffects.document?.instances ?? []).find(
          (instance) =>
            instance.nodeId === selectedNodeId &&
            instance.definitionId === activeNativeInstance.definitionId &&
            instance.definitionVersion ===
              activeNativeInstance.definitionVersion &&
            (mode === "fill"
              ? instance.placement === "fill"
              : instance.placement !== "fill"),
        ),
      )
    : [];
  const commonNativeReady =
    commonNativeInstances.length === selectedNodeIds.length &&
    commonNativeInstances.every(Boolean);
  const activeNativeDef =
    activeNativeInstance && commonNativeReady
      ? (screen.nativeEffects.document?.definitions.find(
          (definition) =>
            definition.id === activeNativeInstance.definitionId &&
            definition.version === activeNativeInstance.definitionVersion,
        ) ?? null)
      : null;
  const activeNativeAnimationCapability = activeNativeDef
    ? nativeEffectAnimationCapability(activeNativeDef)
    : "unknown";
  const nativeRuntimeDisplayStatus =
    activeNativeInstance?.enabled === false
      ? "disabled"
      : nativeRuntimeStatus.status;
  const nativeRuntimeDisplayCode =
    activeNativeInstance?.enabled === false
      ? null
      : (nativeRuntimeStatus.code ?? null);
  const nativeRuntimeDetailKey = nativeRuntimeDiagnosticKey(
    nativeRuntimeStatus.code,
  );
  const displayedNativeInstance =
    draftNativeInstance?.instanceId === activeNativeInstance?.id
      ? draftNativeInstance
      : null;
  useEffect(() => {
    draftNativeInstanceRef.current = null;
    setDraftNativeInstance(null);
    const instance = activeNativeInstance;
    const definition = activeNativeDef;
    const runtimeEpoch = nativeRuntimeStatus.runtimeEpoch;
    const fileId = context.fileId;
    if (!instance || !definition || !runtimeEpoch || !fileId || multiTarget)
      return;
    const identity = Promise.all([
      hashEffectDefinition(definition),
      hashEffectInstance(instance),
    ]).then(([baseExecutionHash, baseInstanceSignature]) => ({
      runtimeEpoch,
      instanceId: instance.id,
      nodeId: instance.nodeId,
      baseExecutionHash,
      baseInstanceSignature,
    }));
    let session: NativeInstanceScrubSession;
    session = new NativeInstanceScrubSession(
      identity,
      (message, signal) => {
        const frame = findNativeDraftFrame(fileId, context.boardFile);
        if (!frame.contentWindow) throw new Error("frame-unavailable");
        return sendNativeInstancePreviewMessage({
          targetWindow: frame.contentWindow,
          message,
          signal,
        });
      },
      (_error, type) => {
        if (scrubSessionRef.current !== session) return;
        if (type === "native-effect-set-instance") {
          draftNativeInstanceRef.current = null;
          setDraftNativeInstance(null);
          session.clear();
        }
        toast.error(tRef.current("editPanel.shaders.labRuntimeUnavailable"));
      },
    );
    scrubSessionRef.current = session;
    return () => {
      if (scrubSessionRef.current === session) scrubSessionRef.current = null;
      session.dispose();
    };
  }, [
    activeNativeInstance,
    activeNativeDef,
    nativeRuntimeStatus.runtimeEpoch,
    context.fileId,
    context.boardFile,
    multiTarget,
  ]);
  const mixedNativeProperties = new Set<string>();
  if (multiTarget && activeNativeDef && commonNativeReady) {
    for (const [name, property] of Object.entries(activeNativeDef.properties)) {
      const first = commonNativeInstances[0]?.params[name] ?? property.default;
      if (
        commonNativeInstances.some(
          (instance) =>
            !nativeEffectValuesEqual(
              instance?.params[name] ?? property.default,
              first,
            ),
        )
      )
        mixedNativeProperties.add(name);
    }
  }
  useEffect(() => {
    if (
      !context.designId ||
      !context.fileId ||
      !nodeId ||
      !activeNativeInstance
    ) {
      return;
    }
    const key = designShaderFocusStateKeyForTab(getBrowserTabId());
    const focus = {
      designId: context.designId,
      fileId: context.fileId,
      nodeId,
      instanceId: activeNativeInstance.id,
      definitionId: activeNativeInstance.definitionId,
      definitionVersion: activeNativeInstance.definitionVersion,
      placement: activeNativeInstance.placement,
      labOpen,
      runtime: {
        status: nativeRuntimeDisplayStatus,
        code: nativeRuntimeDisplayCode,
      },
    };
    void setClientAppState(key, focus).catch(console.error);
    return () => {
      void setClientAppState(key, null, { keepalive: true }).catch(
        console.error,
      );
    };
  }, [
    context.designId,
    context.fileId,
    nodeId,
    activeNativeInstance?.id,
    activeNativeInstance?.definitionId,
    activeNativeInstance?.definitionVersion,
    activeNativeInstance?.placement,
    activeNativeInstance?.enabled,
    labOpen,
    nativeRuntimeDisplayStatus,
    nativeRuntimeDisplayCode,
  ]);
  const nativeValues = useMemo(() => {
    if (!activeNativeDef || !activeNativeInstance) return {};
    return {
      ...Object.fromEntries(
        Object.entries(activeNativeDef.properties).map(([name, property]) => [
          name,
          property.default,
        ]),
      ),
      ...activeNativeInstance.params,
      ...(draftNativeParams ?? {}),
    } as Record<string, EffectValue>;
  }, [activeNativeDef, activeNativeInstance, draftNativeParams]);
  useEffect(() => {
    setDraftNativeParams(null);
  }, [screen.content, activeNativeInstance?.id]);
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

  const nativePresetLabel = (definition: EffectDefinition): string => {
    const key = nativeCatalogDefinitionKey(definition);
    return key ? t(key) : definition.name;
  };

  const savedShaders = useMemo(() => {
    if (context.nativeOnly) return [];
    const byMode = screen.shaders.filter((shader) => shader.mode === mode);
    const query = search.trim().toLowerCase();
    if (!query) return byMode;
    return byMode.filter((shader) => shader.name.toLowerCase().includes(query));
  }, [screen.shaders, mode, search, context.nativeOnly]);

  useEffect(() => {
    if (
      !activeNativeInstance ||
      !nodeId ||
      !context.designId ||
      !context.fileId
    )
      return;
    if (!activeNativeInstance.enabled) {
      setNativeRuntimeStatus({ status: "pending", backend: "unavailable" });
      return;
    }
    const instanceId = activeNativeInstance.id;
    const designId = context.designId;
    const fileId = context.fileId;
    const requestId = `native_${Math.random().toString(36).slice(2, 14)}`;
    let pendingTimer: number | null = null;
    const requestStatus = () => {
      setNativeRuntimeStatus({ status: "pending", backend: "unavailable" });
      if (pendingTimer !== null) window.clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(() => {
        setNativeRuntimeStatus((current) =>
          current.status === "pending"
            ? {
                status: "unavailable",
                backend: "unavailable",
                code: "status-unreadable",
              }
            : current,
        );
      }, 5_000);
      window.dispatchEvent(
        new CustomEvent("design-native-shader-status-request", {
          detail: { designId, fileId, nodeId, instanceId, requestId },
        }),
      );
    };
    const onFrameLoad = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (
        detail &&
        typeof detail === "object" &&
        (detail as { designId?: unknown }).designId === designId &&
        (detail as { fileId?: unknown }).fileId === fileId
      )
        requestStatus();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (
        !detail ||
        typeof detail !== "object" ||
        (detail as { designId?: unknown }).designId !== designId ||
        (detail as { fileId?: unknown }).fileId !== fileId
      )
        return;
      const status = readNativeShaderRuntimeStatus(detail);
      if (
        !status ||
        status.instanceId !== instanceId ||
        status.nodeId !== nodeId
      )
        return;
      if (pendingTimer !== null) window.clearTimeout(pendingTimer);
      pendingTimer = null;
      setNativeRuntimeStatus({
        status: status.status,
        backend: status.backend,
        code: status.code,
        message: status.message,
        runtimeEpoch: status.runtimeEpoch,
      });
    };
    window.addEventListener("design-native-shader-frame-load", onFrameLoad);
    window.addEventListener("design-native-shader-status", onStatus);
    requestStatus();
    return () => {
      if (pendingTimer !== null) window.clearTimeout(pendingTimer);
      window.removeEventListener(
        "design-native-shader-frame-load",
        onFrameLoad,
      );
      window.removeEventListener("design-native-shader-status", onStatus);
    };
  }, [
    activeNativeInstance?.id,
    activeNativeInstance?.enabled,
    context.designId,
    context.fileId,
    nodeId,
  ]);

  useEffect(() => {
    if (
      !activeNativeInstance ||
      !activeNativeInstance.enabled ||
      !context.fileId ||
      nativeRuntimeStatus.status !== "ready"
    ) {
      setColorCapability(null);
      setColorCapabilityUnreadable(false);
      return;
    }
    try {
      setColorCapability(
        readNativeColorCapability(
          findNativeDraftFrame(context.fileId, context.boardFile),
        ),
      );
      setColorCapabilityUnreadable(false);
    } catch {
      setColorCapability(null);
      setColorCapabilityUnreadable(true);
    }
  }, [
    activeNativeInstance?.id,
    activeNativeInstance?.enabled,
    context.fileId,
    context.boardFile,
    nativeRuntimeStatus.runtimeEpoch,
    nativeRuntimeStatus.status,
  ]);

  useEffect(() => {
    if (
      !activeNativeInstance ||
      !activeNativeInstance.enabled ||
      !context.fileId ||
      nativeRuntimeStatus.status !== "ready"
    ) {
      setPreviewStatus(null);
      setPreviewStatusUnreadable(false);
      return;
    }
    const fileId = context.fileId;
    const read = () => {
      try {
        setPreviewStatus(readSelectedNativePreviewStatus(fileId));
        setPreviewStatusUnreadable(false);
      } catch {
        setPreviewStatus(null);
        setPreviewStatusUnreadable(true);
      }
    };
    read();
    const timer = window.setInterval(read, 2_000);
    return () => window.clearInterval(timer);
  }, [
    activeNativeInstance?.id,
    activeNativeInstance?.enabled,
    context.fileId,
    nativeRuntimeStatus.runtimeEpoch,
    nativeRuntimeStatus.status,
  ]);

  const changePreviewPolicy = async (next: EffectPreviewPolicy) => {
    setOptimisticPreview(next);
    if (!(await persistNative({ kind: "set-preview", preview: next })))
      setOptimisticPreview(null);
  };

  const changeNativeColorMode = async (mode: NativeColorMode) => {
    if (!context.fileId) return;
    setColorChanging(true);
    try {
      await changePreviewPolicy({ ...previewPolicy, colorMode: mode });
    } finally {
      setColorChanging(false);
    }
  };

  const changeNativeDynamicRange = async (mode: NativeDynamicRangeMode) => {
    if (!context.fileId) return;
    setColorChanging(true);
    try {
      await changePreviewPolicy({ ...previewPolicy, dynamicRange: mode });
    } finally {
      setColorChanging(false);
    }
  };

  const applyNativeCatalog = async (
    definitionId: string,
    definitionVersion: number,
    placement: EffectInstance["placement"],
    preset?: EffectPreset,
  ): Promise<boolean> => {
    if (!nodeId) {
      toast.error(t("editPanel.shaders.selectCanvasElementFirst"));
      return false;
    }
    const selectedPreset = preset
      ? NATIVE_EFFECT_PRESETS.find(
          (candidate) =>
            candidate.id === preset.id &&
            candidate.definitionId === definitionId &&
            candidate.definitionVersion === definitionVersion &&
            candidate.placement === placement &&
            JSON.stringify(candidate) === JSON.stringify(preset),
        )
      : null;
    if (preset && !selectedPreset) {
      toast.error(t("editPanel.shaders.libraryUnavailable"));
      return false;
    }
    const definition = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (candidate) =>
        candidate.id === definitionId &&
        candidate.version === definitionVersion,
    );
    if (!definition) {
      toast.error(t("editPanel.shaders.libraryUnavailable"));
      return false;
    }
    let sourceSizing;
    try {
      sourceSizing = nativeApplySourceSizing({
        definition,
        presetSizing: selectedPreset?.sourceSizing,
        fileId: context.fileId ?? "",
        boardFile: context.boardFile ?? false,
        nodeIds: multiTarget ? selectedNodeIds : [nodeId],
      });
    } catch (error) {
      if (!(error instanceof NativeIntrinsicSourceClientError)) throw error;
      toast.error(t("editPanel.shaders.intrinsicImageRequired"));
      return false;
    }
    const beforeIds = new Set(nativeInstances.map((instance) => instance.id));
    const result = await persistNative(
      multiTarget
        ? {
            kind: "apply-many",
            nodeIds: selectedNodeIds,
            placement,
            definitionId,
            definitionVersion,
            params: selectedPreset?.params,
            clip: selectedPreset?.clip,
            bindings: selectedPreset?.bindings,
            transform: selectedPreset?.transform,
            timing: selectedPreset?.timing,
            ...sourceSizing,
          }
        : selectedPreset
          ? {
              kind: "apply-preset",
              nodeId,
              presetId: selectedPreset.id,
              sourceSizing: sourceSizing.sourceSizing,
            }
          : {
              kind: "apply",
              nodeId,
              placement,
              definitionId,
              definitionVersion,
              sourceSizing: sourceSizing.sourceSizing,
            },
    );
    if (result) {
      const after = parseEffectsFromHtml(result.content);
      const newInstanceId =
        after.document?.instances.find(
          (instance) =>
            instance.nodeId === nodeId &&
            instance.definitionId === definitionId &&
            instance.definitionVersion === definitionVersion &&
            !beforeIds.has(instance.id),
        )?.id ?? null;
      setJustAppliedNativeId(newInstanceId);
      setBrowsing(false);
      setDraftNativeParams(null);
      void screen.refetch();
      return true;
    }
    return false;
  };

  const applySavedLibrary = async (
    definition: EffectDefinition,
    preset: EffectPreset,
  ): Promise<boolean> => {
    if (!nodeId) return false;
    let sourceSizing;
    try {
      sourceSizing = nativeApplySourceSizing({
        definition,
        presetSizing: preset.sourceSizing,
        fileId: context.fileId ?? "",
        boardFile: context.boardFile ?? false,
        nodeIds: multiTarget ? selectedNodeIds : [nodeId],
      });
    } catch (error) {
      if (!(error instanceof NativeIntrinsicSourceClientError)) throw error;
      toast.error(t("editPanel.shaders.intrinsicImageRequired"));
      return false;
    }
    const result = await persistNative(
      multiTarget
        ? {
            kind: "apply-many",
            nodeIds: selectedNodeIds,
            placement: preset.placement,
            definition,
            params: preset.params,
            clip: preset.clip,
            bindings: preset.bindings,
            transform: preset.transform,
            timing: preset.timing,
            ...sourceSizing,
          }
        : {
            kind: "apply",
            nodeId,
            placement: preset.placement,
            definition,
            params: preset.params,
            clip: preset.clip,
            bindings: preset.bindings,
            transform: preset.transform,
            timing: preset.timing,
            sourceSizing: sourceSizing.sourceSizing,
          },
    );
    if (!result) return false;
    const after = parseEffectsFromHtml(result.content);
    const instance = after.document?.instances.find(
      (candidate) =>
        candidate.nodeId === nodeId &&
        candidate.definitionId === definition.id &&
        candidate.definitionVersion === definition.version,
    );
    setJustAppliedNativeId(instance?.id ?? null);
    setBrowsing(false);
    setDraftNativeParams(null);
    void screen.refetch();
    return true;
  };

  const registerActiveNativeEffect = async () => {
    if (
      !context.designId ||
      !context.fileId ||
      !activeNativeInstance ||
      !activeNativeDef
    )
      return;
    setLibrarySaving(true);
    try {
      const source = await callAction<SourceFileResult>(
        "read-source-file",
        { designId: context.designId, fileId: context.fileId },
        { method: "GET" },
      );
      if (!source.versionHash)
        throw new Error(t("editPanel.shaders.libraryUnavailable"));
      await callAction("edit-native-shader-library", {
        operation: {
          kind: "register",
          designId: context.designId,
          fileId: context.fileId,
          expectedVersionHash: source.versionHash,
          instanceId: activeNativeInstance.id,
          name: activeNativeDef.name,
        },
      });
      toast.success(t("editPanel.shaders.librarySaved"));
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("editPanel.shaders.libraryUnavailable"),
      );
    } finally {
      setLibrarySaving(false);
    }
  };

  const removeNativeInstance = async (instanceId: string) => {
    const result = await persistNative({ kind: "remove", instanceId });
    if (result) {
      setJustAppliedNativeId(null);
      setDraftNativeParams(null);
      setBrowsing(true);
      void screen.refetch();
    }
  };

  const changeNativeParam = (
    name: string,
    value: EffectValue,
    phase: ScrubInputChangeMeta["phase"],
  ) => {
    if (!activeNativeInstance) return;
    setDraftNativeParams((current) => ({ ...current, [name]: value }));
    for (const instance of commonNativeInstances) {
      if (!instance) continue;
      broadcastShaderMessage({
        type: "native-effect-set-param",
        instanceId: instance.id,
        name,
        value,
      });
    }
    if (phase === "commit") {
      void persistNative(
        multiTarget
          ? {
              kind: "set-params-many",
              instanceIds: commonNativeInstances.flatMap((instance) =>
                instance ? [instance.id] : [],
              ),
              params: { [name]: value },
            }
          : {
              kind: "set-params",
              instanceId: activeNativeInstance.id,
              params: { [name]: value },
            },
      ).then((result) => {
        if (result) {
          void screen.refetch();
        } else {
          setDraftNativeParams((current) => {
            if (!current || !(name in current)) return current;
            const next = { ...current };
            delete next[name];
            return Object.keys(next).length ? next : null;
          });
        }
      });
    }
  };

  const changeNativeInstance = (
    patch: Partial<
      Omit<
        EffectInstance,
        "id" | "nodeId" | "definitionId" | "definitionVersion"
      >
    >,
  ) => {
    if (!activeNativeInstance) return;
    const operation: NativeEffectEdit =
      patch.timing !== undefined
        ? {
            kind: "playback",
            instanceId: activeNativeInstance.id,
            ...patch.timing,
          }
        : {
            kind: "set-instance",
            instanceId: activeNativeInstance.id,
            enabled: patch.enabled,
            opacity: patch.opacity,
            seed: patch.seed,
            clip: patch.clip,
            placement: patch.placement,
            transform: patch.transform,
          };
    void persistNative(operation).then((result) => {
      if (result) void screen.refetch();
    });
  };

  const changeNativeTransform = (
    field: NativeTransformField,
    displayValue: number,
    phase: ScrubInputChangeMeta["phase"],
  ) => {
    if (!activeNativeInstance) return;
    if (phase === "cancel") {
      draftNativeInstanceRef.current = null;
      setDraftNativeInstance(null);
      scrubSessionRef.current?.clear();
      return;
    }
    const current =
      draftNativeInstanceRef.current?.instanceId === activeNativeInstance.id
        ? draftNativeInstanceRef.current
        : null;
    let transform: EffectTransform2D;
    try {
      transform = updateNativeTransform(
        current?.transform ?? activeNativeInstance.transform,
        field,
        displayValue,
      );
    } catch {
      toast.error(t("editPanel.shaders.nativeTransformInvalid"));
      return;
    }
    scrubNativeInstance(
      { transform, opacity: current?.opacity ?? activeNativeInstance.opacity },
      phase,
    );
  };

  const scrubNativeInstance = (
    patch: { transform: EffectTransform2D | null; opacity: number },
    phase: ScrubInputChangeMeta["phase"],
  ) => {
    if (!activeNativeInstance) return;
    const draft = { instanceId: activeNativeInstance.id, ...patch };
    draftNativeInstanceRef.current = draft;
    setDraftNativeInstance(draft);
    scrubSessionRef.current?.preview(patch);
    if (phase !== "commit") return;
    const session = scrubSessionRef.current;
    void persistNative({
      kind: "set-instance",
      instanceId: activeNativeInstance.id,
      transform: patch.transform,
      opacity: patch.opacity,
    }).then(async (result) => {
      try {
        if (result) await screen.refetch();
      } finally {
        if (session === scrubSessionRef.current) {
          session?.clear();
          draftNativeInstanceRef.current = null;
          setDraftNativeInstance(null);
        }
      }
    });
  };

  const scrubNativeOpacity = (
    value: number,
    phase: ScrubInputChangeMeta["phase"],
  ) => {
    if (!activeNativeInstance) return;
    if (phase === "cancel") {
      draftNativeInstanceRef.current = null;
      setDraftNativeInstance(null);
      scrubSessionRef.current?.clear();
      return;
    }
    const current =
      draftNativeInstanceRef.current?.instanceId === activeNativeInstance.id
        ? draftNativeInstanceRef.current
        : null;
    scrubNativeInstance(
      {
        transform: current?.transform ?? activeNativeInstance.transform ?? null,
        opacity: value / 100,
      },
      phase,
    );
  };

  const resetNativeTransform = () => {
    if (!activeNativeInstance) return;
    draftNativeInstanceRef.current = null;
    setDraftNativeInstance(null);
    void persistNative({
      kind: "set-instance",
      instanceId: activeNativeInstance.id,
      transform: null,
    }).then((result) => {
      if (result) void screen.refetch();
      scrubSessionRef.current?.clear();
    });
  };

  const changeNativePlayback = (command: "toggle" | "reset") => {
    if (!activeNativeInstance || !context.fileId) return;
    try {
      const frame = findNativeDraftFrame(context.fileId, context.boardFile);
      const clock = readNativeInstancePlaybackState(
        frame,
        activeNativeInstance.id,
      );
      const operation: NativeEffectEdit = {
        kind: "playback",
        instanceId: activeNativeInstance.id,
        paused:
          command === "toggle" ? !clock.instancePaused : clock.instancePaused,
        time: command === "reset" ? 0 : clock.instanceLocalTimeSeconds,
        ...(command === "reset"
          ? {
              seekRevision: (activeNativeInstance.timing.seekRevision ?? 0) + 1,
            }
          : {}),
      };
      void persistNative(operation).then((result) => {
        if (result) void screen.refetch();
      });
    } catch {
      toast.error(t("editPanel.shaders.nativePlaybackUnavailable"));
    }
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
      setBrowsing(true);
      setDraftValues(null);
      void screen.refetch();
    }
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

  if (
    activeNativeDef &&
    activeNativeInstance &&
    (!activeDef || justAppliedNativeId || nativeInstanceId)
  ) {
    return (
      <div className="flex flex-col">
        <div className="flex h-7 items-center gap-1.5 px-3">
          <button
            type="button"
            aria-label={t("editPanel.shaders.backToBrowser")}
            onClick={() => {
              setBrowsing(true);
              setJustAppliedNativeId(null);
              setDraftNativeParams(null);
            }}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconArrowLeft className="size-3.5" />
          </button>
          <span className="min-w-0 flex-1 truncate !text-[11px] font-semibold text-foreground">
            {nativePresetLabel(activeNativeDef)}
          </span>
          {!multiTarget && (
            <button
              type="button"
              aria-label={t("editPanel.shaders.labOpen")}
              disabled={disabled || busy}
              onClick={() => setLabOpen(true)}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <IconCode className="size-3.5" />
            </button>
          )}
          {!multiTarget && (
            <button
              type="button"
              aria-label={t("editPanel.shaders.librarySave")}
              disabled={disabled || busy || librarySaving}
              onClick={() => void registerActiveNativeEffect()}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <IconBookmark className="size-3.5" />
            </button>
          )}
          {!multiTarget && (
            <button
              type="button"
              aria-label={t("editPanel.shaders.removeShader")}
              disabled={disabled || busy}
              onClick={() => void removeNativeInstance(activeNativeInstance.id)}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <IconTrash className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label={t("editPanel.shaders.closePanel")}
            onClick={() => onBack(true)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconX className="size-3.5" />
          </button>
        </div>
        <div className="grid gap-2 border-t border-border/70 p-2">
          {context.designId && context.fileId && (
            <NativeEffectApproval
              designId={context.designId}
              fileId={context.fileId}
              definition={activeNativeDef}
            />
          )}
          {!multiTarget && (
            <p
              role={
                nativeRuntimeDisplayStatus === "error" ||
                nativeRuntimeDisplayStatus === "last-good"
                  ? "alert"
                  : "status"
              }
              data-native-runtime-status={nativeRuntimeDisplayStatus}
              className={cn(
                "text-xs",
                nativeRuntimeDisplayStatus === "error" ||
                  nativeRuntimeDisplayStatus === "last-good"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {t(
                nativeRuntimeDisplayStatus === "disabled"
                  ? "editPanel.interactionStates.disabled"
                  : nativeRuntimeDisplayStatus === "ready"
                    ? "editPanel.shaders.nativeRuntimeReady"
                    : nativeRuntimeDisplayStatus === "last-good"
                      ? "editPanel.shaders.nativeRuntimeLastGood"
                      : nativeRuntimeDisplayStatus === "error"
                        ? "editPanel.shaders.nativeRuntimeError"
                        : nativeRuntimeDisplayStatus === "unavailable"
                          ? "editPanel.shaders.nativeRuntimeUnavailable"
                          : "editPanel.shaders.nativeRuntimePending",
              )}
              {nativeRuntimeDisplayCode ? ` · ${nativeRuntimeDisplayCode}` : ""}
              {nativeRuntimeDisplayStatus !== "disabled" &&
              nativeRuntimeDetailKey
                ? ` — ${t(nativeRuntimeDetailKey)}`
                : nativeRuntimeDisplayStatus !== "disabled" &&
                    nativeRuntimeStatus.message &&
                    nativeRuntimeStatus.message !== nativeRuntimeStatus.code
                  ? ` — ${nativeRuntimeStatus.message}`
                  : ""}
            </p>
          )}
          {!multiTarget && activeNativeDef.placements.length > 1 && (
            <label className="flex items-center justify-between gap-2 text-xs">
              <span>{t("editPanel.shaders.placement")}</span>
              <Select
                value={activeNativeInstance.placement}
                disabled={disabled || busy}
                onValueChange={(value) =>
                  changeNativeInstance({
                    placement: value as EffectInstance["placement"],
                  })
                }
              >
                <SelectTrigger className="h-6 w-28 !text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeNativeDef.placements.map((placement) => (
                    <SelectItem key={placement} value={placement}>
                      {t(
                        `editPanel.shaders.placement${placement[0].toUpperCase()}${placement.slice(1)}` as "editPanel.shaders.placementFill",
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {!multiTarget && (
            <div className="grid gap-1 text-xs">
              <label className="flex items-center justify-between gap-2">
                <span>{t("editPanel.shaders.nativeOutputColor")}</span>
                <Select
                  value={previewPolicy.colorMode ?? "srgb"}
                  disabled={
                    disabled || busy || colorChanging || !colorCapability
                  }
                  onValueChange={(value) =>
                    void changeNativeColorMode(value as NativeColorMode)
                  }
                >
                  <SelectTrigger className="h-6 w-28 !text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="srgb">sRGB</SelectItem>
                    <SelectItem value="display-p3">
                      {t("editPanel.shaders.nativeColorP3")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
              {colorCapability?.requestedDynamicRange !== undefined && (
                <label className="flex items-center justify-between gap-2">
                  <span>{t("editPanel.shaders.nativeDynamicRange")}</span>
                  <Select
                    value={previewPolicy.dynamicRange ?? "sdr"}
                    disabled={disabled || busy || colorChanging}
                    onValueChange={(value) =>
                      void changeNativeDynamicRange(
                        value as NativeDynamicRangeMode,
                      )
                    }
                  >
                    <SelectTrigger className="h-6 w-28 !text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sdr">
                        {t("editPanel.shaders.nativeDynamicRangeSdr")}
                      </SelectItem>
                      <SelectItem value="hdr">
                        {t("editPanel.shaders.nativeDynamicRangeHdr")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              )}
              {colorCapability && (
                <p className="text-[11px] text-muted-foreground">
                  {colorCapability.requested !== colorCapability.presented
                    ? t("editPanel.shaders.nativeColorFallback")
                    : t("editPanel.shaders.nativeColorSourceLimit")}
                  {" · "}
                  {colorCapability.presentedDynamicRange === "hdr"
                    ? t("editPanel.shaders.nativeHdrConfigured")
                    : colorCapability.requestedDynamicRange === "hdr"
                      ? t("editPanel.shaders.nativeHdrFallback")
                      : colorCapability.requestedDynamicRange === "sdr"
                        ? t("editPanel.shaders.nativeSdrOutput")
                        : t("editPanel.shaders.nativeHdrUnavailable")}
                  {" · "}
                  {colorCapability.displayDynamicRangeCapability ===
                  "high-capable"
                    ? colorCapability.presentedDynamicRange === "hdr"
                      ? t("editPanel.shaders.nativeDisplayHighCapableHdr")
                      : t("editPanel.shaders.nativeDisplayHighCapable")
                    : colorCapability.displayDynamicRangeCapability ===
                        "standard-only"
                      ? t("editPanel.shaders.nativeDisplayStandardOnly")
                      : t("editPanel.shaders.nativeDisplayRangeUnreadable")}
                  {colorCapability.presentedDynamicRange !== "hdr" && (
                    <>
                      {" · "}
                      {colorCapability.canvasToneMappingStandard === "observed"
                        ? t(
                            "editPanel.shaders.nativeStandardToneMappingObserved",
                          )
                        : t("editPanel.shaders.nativeToneMappingUnreadable")}
                    </>
                  )}
                </p>
              )}
              {colorCapabilityUnreadable && (
                <p className="text-[11px] text-destructive">
                  {t("editPanel.shaders.nativeColorModeUnavailable")}
                </p>
              )}
            </div>
          )}
          <div className="grid gap-1 text-xs">
            <label className="flex items-center justify-between gap-2">
              <span>{t("editPanel.shaders.nativePreviewPolicy")}</span>
              <Select
                value={previewPolicy.quality}
                disabled={disabled || busy}
                onValueChange={(quality) => {
                  if (
                    quality !== "auto" &&
                    quality !== "performance" &&
                    quality !== "quality"
                  ) {
                    toast.error(
                      t("editPanel.shaders.nativePreviewStatusUnreadable"),
                    );
                    return;
                  }
                  void changePreviewPolicy({ ...previewPolicy, quality });
                }}
              >
                <SelectTrigger className="h-6 w-28 !text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    {t("editPanel.shaders.nativePreviewAuto")}
                  </SelectItem>
                  <SelectItem value="performance">
                    {t("editPanel.shaders.nativePreviewPerformance")}
                  </SelectItem>
                  <SelectItem value="quality">
                    {t("editPanel.shaders.nativePreviewQuality")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center justify-between gap-2">
              <span>{t("editPanel.shaders.nativePreviewTarget")}</span>
              <Select
                value={String(previewPolicy.frameRateTarget)}
                disabled={disabled || busy}
                onValueChange={(value) => {
                  if (value !== "60" && value !== "120") {
                    toast.error(
                      t("editPanel.shaders.nativePreviewStatusUnreadable"),
                    );
                    return;
                  }
                  void changePreviewPolicy({
                    ...previewPolicy,
                    frameRateTarget: value === "120" ? 120 : 60,
                  });
                }}
              >
                <SelectTrigger className="h-6 w-28 !text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">60</SelectItem>
                  <SelectItem value="120">120</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {previewStatus && (
              <p className="text-[11px] text-muted-foreground">
                {t("editPanel.shaders.nativePreviewActualResolution", {
                  ratio: formatNumber(
                    Math.round(previewStatus.effectivePixelRatio * 10) / 10,
                  ),
                  dpr: formatNumber(previewStatus.devicePixelRatio),
                })}
                {previewStatus.rafIntervalMs !== undefined && (
                  <>
                    {" · "}
                    {t("editPanel.shaders.nativePreviewObservedCadence", {
                      ms: formatNumber(
                        Math.round(previewStatus.rafIntervalMs * 10) / 10,
                      ),
                    })}
                  </>
                )}
                {previewStatus.renderWallMs !== undefined && (
                  <>
                    {" · "}
                    {t("editPanel.shaders.nativePreviewRenderWall", {
                      ms: formatNumber(
                        Math.round(previewStatus.renderWallMs * 10) / 10,
                      ),
                    })}
                  </>
                )}
              </p>
            )}
            {previewStatusUnreadable && (
              <p className="text-[11px] text-destructive">
                {t("editPanel.shaders.nativePreviewStatusUnreadable")}
              </p>
            )}
          </div>
          {!multiTarget && (
            <>
              <label className="flex h-7 items-center justify-between gap-2 text-xs">
                <span>{t("editPanel.shaders.enabled")}</span>
                <Switch
                  checked={activeNativeInstance.enabled}
                  disabled={disabled || busy}
                  onCheckedChange={(enabled) =>
                    changeNativeInstance({ enabled })
                  }
                />
              </label>
              <ScrubInput
                label={t("editPanel.labels.opacity")}
                value={Math.round(
                  (displayedNativeInstance?.opacity ??
                    activeNativeInstance.opacity) * 100,
                )}
                min={0}
                max={100}
                step={1}
                unit="%"
                disabled={disabled || busy}
                onChange={(value, meta) =>
                  scrubNativeOpacity(value, meta.phase)
                }
                labelClassName="w-20"
                inputClassName="h-6"
              />
              {activeNativeAnimationCapability !== "static" && (
                <ScrubInput
                  label={t("editPanel.shaders.speed")}
                  value={activeNativeInstance.timing.speed}
                  min={0}
                  max={4}
                  step={0.01}
                  disabled={disabled || busy}
                  onChange={(value, meta) => {
                    if (meta.phase === "commit")
                      changeNativeInstance({
                        timing: {
                          ...activeNativeInstance.timing,
                          speed: value,
                        },
                      });
                  }}
                  labelClassName="w-20"
                  inputClassName="h-6"
                />
              )}
              <ScrubInput
                label={t("editPanel.shaders.seed")}
                value={activeNativeInstance.seed}
                min={0}
                max={1_000_000}
                step={1}
                disabled={disabled || busy}
                onChange={(value, meta) => {
                  if (meta.phase === "commit")
                    changeNativeInstance({ seed: Math.round(value) });
                }}
                labelClassName="w-20"
                inputClassName="h-6"
              />
              {activeNativeAnimationCapability !== "static" && (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={disabled || busy}
                    onClick={() => changeNativePlayback("toggle")}
                  >
                    {t(
                      activeNativeInstance.timing.paused
                        ? "designEditor.motion.play"
                        : "designEditor.motion.pause",
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={disabled || busy}
                    onClick={() => changeNativePlayback("reset")}
                  >
                    {t("designEditor.motion.resetPlayhead")}
                  </Button>
                </div>
              )}
            </>
          )}
          {!multiTarget && (
            <Collapsible open={transformOpen} onOpenChange={setTransformOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground"
                  aria-label={t("editPanel.shaders.nativeTransform")}
                >
                  <span>{t("editPanel.shaders.nativeTransform")}</span>
                  <IconChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      transformOpen && "rotate-180",
                    )}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent
                className="grid gap-1 pt-2"
                data-native-transform-controls
              >
                {transformControls.map(
                  ({ field, label, min, max, step, unit }) => (
                    <ScrubInput
                      key={field}
                      label={label}
                      value={nativeTransformDisplayValue(
                        displayedNativeInstance?.transform ??
                          activeNativeInstance.transform,
                        field,
                      )}
                      min={min}
                      max={max}
                      step={step}
                      unit={unit}
                      disabled={disabled || busy}
                      onChange={(value, meta) => {
                        changeNativeTransform(field, value, meta.phase);
                      }}
                      labelClassName="w-20"
                      inputClassName="h-6"
                    />
                  ),
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 justify-start px-0 text-[11px]"
                  disabled={disabled || busy || !activeNativeInstance.transform}
                  onClick={resetNativeTransform}
                >
                  {t("editPanel.shaders.nativeResetTransform")}
                </Button>
              </CollapsibleContent>
            </Collapsible>
          )}
          <NativeEffectControls
            designId={context.designId}
            fileId={context.fileId}
            key={`${context.fileId}:${activeNativeInstance.id}`}
            definition={activeNativeDef}
            values={nativeValues}
            mixedNames={mixedNativeProperties}
            disabled={disabled || busy}
            onValueChange={changeNativeParam}
          />
        </div>
        {!multiTarget &&
          labOpen &&
          context.designId &&
          context.fileId &&
          nodeId && (
            <Suspense fallback={null}>
              <NativeShaderLab
                open={labOpen}
                onOpenChange={setLabOpen}
                designId={context.designId}
                fileId={context.fileId}
                nodeId={nodeId}
                instanceId={activeNativeInstance.id}
                runtimeEpoch={nativeRuntimeStatus.runtimeEpoch}
                onApply={async (operation, expectedVersionHash) => {
                  const result = await persistNative(operation, {
                    expectedVersionHash,
                  });
                  if (!result) return false;
                  void screen.refetch();
                  return true;
                }}
              />
            </Suspense>
          )}
      </div>
    );
  }

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
            onClick={() => onBack(Boolean(nodeMount || nativeInstances.length))}
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
        <NativeShaderLibraryBrowser
          mode={mode}
          search={search}
          disabled={disabled || busy}
          nodeId={nodeId}
          designId={context.designId}
          fileId={context.fileId}
          onApplyBuiltin={applyNativeCatalog}
          onApplySaved={applySavedLibrary}
        />

        {!context.nativeOnly && savedShaders.length > 0 && (
          <section className="mb-3">
            <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground">
              {t("editPanel.shaders.createdByYou")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {savedShaders.map((shader) => (
                <div
                  key={shader.id}
                  className="flex flex-col gap-1"
                  title={t("editPanel.shaders.legacyDescriptorOnly")}
                >
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-border/60 bg-[var(--design-editor-control-bg)]">
                    <IconWaveSine className="size-4 text-muted-foreground" />
                  </div>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {shader.name}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
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
  const [nativePopoverId, setNativePopoverId] = useState<string | null>(null);
  const screen = useScreenGlslShaders(context);
  const { persist, busy } = usePersistShaderEdit(context);
  const { persistNative, busy: nativeBusy } =
    usePersistNativeShaderEdit(context);
  const nodeId = context.nodeId;
  const selectedNodeIds = context.nodeIds?.length
    ? context.nodeIds
    : nodeId
      ? [nodeId]
      : [];
  const multiTarget = selectedNodeIds.length > 1;
  const nativeEffects = (screen.nativeEffects.document?.instances ?? []).filter(
    (instance) =>
      instance.nodeId === nodeId &&
      instance.placement !== "fill" &&
      selectedNodeIds.every((selectedNodeId) =>
        screen.nativeEffects.document?.instances.some(
          (candidate) =>
            candidate.nodeId === selectedNodeId &&
            candidate.placement === instance.placement &&
            candidate.definitionId === instance.definitionId &&
            candidate.definitionVersion === instance.definitionVersion,
        ),
      ),
  );

  const effectMount = useMemo(
    () =>
      !multiTarget &&
      screen.mounts.find(
        (mount) => mount.nodeId === nodeId && mount.mode === "effect",
      ),
    [screen.mounts, nodeId, multiTarget],
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

  const removeNativeEffect = (instanceId: string) => {
    setNativePopoverId(null);
    void persistNative({ kind: "remove", instanceId }).then((result) => {
      if (result) void screen.refetch();
    });
  };

  if (!effectMount && nativeEffects.length === 0 && !pickerOpen) return null;

  return (
    <>
      {nativeEffects.map((instance) => {
        const definition = screen.nativeEffects.document?.definitions.find(
          (candidate) =>
            candidate.id === instance.definitionId &&
            candidate.version === instance.definitionVersion,
        );
        if (!definition) return null;
        const labelKey = nativeCatalogDefinitionKey(definition);
        const displayName = labelKey ? t(labelKey) : definition.name;
        return (
          <Popover
            key={instance.id}
            open={nativePopoverId === instance.id}
            onOpenChange={(open) =>
              setNativePopoverId(open ? instance.id : null)
            }
          >
            <InspectorPaintRow>
              <InspectorGridCell span={20}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                  >
                    <IconWaveSine className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {displayName}
                    </span>
                  </button>
                </PopoverTrigger>
              </InspectorGridCell>
              <InspectorGridCell span={4} className="flex justify-center">
                <SectionIconButton
                  label={t("editPanel.shaders.enabled")}
                  disabled
                  className="disabled:opacity-100"
                >
                  <IconEye className="size-3.5" />
                </SectionIconButton>
              </InspectorGridCell>
              <InspectorGridCell span={4} className="flex justify-center">
                <SectionIconButton
                  label={t("editPanel.shaders.removeShaderEffect")}
                  disabled={disabled || busy || nativeBusy || multiTarget}
                  onClick={() => removeNativeEffect(instance.id)}
                >
                  <IconMinus className="size-3.5" />
                </SectionIconButton>
              </InspectorGridCell>
            </InspectorPaintRow>
            <InspectorControlPopoverContent
              title={displayName}
              icon={<IconWaveSine className="size-3.5" />}
              onClose={() => setNativePopoverId(null)}
            >
              <GlslShaderPanel
                mode="effect"
                context={context}
                nativeInstanceId={instance.id}
                disabled={disabled}
                presentation="popover"
                onBack={() => setNativePopoverId(null)}
              />
            </InspectorControlPopoverContent>
          </Popover>
        );
      })}
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

      {pickerOpen ? (
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
              initialView="browser"
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
