import {
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";

type NativeUploadProgress = {
  stage?: string;
  message?: string;
  detail?: string | null;
  progress?: number | null;
};

type ProcessingProgress = {
  stage?: string;
  progress?: number | null;
  viewUrl?: string;
};

type NativeUploadFinished = {
  recordingId?: string;
  ok?: boolean;
  viewUrl?: string;
  error?: string | null;
  localFilePath?: string | null;
};

const FINALIZING_RESULT_STORAGE_KEY = "clips-finalizing-result";

function takePersistedFinalizingResult(): NativeUploadFinished | null {
  try {
    const raw = window.localStorage.getItem(FINALIZING_RESULT_STORAGE_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(FINALIZING_RESULT_STORAGE_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Record<string, unknown>;
    if (
      typeof payload.recordingId !== "string" ||
      typeof payload.viewUrl !== "string" ||
      typeof payload.ok !== "boolean"
    ) {
      return null;
    }
    return {
      recordingId: payload.recordingId,
      viewUrl: payload.viewUrl,
      ok: payload.ok,
      error: typeof payload.error === "string" ? payload.error : null,
      localFilePath: null,
    };
  } catch {
    return null;
  }
}

/**
 * Compact bottom-left feedback window. Rendered the moment the user clicks
 * Stop and kept visible while the desktop finishes its durable backup and
 * first upload/finalize attempt. The browser can open `/r/:id` earlier so the
 * page shows live progress.
 */
export function Finalizing() {
  const [progress, setProgress] = useState<ProcessingProgress>({
    stage: "finalizing",
    progress: null,
  });

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenFinished: (() => void) | null = null;
    let completionTimer: ReturnType<typeof window.setTimeout> | null = null;
    let openingWatchdog: ReturnType<typeof window.setTimeout> | null = null;
    const hardWatchdog = window.setTimeout(() => {
      void invoke("hide_finalizing").catch(() => {});
    }, 120_000);
    let finishedHandled = false;
    const clearCompletionTimer = () => {
      if (completionTimer) {
        window.clearTimeout(completionTimer);
        completionTimer = null;
      }
    };
    const clearOpeningWatchdog = () => {
      if (openingWatchdog) {
        window.clearTimeout(openingWatchdog);
        openingWatchdog = null;
      }
    };
    listen<NativeUploadProgress>("clips:native-upload-progress", (event) => {
      if (finishedHandled) return;
      const payload = event.payload ?? {};
      if (payload.stage === "opening" && payload.progress === 1) {
        clearOpeningWatchdog();
        openingWatchdog = window.setTimeout(() => {
          void invoke("show_popover").catch(() => {});
          void invoke("hide_finalizing").catch(() => {});
        }, 15000);
      } else if (payload.stage !== "opening") {
        clearOpeningWatchdog();
      }
      setProgress({
        stage: payload.stage,
        progress:
          typeof payload.progress === "number" &&
          Number.isFinite(payload.progress)
            ? Math.min(1, Math.max(0, payload.progress))
            : null,
      });
    })
      .then((u) => {
        if (disposed) {
          u();
          return;
        }
        unlisten = u;
      })
      .catch(() => {});

    const claimNativeOpen = async (
      recordingId: string | undefined,
    ): Promise<boolean> => {
      if (!recordingId) return true;
      return invoke<boolean>("native_fullscreen_claim_upload_open", {
        recordingId,
      }).catch(() => true);
    };

    const handleFinished = (payload: NativeUploadFinished) => {
      if (disposed || finishedHandled) return;
      finishedHandled = true;
      try {
        window.localStorage.removeItem(FINALIZING_RESULT_STORAGE_KEY);
      } catch {
        // Storage is a best-effort event-race fallback only.
      }
      clearCompletionTimer();
      clearOpeningWatchdog();
      if (payload.ok && payload.viewUrl) {
        setProgress({
          stage: "uploaded",
          progress: 1,
          viewUrl: payload.viewUrl,
        });
        void claimNativeOpen(payload.recordingId).then((claimed) => {
          if (!claimed || disposed) return;
          void openExternal(payload.viewUrl as string).catch((err) => {
            console.error("[clips-finalizing] open clip failed:", err);
          });
        });
        completionTimer = window.setTimeout(() => {
          void invoke("hide_finalizing").catch(() => {});
        }, 2500);
        return;
      }

      setProgress({
        stage: "failed",
        progress: 1,
        viewUrl: payload.viewUrl,
      });
      completionTimer = window.setTimeout(() => {
        void invoke("show_popover").catch(() => {});
        void invoke("hide_finalizing").catch(() => {});
      }, 2500);
    };

    listen<NativeUploadFinished>("clips:native-upload-finished", (event) => {
      handleFinished(event.payload ?? {});
    })
      .then((u) => {
        if (disposed) {
          u();
          return;
        }
        unlistenFinished = u;
        const persisted = takePersistedFinalizingResult();
        if (persisted) {
          handleFinished(persisted);
          return;
        }
        void invoke<NativeUploadFinished | null>(
          "native_fullscreen_take_upload_finished",
        )
          .then((payload) => {
            if (payload) handleFinished(payload);
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      disposed = true;
      clearCompletionTimer();
      clearOpeningWatchdog();
      window.clearTimeout(hardWatchdog);
      unlisten?.();
      unlistenFinished?.();
    };
  }, []);

  const percent =
    typeof progress.progress === "number"
      ? Math.round(progress.progress * 100)
      : null;
  const caption =
    progress.stage === "uploaded"
      ? "Uploaded"
      : progress.stage === "failed"
        ? "Upload paused"
        : progress.stage === "uploading" ||
            progress.stage === "processing" ||
            progress.stage === "opening"
          ? "Uploading clip..."
          : "Optimizing clip...";
  const finished = progress.stage === "uploaded" || progress.stage === "failed";

  const dismiss = () => {
    void invoke("hide_finalizing").catch(() => {});
  };
  const openClip = () => {
    if (!progress.viewUrl) return;
    void openExternal(progress.viewUrl).catch((err) => {
      console.error("[clips-finalizing] open clip failed:", err);
    });
  };

  return (
    <div className="finalizing-root">
      <div className="finalizing-card">
        {progress.stage === "uploaded" ? (
          <IconCheck
            className="finalizing-status-icon finalizing-status-icon-success"
            aria-hidden="true"
          />
        ) : progress.stage === "failed" ? (
          <IconAlertCircle
            className="finalizing-status-icon finalizing-status-icon-failed"
            aria-hidden="true"
          />
        ) : (
          <div className="finalizing-spinner" aria-hidden="true" />
        )}
        <div className="finalizing-caption" aria-live="polite">
          {caption}
        </div>
        <div className="finalizing-actions">
          {progress.viewUrl ? (
            <button
              type="button"
              className="finalizing-action"
              onClick={openClip}
              aria-label="Open clip in browser"
              title="Open clip in browser"
            >
              <IconExternalLink aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="finalizing-action"
            onClick={dismiss}
            aria-label="Dismiss upload status"
            title="Dismiss"
          >
            <IconX aria-hidden="true" />
          </button>
        </div>
        {!finished ? (
          <div
            className="finalizing-progress"
            aria-label={
              percent === null ? caption : `${caption} ${percent}% complete`
            }
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <div
              className={
                percent === null
                  ? "finalizing-progress-fill finalizing-progress-fill-indeterminate"
                  : "finalizing-progress-fill"
              }
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
