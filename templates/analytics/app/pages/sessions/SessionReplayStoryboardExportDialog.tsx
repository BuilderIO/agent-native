import { appApiPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { IconPhoto, IconPlayerStop } from "@tabler/icons-react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getIdToken } from "@/lib/auth";

import {
  captureReplayScreenshot,
  ReplayScreenshotAssetError,
} from "./session-replay-screenshot";

const MAX_REPLAYS = 3;
const MAX_TIMESTAMPS_PER_REPLAY = 3;
const MAX_SCREENSHOTS = 9;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;

type Recording = {
  id: string;
  startedAt: string;
  durationMs: number | null;
  eventCount: number;
  app: string | null;
  template: string | null;
  path: string | null;
};

type CapturedScreenshot = {
  blob: Blob;
  recordingId: string;
  offsetMs: number;
  route: string;
  viewportWidth: number;
  viewportHeight: number;
  eventCount: number;
  capturedAt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordings: Recording[];
  cohortTotal: number;
};

type ExportState = "idle" | "capturing" | "uploading" | "done";

export function SessionReplayStoryboardExportDialog({
  open,
  onOpenChange,
  recordings,
  cohortTotal,
}: Props) {
  const t = useT();
  const [timestampInputs, setTimestampInputs] = useState<
    Record<string, string>
  >({});
  const [designId, setDesignId] = useState("");
  const [title, setTitle] = useState("");
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [response, setResponse] = useState("");
  const [boardUrl, setBoardUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [stageBox, setStageBox] = useState({ width: 0, height: 0 });
  const [stageDimensions, setStageDimensions] = useState({
    width: 430,
    height: 932,
  });
  const stageAreaRef = useRef<HTMLDivElement>(null);
  const stageRootRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const selectionKey = recordings.map((recording) => recording.id).join("\n");
  const viewportFit = Math.min(
    stageBox.width / stageDimensions.width || 1,
    stageBox.height / stageDimensions.height || 1,
    1,
  );

  useEffect(() => {
    setTimestampInputs((current) => {
      const next: Record<string, string> = {};
      for (const id of selectionKey.split("\n").filter(Boolean)) {
        next[id] = current[id] ?? "";
      }
      if (
        Object.keys(current).length === Object.keys(next).length &&
        Object.keys(current).every((id) =>
          Object.prototype.hasOwnProperty.call(next, id),
        )
      ) {
        return current;
      }
      return next;
    });
  }, [selectionKey]);

  useEffect(() => {
    const element = stageAreaRef.current;
    if (!open || !element) return;
    const update = () =>
      setStageBox({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    try {
      replayerRef.current?.pause?.();
      replayerRef.current?.destroy?.();
    } catch {
      replayerRef.current = null;
    }
    replayerRef.current = null;
    if (stageRootRef.current) stageRootRef.current.innerHTML = "";
  }, []);

  useEffect(() => {
    if (open) return;
    cleanup();
  }, [cleanup, open]);

  useEffect(() => () => cleanup(), [cleanup]);

  function selectTimestampInput(recordingId: string, value: string) {
    setTimestampInputs((current) => ({ ...current, [recordingId]: value }));
    setError("");
    setWarning("");
    setResponse("");
    setBoardUrl("");
    setExportState("idle");
  }

  function parseTargets(): Array<{ recording: Recording; offsets: number[] }> {
    if (recordings.length < 1 || recordings.length > MAX_REPLAYS) {
      throw new Error(t("sessions.storyboardReplayLimit"));
    }
    let count = 0;
    const targets = recordings.map((recording) => {
      const raw = (timestampInputs[recording.id] ?? "").trim();
      if (!raw) throw new Error(t("sessions.storyboardTimestampRequired"));
      const values = raw.split(/[\s,;]+/).filter(Boolean);
      if (values.length > MAX_TIMESTAMPS_PER_REPLAY) {
        throw new Error(t("sessions.storyboardTimestampLimit"));
      }
      const offsets = values.map((value) =>
        parseTimestampOffset(value, t("sessions.storyboardTimestampError")),
      );
      if (new Set(offsets).size !== offsets.length) {
        throw new Error(t("sessions.storyboardDuplicateTimestamp"));
      }
      count += offsets.length;
      return { recording, offsets };
    });
    if (count > MAX_SCREENSHOTS) {
      throw new Error(t("sessions.storyboardScreenshotLimit"));
    }
    return targets;
  }

  function captureErrorMessage(error: unknown): string {
    if (error instanceof ReplayScreenshotAssetError) {
      console.warn("Replay screenshot capture rejected", error.reason);
      return t("sessions.screenshotUnsupportedAssets");
    }
    return error instanceof Error
      ? error.message
      : t("sessions.storyboardCaptureFailed");
  }

  function updateStage(width: number, height: number) {
    setStageDimensions({ width, height });
    const root = stageRootRef.current;
    if (!root) return;
    const area = stageAreaRef.current;
    const scale = Math.min(
      (area?.clientWidth ?? 1) / width,
      (area?.clientHeight ?? 1) / height,
      1,
    );
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    root.style.setProperty("--an-replay-cursor-scale", String(1 / scale));
    root.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    let targets: Array<{ recording: Recording; offsets: number[] }>;
    try {
      targets = parseTargets();
    } catch (captureError) {
      setError(captureErrorMessage(captureError));
      return;
    }

    setError("");
    setWarning("");
    setResponse("");
    setBoardUrl("");
    setBusy(true);
    setExportState("capturing");
    setProgress(t("sessions.storyboardStartingCapture"));
    const controller = new AbortController();
    abortRef.current = controller;
    let mutationSubmitted = false;

    try {
      const totalFrames = targets.reduce(
        (total, target) => total + target.offsets.length,
        0,
      );
      const captured: CapturedScreenshot[] = [];
      let frameNumber = 0;
      await import("@rrweb/replay/dist/style.css");
      const { Replayer } = await import("@rrweb/replay");
      const replayPlayback = await import("./SessionDetailPage");
      const stageRoot = stageRootRef.current;
      const stageArea = stageAreaRef.current;
      if (!stageRoot || !stageArea) {
        throw new Error(t("sessions.storyboardCaptureFailed"));
      }

      for (const target of targets) {
        if (controller.signal.aborted)
          throw new Error(t("sessions.storyboardCanceled"));
        setProgress(
          t("sessions.storyboardLoadingReplay", {
            replayId: target.recording.id,
          }),
        );
        const playback = await replayPlayback.fetchSessionReplayPlayback(
          target.recording.id,
        );
        if (
          !playback.isComplete ||
          playback.unavailableChunks > 0 ||
          playback.chunks.some((chunk) => chunk.unavailable)
        ) {
          throw new Error(
            t("sessions.storyboardReplayIncomplete", {
              replayId: target.recording.id,
            }),
          );
        }
        const events = replayPlayback.normalizeReplayEvents(
          playback.chunks.flatMap((chunk) => chunk.events),
        );
        const unavailableReason =
          replayPlayback.replayAvailabilityErrorKey(events);
        if (unavailableReason) {
          throw new Error(t(`sessions.${unavailableReason}`));
        }
        const initialDimensions =
          replayPlayback.replayInitialViewportDimensions(events);
        if (!initialDimensions) {
          throw new Error(t("sessions.storyboardViewportUnavailable"));
        }
        const viewportTimeline =
          replayPlayback.buildReplayViewportTimeline(events);
        stageRoot.innerHTML = "";
        updateStage(initialDimensions.width, initialDimensions.height);
        const replayer = new Replayer(events as any[], {
          root: stageRoot,
          speed: 1,
          skipInactive: false,
          showWarning: false,
          showDebug: false,
          mouseTail: false,
          triggerFocus: true,
          insertStyleRules: replayPlayback.REPLAY_OVERLAY_STYLE_RULES,
        });
        replayer.iframe?.setAttribute?.("referrerpolicy", "no-referrer");
        replayerRef.current = replayer;

        const totalTime = Number(
          replayer.getMetaData?.().totalTime ??
            target.recording.durationMs ??
            0,
        );
        if (
          target.offsets.some(
            (offset) => !Number.isFinite(totalTime) || offset > totalTime,
          )
        ) {
          throw new Error(
            t("sessions.storyboardTimestampOutOfRange", {
              replayId: target.recording.id,
            }),
          );
        }

        try {
          replayer.play?.(0);
        } catch {
          replayer.pause?.(0);
        }
        await nextPaint();

        for (const offsetMs of target.offsets) {
          if (controller.signal.aborted) {
            throw new Error(t("sessions.storyboardCanceled"));
          }
          const dimensions =
            replayPlayback.replayViewportDimensionsAtTime(
              viewportTimeline,
              offsetMs,
            ) ?? initialDimensions;
          replayer.pause(offsetMs);
          (
            replayer as unknown as {
              handleResize?: (viewport: typeof dimensions) => void;
            }
          ).handleResize?.(dimensions);
          updateStage(dimensions.width, dimensions.height);
          await nextPaint();
          const iframe = replayer.iframe as HTMLIFrameElement | undefined;
          if (!iframe) throw new Error(t("sessions.storyboardCaptureFailed"));

          frameNumber += 1;
          setProgress(
            t("sessions.storyboardCapturingFrame", {
              current: String(frameNumber),
              total: String(totalFrames),
              replayId: target.recording.id,
              timestamp: formatTimestampOffset(offsetMs),
            }),
          );
          let blob: Blob;
          try {
            blob = await captureReplayScreenshot(
              stageArea,
              stageRoot,
              iframe,
              controller.signal,
            );
          } catch (captureError) {
            if (controller.signal.aborted) {
              throw new Error(t("sessions.storyboardCanceled"));
            }
            if (captureError instanceof ReplayScreenshotAssetError) {
              throw captureError;
            }
            throw new Error(t("sessions.storyboardCaptureFailed"));
          }
          if (blob.size > MAX_SCREENSHOT_BYTES) {
            throw new Error(t("sessions.storyboardScreenshotTooLarge"));
          }
          const route = replayPlayback.replayRouteAtOffset(events, offsetMs);
          if (!route) {
            throw new Error(
              t("sessions.storyboardRouteUnavailable", {
                replayId: target.recording.id,
                timestamp: formatTimestampOffset(offsetMs),
              }),
            );
          }
          captured.push({
            blob,
            recordingId: target.recording.id,
            offsetMs,
            route,
            viewportWidth: dimensions.width,
            viewportHeight: dimensions.height,
            eventCount: playback.recording.eventCount,
            capturedAt: target.recording.startedAt,
          });
        }
        replayer.pause?.();
        replayer.destroy?.();
        replayerRef.current = null;
        stageRoot.innerHTML = "";
      }

      if (controller.signal.aborted)
        throw new Error(t("sessions.storyboardCanceled"));
      const totalBytes = captured.reduce(
        (total, frame) => total + frame.blob.size,
        0,
      );
      if (totalBytes > MAX_BATCH_BYTES) {
        throw new Error(t("sessions.storyboardBatchTooLarge"));
      }
      setExportState("uploading");
      setProgress(t("sessions.storyboardSendingToDesign"));
      const formData = new FormData();
      formData.append(
        "manifest",
        JSON.stringify({
          ...(designId.trim() ? { designId: designId.trim() } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
          cohortTotal,
          selectedReplayCount: targets.length,
          screenshots: captured.map(
            ({ blob: _blob, ...screenshot }) => screenshot,
          ),
        }),
      );
      captured.forEach((frame, index) => {
        formData.append(
          `screenshot-${index}`,
          new File(
            [frame.blob],
            `${frame.recordingId}-${String(frame.offsetMs).padStart(8, "0")}.png`,
            { type: "image/png" },
          ),
        );
      });
      const token = await getIdToken();
      if (controller.signal.aborted) {
        throw new Error(t("sessions.storyboardCanceled"));
      }
      mutationSubmitted = true;
      let upload: Response;
      try {
        upload = await fetch(appApiPath("session-replay/storyboard"), {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: formData,
        });
      } catch {
        throw new Error(t("sessions.storyboardSaveOutcomeUnknown"));
      }
      let result: {
        response?: string;
        boardUrl?: string;
        cleanupFailed?: boolean;
        cleanupPending?: boolean;
        cleanupUnknown?: boolean;
        data?: {
          cleanupFailed?: boolean;
          cleanupPending?: boolean;
          cleanupUnknown?: boolean;
          saveOutcomeUnknown?: boolean;
          storyboardResponseUnreadable?: boolean;
        };
        error?: string | boolean;
        message?: string;
        statusMessage?: string;
      } | null;
      try {
        result = (await upload.json()) as typeof result;
      } catch {
        throw new Error(t("sessions.storyboardSaveOutcomeUnknown"));
      }
      const cleanupFailed =
        result?.cleanupFailed === true || result?.data?.cleanupFailed === true;
      const cleanupUnknown =
        result?.cleanupUnknown === true ||
        result?.data?.cleanupUnknown === true;
      if (
        cleanupFailed ||
        cleanupUnknown ||
        result?.cleanupPending ||
        result?.data?.cleanupPending
      ) {
        const storyboardWasConfirmed = Boolean(
          !cleanupFailed &&
          !cleanupUnknown &&
          upload.ok &&
          result?.response?.trim() &&
          result?.boardUrl?.trim(),
        );
        setWarning(
          t(
            storyboardWasConfirmed
              ? "sessions.storyboardTemporaryCleanupPending"
              : "sessions.storyboardTemporaryCleanupFailed",
          ),
        );
      }
      if (!upload.ok) {
        if (result?.data?.saveOutcomeUnknown) {
          throw new Error(t("sessions.storyboardSaveOutcomeUnknown"));
        }
        if (result?.data?.storyboardResponseUnreadable) {
          throw new Error(t("sessions.storyboardUnexpectedResponse"));
        }
        const errorMessage =
          (typeof result?.error === "string" && result.error.trim()) ||
          result?.statusMessage?.trim() ||
          result?.message?.trim() ||
          `HTTP ${upload.status}`;
        throw new Error(errorMessage);
      }
      if (!result?.response?.trim() || !result.boardUrl?.trim()) {
        throw new Error(t("sessions.storyboardNoDesignResponse"));
      }
      setResponse(result.response);
      setBoardUrl(result.boardUrl);
      setExportState("done");
      setProgress(
        t("sessions.storyboardComplete", {
          screenshots: String(captured.length),
        }),
      );
    } catch (captureError) {
      setError(
        controller.signal.aborted && !mutationSubmitted
          ? t("sessions.storyboardCanceled")
          : captureErrorMessage(captureError),
      );
      setExportState("idle");
      setProgress("");
    } finally {
      cleanup();
      setBusy(false);
    }
  }

  function cancelCapture() {
    if (exportState !== "capturing") return;
    abortRef.current?.abort();
    setExportState("idle");
    setProgress("");
    setError(t("sessions.storyboardCanceled"));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && busy) return;
    if (!nextOpen) {
      setExportState("idle");
      setProgress("");
      setError("");
      setWarning("");
      setResponse("");
      setBoardUrl("");
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader>
            <DialogTitle>{t("sessions.createStoryboard")}</DialogTitle>
          </DialogHeader>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="session-storyboard-design-id">
                  {t("sessions.storyboardDesignId")}
                </Label>
                <Input
                  id="session-storyboard-design-id"
                  value={designId}
                  onChange={(event) => setDesignId(event.target.value)}
                  disabled={busy || exportState === "done"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="session-storyboard-title">
                  {t("sessions.storyboardTitle")}
                </Label>
                <Input
                  id="session-storyboard-title"
                  value={title}
                  placeholder={t("sessions.storyboardDefaultTitle")}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={busy || exportState === "done"}
                />
              </div>
            </div>
            <div className="grid gap-2">
              {recordings.map((recording) => (
                <div
                  key={recording.id}
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {recording.app ||
                        recording.template ||
                        t("sessions.unknownApp")}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {recording.id}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`storyboard-offsets-${recording.id}`}>
                      {t("sessions.storyboardTimestamps")}
                    </Label>
                    <Input
                      id={`storyboard-offsets-${recording.id}`}
                      inputMode="text"
                      placeholder="00:13, 00:35"
                      value={timestampInputs[recording.id] ?? ""}
                      onChange={(event) =>
                        selectTimestampInput(recording.id, event.target.value)
                      }
                      disabled={busy || exportState === "done"}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div
              ref={stageAreaRef}
              className="relative mx-auto h-[min(52vh,520px)] w-full overflow-hidden rounded-md border bg-background"
              aria-label={t("sessions.storyboardReplayPreview")}
            >
              <div
                ref={stageRootRef}
                className="an-replay-stage-root absolute left-1/2 top-1/2"
                style={
                  {
                    width: stageDimensions.width,
                    height: stageDimensions.height,
                    transform: `translate(-50%, -50%) scale(${viewportFit})`,
                    transformOrigin: "center center",
                    "--an-replay-cursor-scale": String(1 / viewportFit),
                  } as CSSProperties
                }
              />
              {!busy ? (
                <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                  {t("sessions.storyboardReplayPreview")}
                </div>
              ) : null}
            </div>
            {progress ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {progress}
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {warning ? (
              <p className="text-sm text-muted-foreground" role="status">
                {warning}
              </p>
            ) : null}
            {response ? (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <p>{response}</p>
                {boardUrl ? (
                  <a
                    className="font-medium text-primary underline underline-offset-4"
                    href={boardUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("sessions.openStoryboard")}
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          {exportState === "done" ? null : (
            <DialogFooter className="mt-4">
              {busy && exportState === "capturing" ? (
                <Button type="button" variant="outline" onClick={cancelCapture}>
                  <IconPlayerStop />
                  {t("sessions.cancelStoryboardCapture")}
                </Button>
              ) : busy ? null : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={recordings.length === 0}>
                    <IconPhoto />
                    {t("sessions.captureToDesign")}
                  </Button>
                </>
              )}
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function parseTimestampOffset(value: string, errorMessage: string): number {
  const parts = value.split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    throw new Error(errorMessage);
  }
  const secondsMatch = parts[parts.length - 1]!.match(
    /^(\d{1,2})(?:\.(\d{1,3}))?$/,
  );
  if (!secondsMatch) throw new Error(errorMessage);
  const seconds = Number(secondsMatch[1]);
  const milliseconds = Number((secondsMatch[2] ?? "").padEnd(3, "0"));
  if (seconds >= 60) throw new Error(errorMessage);
  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    if (!/^\d{1,4}$/.test(parts[0]!) || minutes > 5999) {
      throw new Error(errorMessage);
    }
    return minutes * 60_000 + seconds * 1_000 + milliseconds;
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (
    !/^\d{1,3}$/.test(parts[0]!) ||
    !/^\d{1,2}$/.test(parts[1]!) ||
    minutes >= 60
  ) {
    throw new Error(errorMessage);
  }
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + milliseconds;
}

function formatTimestampOffset(offsetMs: number): string {
  const hours = Math.floor(offsetMs / 3_600_000);
  const minutes = Math.floor((offsetMs % 3_600_000) / 60_000);
  const seconds = Math.floor((offsetMs % 60_000) / 1_000);
  const milliseconds = offsetMs % 1_000;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
