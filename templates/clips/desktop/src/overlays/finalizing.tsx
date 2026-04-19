import { useEffect, useState } from "react";

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

  useEffect(() => {
    const t = setTimeout(() => setShowSecondary(true), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="finalizing-root">
      <div className="finalizing-card">
        <div className="finalizing-spinner" aria-hidden="true" />
        <div className="finalizing-caption">Finishing up your clip…</div>
        {showSecondary ? (
          <div className="finalizing-sub">Opening in browser…</div>
        ) : null}
      </div>
    </div>
  );
}
