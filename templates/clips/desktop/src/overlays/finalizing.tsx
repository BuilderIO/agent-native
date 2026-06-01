import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type NativeUploadProgress = {
  stage?: string;
  message?: string;
  detail?: string | null;
  progress?: number | null;
};

/**
 * Full-screen transparent spinner overlay. Rendered the moment the user
 * clicks Stop on the recording toolbar and kept visible until the browser
 * opens at `/r/:id`. This fills the gap between `hide_recording_chrome`
 * tearing down the toolbar + bubble and `openExternal` actually opening
 * the browser — a gap that can stretch for several seconds while
 * MediaRecorder flushes trailing chunks and the server finalize POST
 * completes.
 *
 * The window is inert (`ignore_cursor_events(true)` on the Rust side), so
 * the user physically can't click through to disrupt the finalize. The
 * recorder.ts stop path invokes `hide_finalizing` right after
 * `openExternal` to close this window.
 */
export function Finalizing() {
  // After ~3s we show a secondary "Opening in browser…" line so the user
  // sees we're still making progress if the finalize takes a while.
  const [showSecondary, setShowSecondary] = useState(false);
  const [progress, setProgress] = useState<NativeUploadProgress>({
    stage: "finalizing",
    message: "Finishing up your clip...",
    detail: null,
    progress: null,
  });

  useEffect(() => {
    const t = setTimeout(() => setShowSecondary(true), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listen<NativeUploadProgress>("clips:native-upload-progress", (event) => {
      const payload = event.payload ?? {};
      setProgress({
        stage: payload.stage,
        message: payload.message || "Finishing up your clip...",
        detail: payload.detail ?? null,
        progress:
          typeof payload.progress === "number" &&
          Number.isFinite(payload.progress)
            ? Math.min(1, Math.max(0, payload.progress))
            : null,
      });
      setShowSecondary(true);
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
  const detail =
    progress.detail ||
    (showSecondary
      ? progress.stage === "compressing"
        ? "Large recordings are re-encoded before upload."
        : progress.stage === "uploading"
          ? "Uploading to Clips now."
          : "Opening in browser..."
      : null);

  return (
    <div className="finalizing-root">
      <div className="finalizing-card">
        <div className="finalizing-spinner" aria-hidden="true" />
        <div className="finalizing-caption">{progress.message}</div>
        {percent !== null ? (
          <div className="finalizing-progress" aria-hidden="true">
            <div
              className="finalizing-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
        {detail ? (
          <div className="finalizing-sub">
            {detail}
            {percent !== null ? ` ${percent}%` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}
