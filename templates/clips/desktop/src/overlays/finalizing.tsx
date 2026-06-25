import { listen } from "@tauri-apps/api/event";
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
    listen<NativeUploadProgress>("clips:native-upload-progress", (event) => {
      const payload = event.payload ?? {};
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
    return () => {
      disposed = true;
      unlisten?.();
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
