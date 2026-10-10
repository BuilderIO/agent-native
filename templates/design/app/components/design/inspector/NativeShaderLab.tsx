import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  NativeDraftPreviewDiagnostic,
  NativeDraftPreviewResult,
} from "@shared/native-draft-preview-contract";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import type {
  EffectDefinition,
  EffectInstance,
  EffectValue,
} from "@shared/native-effects";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

import {
  nativeLabApplyOperation,
  type NativeLabApplyOperation,
} from "./native-lab-apply-operation";
import {
  readNativeLabGpuProfileFromFrame,
  type NativeLabGpuProfile,
} from "./native-lab-gpu-profile";
import {
  findNativeDraftFrame,
  NativeDraftClientError,
  sendNativeDraftMessage,
} from "./native-shader-draft-client";
import { NativeShaderDraftScheduler } from "./native-shader-draft-scheduler";
import {
  NativeEffectControls,
  nativeEffectValuesEqual,
} from "./NativeEffectControls";

function WgslEditor({
  value,
  onChange,
  diagnostics,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  diagnostics: NativeDraftPreviewDiagnostic[];
  readOnly?: boolean;
}) {
  const t = useT();
  const [Editor, setEditor] = useState<
    (typeof import("./NativeShaderWgslEditor"))["NativeShaderWgslEditor"] | null
  >(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void import("./NativeShaderWgslEditor").then(
      (module) => {
        if (current) setEditor(() => module.NativeShaderWgslEditor);
      },
      () => {
        if (current) setLoadFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  if (loadFailed)
    return (
      <div role="alert" className="grid gap-2 p-3 text-xs text-destructive">
        <span>{t("editPanel.shaders.labEditorUnavailable")}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setLoadFailed(false);
            setAttempt((current) => current + 1);
          }}
        >
          {t("editPanel.shaders.labRetryEditor")}
        </Button>
      </div>
    );
  if (!Editor)
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  return (
    <Editor
      value={value}
      onChange={onChange}
      diagnostics={diagnostics}
      readOnly={readOnly}
    />
  );
}

interface NativeShaderRead {
  versionHash: string | null;
  path: string | null;
  selectedDefinition: EffectDefinition | null;
  document: {
    definitions: Array<{ id: string; version: number }>;
    instances: EffectInstance[];
  } | null;
}

interface NativeShaderValidation {
  cpuValid: boolean;
  errors: string[];
  gpuCompiled: false;
}

interface LabBase {
  definition: EffectDefinition;
  instance: EffectInstance;
  boardFile: boolean;
  sourceVersionHash: string;
  baseExecutionHash: string;
  nextVersion: number;
  sharedInstanceIds: string[];
}

interface LabPreviewTaskResult {
  cpuErrors: string[];
  preview: NativeDraftPreviewResult | null;
}

function draftValues(
  definition: EffectDefinition,
  instance: EffectInstance,
  changed: Record<string, EffectValue>,
): Record<string, EffectValue> {
  return {
    ...Object.fromEntries(
      Object.entries(definition.properties).map(([name, property]) => [
        name,
        property.default,
      ]),
    ),
    ...instance.params,
    ...changed,
  };
}

function draftDefinition(
  base: LabBase,
  sources: Record<string, string>,
): EffectDefinition {
  return {
    ...base.definition,
    version: base.nextVersion,
    provenance: { origin: "user-authored" },
    passes: base.definition.passes.map((pass) => ({
      ...pass,
      wgsl: sources[pass.id] ?? pass.wgsl,
    })),
  };
}

function errorDiagnostic(message: string): NativeDraftPreviewDiagnostic {
  return { code: "cpu-validation", severity: "error", message };
}

export function NativeShaderLab({
  open,
  onOpenChange,
  designId,
  fileId,
  nodeId,
  instanceId,
  runtimeEpoch,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designId: string;
  fileId: string;
  nodeId: string;
  instanceId: string;
  runtimeEpoch?: string;
  onApply: (
    operation: NativeLabApplyOperation,
    sourceVersionHash: string,
  ) => Promise<boolean>;
}) {
  const t = useT();
  const [base, setBase] = useState<LabBase | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [changedParams, setChangedParams] = useState<
    Record<string, EffectValue>
  >({});
  const [selectedPass, setSelectedPass] = useState<string>("");
  const [previewResult, setPreviewResult] =
    useState<NativeDraftPreviewResult | null>(null);
  const [gpuProfile, setGpuProfile] = useState<NativeLabGpuProfile | null>(
    null,
  );
  const [validatedRevision, setValidatedRevision] = useState<string | null>(
    null,
  );
  const [diagnostics, setDiagnostics] = useState<
    NativeDraftPreviewDiagnostic[]
  >([]);
  const [cpuValid, setCpuValid] = useState(false);
  const [pending, setPending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [comparePublished, setComparePublished] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [seed, setSeed] = useState(1);
  const schedulerRef = useRef(
    new NativeShaderDraftScheduler<LabPreviewTaskResult>(250),
  );
  const requestCounterRef = useRef(0);
  const baseRef = useRef<LabBase | null>(null);
  baseRef.current = base;

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setBase(null);
    setLoadError(null);
    setPreviewResult(null);
    setGpuProfile(null);
    setDiagnostics([]);
    setCpuValid(false);
    void (async () => {
      try {
        const selected = await callAction<NativeShaderRead>(
          "get-shader",
          {
            format: "native-v2",
            source: { kind: "design-file", designId, fileId },
            target: { nodeId },
          },
          { method: "GET" },
        );
        const instance = selected.document?.instances.find(
          (item) => item.id === instanceId && item.nodeId === nodeId,
        );
        if (!instance || !selected.versionHash)
          throw new Error("source-unreadable");
        const exact = await callAction<NativeShaderRead>(
          "get-shader",
          {
            format: "native-v2",
            source: { kind: "design-file", designId, fileId },
            target: { nodeId },
            definitionId: instance.definitionId,
            definitionVersion: instance.definitionVersion,
            includeSource: true,
          },
          { method: "GET" },
        );
        if (
          !exact.selectedDefinition ||
          exact.versionHash !== selected.versionHash ||
          exact.path !== selected.path ||
          exact.selectedDefinition.id !== instance.definitionId ||
          exact.selectedDefinition.version !== instance.definitionVersion
        )
          throw new Error("source-stale");
        const definition = exact.selectedDefinition;
        const baseExecutionHash = await hashEffectDefinition(definition);
        if (canceled) return;
        const nextVersion =
          Math.max(
            ...(exact.document?.definitions ?? [])
              .filter((candidate) => candidate.id === definition.id)
              .map((candidate) => candidate.version),
            definition.version,
          ) + 1;
        const sharedInstanceIds = (exact.document?.instances ?? [])
          .filter(
            (item) =>
              item.definitionId === definition.id &&
              item.definitionVersion === definition.version,
          )
          .map((item) => item.id);
        setBase({
          definition,
          instance,
          boardFile: exact.path === "__board__.html",
          sourceVersionHash: exact.versionHash!,
          baseExecutionHash,
          nextVersion,
          sharedInstanceIds,
        });
        setSources(
          Object.fromEntries(
            definition.passes.map((pass) => [pass.id, pass.wgsl]),
          ),
        );
        setSelectedPass(definition.passes[0]?.id ?? "");
        setChangedParams({});
        setSeed(instance.seed);
        setTime(instance.timing.time);
      } catch (error) {
        if (!canceled)
          setLoadError(
            error instanceof Error ? error.message : "source-unreadable",
          );
      }
    })();
    return () => {
      canceled = true;
      schedulerRef.current.cancel();
    };
  }, [open, designId, fileId, nodeId, instanceId]);

  useEffect(() => {
    if (!open || !base) return;
    const sample = () =>
      setGpuProfile(
        readNativeLabGpuProfileFromFrame(
          fileId,
          base.boardFile,
          base.instance.id,
        ),
      );
    sample();
    const timer = window.setInterval(sample, 1_500);
    return () => window.clearInterval(timer);
  }, [open, base, fileId]);

  const definition = useMemo(
    () => (base ? draftDefinition(base, sources) : null),
    [base, sources],
  );
  const values = useMemo(
    () =>
      base && definition
        ? draftValues(definition, base.instance, changedParams)
        : {},
    [base, definition, changedParams],
  );
  const sourceDirty = Boolean(
    base?.definition.passes.some((pass) => sources[pass.id] !== pass.wgsl),
  );
  const paramsDirty = Boolean(
    base &&
    Object.entries(changedParams).some(
      ([name, value]) =>
        !nativeEffectValuesEqual(
          value,
          base.instance.params[name] ??
            base.definition.properties[name]?.default,
        ),
    ),
  );
  const dirty = sourceDirty || paramsDirty;
  const previewChanged = Boolean(
    base &&
    (dirty ||
      seed !== base.instance.seed ||
      time !== base.instance.timing.time),
  );
  const draftRevision = JSON.stringify({ sources, changedParams, seed, time });

  useEffect(() => {
    if (!open || !base || !definition || !runtimeEpoch) return;
    if (!previewChanged) {
      schedulerRef.current.cancel();
      setPending(false);
      setCpuValid(false);
      setValidatedRevision(null);
      setDiagnostics([]);
      return;
    }
    setPending(true);
    setCpuValid(false);
    const requestSequence = ++requestCounterRef.current;
    const requestId = `lab_${requestSequence}`;
    const revision = draftRevision;
    schedulerRef.current.schedule(
      async (signal) => {
        const validation = await callAction<NativeShaderValidation>(
          "validate-native-shader",
          {
            document: {
              schemaVersion: 2,
              definitions: [definition],
              instances: [
                {
                  ...base.instance,
                  definitionVersion: definition.version,
                  params: { ...base.instance.params, ...changedParams },
                },
              ],
            },
          },
        );
        if (signal.aborted) throw new NativeDraftClientError("request-aborted");
        if (!validation.cpuValid)
          return {
            cpuErrors: validation.errors,
            preview: null,
          };
        const expectedExecutionHash = await hashEffectDefinition(definition);
        const frame = findNativeDraftFrame(fileId, base.boardFile);
        const targetWindow = frame.contentWindow;
        if (!targetWindow)
          throw new NativeDraftClientError("frame-unavailable");
        const preview = await sendNativeDraftMessage({
          targetWindow,
          signal,
          message: {
            type: "native-shader-draft-preview",
            schemaVersion: 1,
            requestId,
            runtimeEpoch,
            instanceId,
            nodeId,
            baseExecutionHash: base.baseExecutionHash,
            expectedExecutionHash,
            draftDefinition: definition,
            params: { ...base.instance.params, ...changedParams },
            seed,
            time,
          },
        });
        return { cpuErrors: [], preview };
      },
      ({ cpuErrors, preview }) => {
        if (requestCounterRef.current !== requestSequence) return;
        setCpuValid(cpuErrors.length === 0);
        setDiagnostics(preview?.diagnostics ?? cpuErrors.map(errorDiagnostic));
        setPreviewResult(preview);
        if (
          preview?.status === "ready" &&
          preview.displayed === "draft-current"
        )
          setComparePublished(false);
        setValidatedRevision(preview?.status === "ready" ? revision : null);
        setPending(false);
      },
      (error) => {
        if (requestCounterRef.current !== requestSequence) return;
        setPending(false);
        setCpuValid(false);
        setValidatedRevision(null);
        setDiagnostics([
          errorDiagnostic(
            error instanceof Error ? error.message : "preview-unreadable",
          ),
        ]);
      },
    );
    return () => schedulerRef.current.cancel();
  }, [
    open,
    base,
    definition,
    changedParams,
    runtimeEpoch,
    instanceId,
    nodeId,
    fileId,
    seed,
    time,
    draftRevision,
    previewChanged,
  ]);

  const sendControl = useCallback(
    async (
      command:
        | "clear"
        | "show-published"
        | "show-draft"
        | "set-time"
        | "play"
        | "pause",
      nextTime?: number,
    ) => {
      if (!baseRef.current || !runtimeEpoch)
        throw new NativeDraftClientError("frame-unavailable");
      const requestSequence = ++requestCounterRef.current;
      try {
        const frame = findNativeDraftFrame(fileId, baseRef.current.boardFile);
        if (!frame.contentWindow)
          throw new NativeDraftClientError("frame-unavailable");
        const result = await sendNativeDraftMessage({
          targetWindow: frame.contentWindow,
          message: {
            type: "native-shader-draft-control",
            schemaVersion: 1,
            requestId: `lab_${requestSequence}`,
            runtimeEpoch,
            instanceId,
            baseExecutionHash: baseRef.current.baseExecutionHash,
            command,
            ...(nextTime === undefined ? {} : { time: nextTime }),
          },
        });
        if (requestCounterRef.current === requestSequence) {
          setPreviewResult(result);
          setDiagnostics(result.diagnostics);
        }
      } catch (error) {
        if (requestCounterRef.current !== requestSequence) return;
        setDiagnostics([
          errorDiagnostic(
            error instanceof Error ? error.message : "preview-unreadable",
          ),
        ]);
        throw error;
      }
    },
    [runtimeEpoch, fileId, instanceId],
  );

  const close = useCallback(() => {
    schedulerRef.current.cancel();
    void sendControl("clear").catch(console.error);
    setPlaying(false);
    onOpenChange(false);
  }, [onOpenChange, sendControl]);

  const revert = () => {
    if (!base) return;
    requestCounterRef.current += 1;
    schedulerRef.current.cancel();
    setSources(
      Object.fromEntries(
        base.definition.passes.map((pass) => [pass.id, pass.wgsl]),
      ),
    );
    setChangedParams({});
    setTime(base.instance.timing.time);
    setSeed(base.instance.seed);
    setComparePublished(false);
    setDiagnostics([]);
    setPreviewResult(null);
    setPending(false);
    setValidatedRevision(null);
    void sendControl("clear").catch(console.error);
  };

  const apply = async (shared: boolean) => {
    if (
      !base ||
      !definition ||
      !dirty ||
      !cpuValid ||
      validatedRevision !== draftRevision ||
      previewResult?.status !== "ready" ||
      previewResult.displayed !== "draft-current"
    )
      return;
    setApplying(true);
    try {
      const changed = Object.fromEntries(
        Object.entries(changedParams).filter(
          ([name, value]) =>
            !nativeEffectValuesEqual(
              value,
              base.instance.params[name] ??
                base.definition.properties[name]?.default,
            ),
        ),
      );
      const operation = nativeLabApplyOperation({
        definition,
        fromVersion: base.definition.version,
        instanceId,
        sharedInstanceIds: base.sharedInstanceIds,
        params: changed,
        sourceDirty,
        shared,
      });
      const ok = await onApply(operation, base.sourceVersionHash);
      if (ok) close();
    } finally {
      setApplying(false);
    }
  };

  const selectedSource = sources[selectedPass] ?? "";
  const selectedDiagnostics = diagnostics.filter(
    (diagnostic) => !diagnostic.passId || diagnostic.passId === selectedPass,
  );
  const statusKey = loadError
    ? "labLoadError"
    : !runtimeEpoch
      ? "labRuntimeUnavailable"
      : pending
        ? "labChecking"
        : base && !previewChanged
          ? "labPublished"
          : !cpuValid
            ? "labCpuInvalid"
            : previewResult?.displayed === "draft-last-good"
              ? "labLastGood"
              : previewResult?.displayed === "published"
                ? "labPublished"
                : previewResult?.status === "ready"
                  ? "labGpuReady"
                  : "labRuntimeUnavailable";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent
        overlayClassName="z-[310]"
        className="z-[320] flex h-[min(78vh,780px)] max-w-5xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">
            {t("editPanel.shaders.labTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border">
            <div className="flex h-10 items-center gap-2 border-b border-border px-3">
              <Select
                value={selectedPass}
                onValueChange={setSelectedPass}
                disabled={!base}
              >
                <SelectTrigger className="h-7 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {base?.definition.passes.map((pass) => (
                    <SelectItem key={pass.id} value={pass.id}>
                      {pass.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">WGSL</span>
            </div>
            <div className="min-h-0 flex-1">
              {base ? (
                <WgslEditor
                  key={selectedPass}
                  value={selectedSource}
                  onChange={(value) =>
                    setSources((current) => ({
                      ...current,
                      [selectedPass]: value,
                    }))
                  }
                  diagnostics={selectedDiagnostics}
                  readOnly={applying}
                />
              ) : (
                <div className="p-3 text-xs text-muted-foreground">
                  {loadError
                    ? t(
                        loadError === "source-stale"
                          ? "editPanel.shaders.labSourceStale"
                          : "editPanel.shaders.labLoadError",
                      )
                    : t("common.loading")}
                </div>
              )}
            </div>
          </div>
          <div className="flex w-72 shrink-0 flex-col overflow-y-auto p-3">
            <div
              role={
                diagnostics.some((d) => d.severity === "error")
                  ? "alert"
                  : "status"
              }
              className="mb-3 text-xs text-muted-foreground"
              data-native-lab-status={statusKey}
            >
              {t(
                `editPanel.shaders.${statusKey}` as "editPanel.shaders.labGpuReady",
              )}
            </div>
            {previewResult?.timings && (
              <div className="mb-3 text-[11px] text-muted-foreground">
                {previewResult.timings.compileWallMs !== undefined &&
                  `${t("editPanel.shaders.labCompileWall")}: ${previewResult.timings.compileWallMs.toFixed(1)} ms`}
                {previewResult.timings.renderWallMs !== undefined &&
                  ` · ${t("editPanel.shaders.labRenderWall")}: ${previewResult.timings.renderWallMs.toFixed(1)} ms`}
              </div>
            )}
            {gpuProfile && (
              <div
                className="mb-3 text-[11px] text-muted-foreground"
                data-native-lab-gpu-profile={gpuProfile.kind}
              >
                {gpuProfile.kind === "ready"
                  ? `${t("editPanel.shaders.labGpuPassSample", { frame: gpuProfile.frameIndex, count: gpuProfile.passCount })}: ${gpuProfile.gpuPassSumMs.toFixed(1)} ms`
                  : t(
                      gpuProfile.kind === "pending"
                        ? "editPanel.shaders.labGpuSamplePending"
                        : gpuProfile.kind === "unavailable"
                          ? "editPanel.shaders.labGpuSampleUnavailable"
                          : "editPanel.shaders.labGpuSampleError",
                    )}
              </div>
            )}
            {diagnostics.length > 0 && (
              <div
                className="mb-3 max-h-28 overflow-auto rounded border border-border p-2 text-xs"
                data-native-lab-diagnostics
              >
                {diagnostics.map((diagnostic, index) => (
                  <p
                    key={`${diagnostic.code}-${index}`}
                    className={
                      diagnostic.severity === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {diagnostic.passId ? `${diagnostic.passId} ` : ""}
                    {diagnostic.line
                      ? `${diagnostic.line}:${diagnostic.column ?? 1} `
                      : ""}
                    {diagnostic.message}
                  </p>
                ))}
              </div>
            )}
            {base && definition && (
              <NativeEffectControls
                designId={designId}
                fileId={fileId}
                key={`${fileId}:${base.instance.id}`}
                definition={definition}
                values={values}
                disabled={applying}
                onValueChange={(name, value) =>
                  setChangedParams((current) => ({ ...current, [name]: value }))
                }
              />
            )}
            <div className="mt-4 grid gap-2 border-t border-border pt-3 text-xs">
              <label className="flex items-center justify-between gap-2">
                <span>{t("editPanel.shaders.labPreviewSeed")}</span>
                <Input
                  className="h-7 w-24 text-xs"
                  type="number"
                  min={0}
                  max={1000000}
                  step={1}
                  value={base ? seed : ""}
                  disabled={!base}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (
                      Number.isInteger(value) &&
                      value >= 0 &&
                      value <= 1_000_000
                    )
                      setSeed(value);
                  }}
                />
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={!base || !runtimeEpoch}
                  aria-label={
                    playing
                      ? t("designEditor.motion.pause")
                      : t("designEditor.motion.play")
                  }
                  onClick={() => {
                    const next = !playing;
                    setPlaying(next);
                    void sendControl(next ? "play" : "pause").catch((error) => {
                      setPlaying(!next);
                      console.error(error);
                    });
                  }}
                >
                  {playing ? (
                    <IconPlayerPause className="size-3.5" />
                  ) : (
                    <IconPlayerPlay className="size-3.5" />
                  )}
                </Button>
                <Slider
                  value={[time]}
                  min={0}
                  max={10}
                  step={0.01}
                  className="flex-1"
                  aria-label={t("editPanel.shaders.labPreviewTime")}
                  onValueChange={([value]) => {
                    if (value !== undefined) setTime(value);
                  }}
                />
                <span className="w-10 text-right tabular-nums">
                  {time.toFixed(2)}s
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t("designEditor.motion.resetPlayhead")}
                  disabled={!base || !runtimeEpoch}
                  onClick={() => {
                    setTime(0);
                    void sendControl("set-time", 0).catch(console.error);
                  }}
                >
                  <IconRefresh className="size-3.5" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={comparePublished ? "secondary" : "outline"}
                  disabled={
                    !base ||
                    !runtimeEpoch ||
                    (!comparePublished &&
                      previewResult?.displayed !== "draft-current" &&
                      previewResult?.displayed !== "draft-last-good")
                  }
                  onClick={() => {
                    const next = !comparePublished;
                    setComparePublished(next);
                    void sendControl(
                      next ? "show-published" : "show-draft",
                    ).catch((error) => {
                      setComparePublished(!next);
                      console.error(error);
                    });
                  }}
                >
                  {comparePublished
                    ? t("editPanel.shaders.labAfter")
                    : t("editPanel.shaders.labBefore")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!base || !previewChanged}
                  onClick={revert}
                >
                  {t("editPanel.shaders.labRevert")}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={close}>
            {t("editPanel.shaders.labClose")}
          </Button>
          {base && base.sharedInstanceIds.length > 1 && (
            <Button
              variant="outline"
              disabled={
                !dirty ||
                !cpuValid ||
                pending ||
                applying ||
                validatedRevision !== draftRevision ||
                previewResult?.displayed !== "draft-current"
              }
              onClick={() => void apply(true)}
            >
              {t("editPanel.shaders.labApplyShared")}
            </Button>
          )}
          <Button
            disabled={
              !dirty ||
              !cpuValid ||
              pending ||
              applying ||
              validatedRevision !== draftRevision ||
              previewResult?.displayed !== "draft-current"
            }
            onClick={() => void apply(false)}
          >
            {t("editPanel.shaders.labApplyInstance")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
