import { useT } from "@agent-native/core/client/i18n";
import { IconPlayerPlay } from "@tabler/icons-react";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";

import {
  isWindowWithin,
  type ScreenHistoryWindow,
} from "../../../shared/screen-history-context";
import { ScreenHistoryScrubber } from "../../../shared/screen-history-scrubber";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button, buttonVariants } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import type { RecordingContextItem } from "./context-api";
import {
  discardRewindPreview,
  loadRewindPreview,
  type RewindInvoke,
} from "./rewind-preview";

export interface LookbackEditDialogProps {
  item: RecordingContextItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Rejects when the window is not saved, so the dialog stays open for a retry.
  onSave: (next: ScreenHistoryWindow) => Promise<void>;
  // Rejects when the item is not removed, so the dialog stays open with an error.
  onRemove: () => Promise<void>;
  // Defaults to the Tauri bridge. Must stay the same function across renders,
  // because a new one reloads the preview.
  invoke?: RewindInvoke;
}

export function LookbackEditDialog({
  item,
  open,
  onOpenChange,
  onSave,
  onRemove,
  invoke,
}: LookbackEditDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[340px] gap-3 p-5">
        <LookbackEditForm
          item={item}
          onOpenChange={onOpenChange}
          onSave={onSave}
          onRemove={onRemove}
          invoke={invoke}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; src: string; metadataLoaded: boolean }
  | { status: "error" };

const PREVIEW_DEBOUNCE_MS = 220;
const PREVIEW_TIMEOUT_MS = 60_000;

