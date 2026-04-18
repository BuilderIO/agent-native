import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Full-screen transparent countdown overlay. Runs 3 → 2 → 1, then emits
 * `clips:countdown-done` and closes its own window. The popover listens for
 * that event and kicks off MediaRecorder.
 */
export function Countdown() {
  const [n, setN] = useState(3);

  useEffect(() => {
    if (n <= 0) {
      emit("clips:countdown-done").finally(() => {
        getCurrentWindow()
          .close()
          .catch(() => {});
      });
      return;
    }
    const t = setTimeout(() => setN((v) => v - 1), 850);
    return () => clearTimeout(t);
  }, [n]);

  return (
    <div className="countdown-root">
      <div className="countdown-number" key={n}>
        {n > 0 ? n : ""}
      </div>
    </div>
  );
}
