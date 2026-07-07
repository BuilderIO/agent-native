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
};

type NativeUploadFinished = {
  recordingId?: string;
  ok?: boolean;
  viewUrl?: string;
  error?: string | null;
  localFilePath?: string | null;
};

/**
 * Full-screen transparent feedback overlay. Rendered the moment the user
 * clicks Stop on the recording toolbar and kept visible until the browser
 * opens at `/r/:id`. This fills the gap between `hide_recording_chrome`
 * tearing down the toolbar + bubble and `openExternal` actually opening
 * the browser — a gap that can stretch for several seconds while
 * MediaRecorder flushes trailing chunks and the server finalize POST
 * completes.
 *
 * The window ignores cursor events on the Rust side, so the compact
 * bottom-left card does not block the user's screen while compression or
 * upload continues. The recorder.ts stop path invokes `hide_finalizing`
 * right after `openExternal` to close this window.
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
      clearCompletionTimer();
      clearOpeningWatchdog();
      if (payload.ok && payload.viewUrl) {
        setProgress({ stage: "opening", progress: 1 });
        completionTimer = window.setTimeout(() => {
          void claimNativeOpen(payload.recordingId).then((claimed) => {
            if (!claimed || disposed) return;
            void openExternal(payload.viewUrl as string).catch(() => {});
            void invoke("hide_finalizing").catch(() => {});
          });
        }, 1500);
        return;
      }

      setProgress({ stage: "failed", progress: 1 });
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
      unlisten?.();
      unlistenFinished?.();
    };
  }, []);

  const percent =
    typeof progress.progress === "number"
      ? Math.round(progress.progress * 100)
      : null;
  const caption =
    progress.stage === "uploading" ||
    progress.stage === "processing" ||
    progress.stage === "opening"
      ? "Uploading clip..."
      : progress.stage === "failed"
        ? "Upload paused"
        : "Optimizing clip...";

  return (
    <div className="finalizing-root">
      <div className="finalizing-card">
        <div className="finalizing-spinner" aria-hidden="true" />
        <div className="finalizing-caption">{caption}</div>
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
      </div>
    </div>
  );
}