async function loadPreviewWithTimeout(
  value: ScreenHistoryWindow,
  invoke: RewindInvoke | undefined,
) {
  let timedOut = false;
  let timeout: number | undefined;
  const request = loadRewindPreview(value, invoke);
  const deadline = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => {
      timedOut = true;
      reject(new Error("Earlier screen time preview timed out."));
    }, PREVIEW_TIMEOUT_MS);
  });
  void request.then(
    (result) => {
      if (timedOut) void discardQuietly(result.path, invoke);
    },
    () => undefined,
  );

  try {
    return await Promise.race([request, deadline]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

// Radix unmounts the content on close, so each open starts from the item's window.
function LookbackEditForm({
  item,
  onOpenChange,
  onSave,
  onRemove,
  invoke,
}: Pick<
  LookbackEditDialogProps,
  "item" | "onOpenChange" | "onSave" | "onRemove" | "invoke"
>) {
  const t = useT();
  const original: ScreenHistoryWindow = {
    startedAt: item.originalStartedAt,
    endedAt: item.originalEndedAt,
  };
  const [value, setValue] = useState<ScreenHistoryWindow>({
    startedAt: item.startedAt,
    endedAt: item.endedAt,
  });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Both in seconds from the start of the selected preview window.
  const [position, setPosition] = useState<number | null>(null);
  const [selectionStop, setSelectionStop] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewTaskRef = useRef<Promise<void> | null>(null);
  const unchanged =
    value.startedAt === item.startedAt && value.endedAt === item.endedAt;

  // Every close route unmounts this form, and the cleanup discards the cut it
  // loaded. A cut that resolves after the close is discarded when it arrives.
  // Keep the local cut bounded to the current selection so an unavailable part
  // of the wider lookback window does not prevent editing captured footage.
  useEffect(() => {
    let cancelled = false;
    let loadedPath: string | null = null;
    setPreview({ status: "loading" });
    setPosition(null);
    setSelectionStop(null);
    const timer = window.setTimeout(() => {
      const previousTask = previewTaskRef.current;
      const task = (async () => {
        try {
          await previousTask;
          if (cancelled) return;
          const result = await loadPreviewWithTimeout(value, invoke);
          if (cancelled) {
            await discardQuietly(result.path, invoke);
            return;
          }
          loadedPath = result.path;
          setPreview({
            status: "ready",
            src: result.src,
            metadataLoaded: false,
          });
        } catch (previewError) {
          if (cancelled) return;
          console.warn(
            "[record-pill] earlier screen time preview failed:",
            previewError,
          );
          setPreview({ status: "error" });
        }
      })();
      previewTaskRef.current = task;
      void task.then(
        () => {
          if (previewTaskRef.current === task) previewTaskRef.current = null;
        },
        () => {
          if (previewTaskRef.current === task) previewTaskRef.current = null;
        },
      );
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (loadedPath) void discardQuietly(loadedPath, invoke);
    };
  }, [attempt, value.startedAt, value.endedAt, invoke]);

  async function save() {
    if (saving || unchanged || !isWindowWithin(original, value)) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      onOpenChange(false);
    } catch (saveError) {
      console.warn("[record-pill] save earlier screen time failed:", saveError);
      setError(t("lookbackContext.editFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (removing || saving) return;
    setRemoving(true);
    setError(null);
    try {
      await onRemove();
      setConfirmingRemove(false);
      // Closing unmounts this form, and its cleanup discards the cut it loaded.
      onOpenChange(false);
    } catch (removeError) {
      console.warn(
        "[record-pill] remove earlier screen time failed:",
        removeError,
      );
      setConfirmingRemove(false);
      setError(t("lookbackContext.removeFailed"));
    } finally {
      setRemoving(false);
    }
  }

  function retryPreview() {
    setPreview({ status: "loading" });
    setAttempt((count) => count + 1);
  }

  function cutSeconds(iso: string): number {
    return (Date.parse(iso) - Date.parse(value.startedAt)) / 1000;
  }

  function playSelection() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setSelectionStop(cutSeconds(value.endedAt));
    void video.play().catch((playError) => {
      console.warn("[record-pill] preview playback failed:", playError);
    });
  }

  function onTimeUpdate(event: SyntheticEvent<HTMLVideoElement>) {
    const seconds = event.currentTarget.currentTime;
    setPosition(seconds);
    if (selectionStop !== null && seconds >= selectionStop) {
      event.currentTarget.pause();
      setSelectionStop(null);
    }
  }

  const playable = preview.status === "ready" && preview.metadataLoaded;
  const playhead =
    position === null
      ? null
      : new Date(Date.parse(value.startedAt) + position * 1000).toISOString();

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("lookbackContext.editTitle")}</AlertDialogTitle>
      </AlertDialogHeader>
      {preview.status === "error" ? (
        <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-md bg-muted text-xs text-destructive">
          <span role="alert">{t("lookbackContext.previewFailed")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retryPreview}
          >
            {t("lookbackContext.retry")}
          </Button>
        </div>
      ) : (
        <div className="relative h-36 overflow-hidden rounded-md bg-background">
          {preview.status === "ready" ? (
            <video
              ref={videoRef}
              aria-label={t("lookbackContext.previewLabel")}
              src={preview.src}
              controls
              playsInline
              preload="auto"
              className="h-full w-full object-contain"
              onLoadedMetadata={(event) => {
                // Playback events are not sent until the video moves, so the
                // playhead starts from the first frame here.
                setPosition(event.currentTarget.currentTime);
                setPreview((current) =>
                  current.status === "ready"
                    ? { ...current, metadataLoaded: true }
                    : current,
                );
              }}
              onTimeUpdate={onTimeUpdate}
              onPause={() => setSelectionStop(null)}
              onError={() => {
                console.warn("[record-pill] preview video failed to load");
                setPreview({ status: "error" });
              }}
            />
          ) : null}
          {playable ? null : (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center bg-muted"
            >
              <Skeleton className="absolute inset-0" />
              <span className="relative text-xs text-muted-foreground">
                {t("lookbackContext.previewPreparing")}
              </span>
            </div>
          )}
        </div>
      )}
      <ScreenHistoryScrubber
        original={original}
        value={value}
        onChange={setValue}
        disabled={saving || removing}
        playhead={playhead}
        labels={{
          fromBefore: (duration) =>
            t("lookbackContext.scrubberFromBefore", { offset: duration }),
          fromStart: t("lookbackContext.scrubberFromStart"),
          toBefore: (duration) =>
            t("lookbackContext.scrubberToBefore", { offset: duration }),
          toStart: t("lookbackContext.scrubberToStart"),
          length: t("lookbackContext.scrubberLength"),
          startHandle: t("lookbackContext.scrubberStartHandle"),
          endHandle: t("lookbackContext.scrubberEndHandle"),
        }}
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="text-destructive"
          disabled={saving || removing}
          onClick={() => setConfirmingRemove(true)}
        >
          {t("lookbackContext.removeAction")}
        </Button>
      </div>
      <AlertDialogFooter className="flex-row items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!playable || saving || removing}
          onClick={playSelection}
        >
          <IconPlayerPlay size={14} stroke={1.75} aria-hidden />
          {t("lookbackContext.playSelection")}
        </Button>
        <div className="flex gap-2">
          <AlertDialogCancel disabled={saving || removing}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            size="sm"
            disabled={saving || removing || unchanged}
            onClick={() => void save()}
          >
            {saving ? t("common.saving") : t("lookbackContext.editSave")}
          </Button>
        </div>
      </AlertDialogFooter>
      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent className="max-w-[300px] gap-3 p-5">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("lookbackContext.removeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("lookbackContext.removeConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={removing}
              onClick={(event) => {
                // Keeps the confirmation open until the removal settles.
                event.preventDefault();
                void remove();
              }}
            >
              {t("lookbackContext.removeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function discardQuietly(path: string, invoke: RewindInvoke | undefined) {
  return discardRewindPreview(path, invoke).catch((discardError) => {
    console.warn(
      "[record-pill] discarding the earlier screen time preview failed:",
      discardError,
    );
  });
}
