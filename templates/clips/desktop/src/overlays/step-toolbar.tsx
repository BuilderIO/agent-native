import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

interface StepCaptureStatus {
  active: boolean;
  sessionId: string | null;
  directory: string | null;
  stepCount: number;
  paused: boolean;
}

/** The floating bar shown while step capture records clicks. */
export function StepToolbar() {
  const [status, setStatus] = useState<StepCaptureStatus | null>(null);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    listen<StepCaptureStatus>("step-capture:status", (event) =>
      setStatus(event.payload),
    )
      .then((stop) => {
        if (stopped) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    invoke<StepCaptureStatus>("step_capture_status")
      .then((current) => {
        if (!stopped) setStatus(current);
      })
      .catch(() => {});
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);

  const paused = status?.paused ?? false;
  const count = status?.stepCount ?? 0;

  const togglePause = () => {
    invoke<StepCaptureStatus>("step_capture_set_paused", { paused: !paused })
      .then(setStatus)
      .catch((error) => console.error("step capture pause failed", error));
  };

  const finish = () => {
    setFinishing(true);
    invoke("step_capture_finish").catch((error) => {
      console.error("step capture finish failed", error);
      setFinishing(false);
    });
  };

  return (
    <div
      data-tw-surface
      data-tauri-drag-region
      className="flex h-screen w-screen cursor-grab items-center gap-2 rounded-full bg-zinc-900/95 px-3 text-white shadow-lg ring-1 ring-white/10 select-none"
    >
      <span
        data-tauri-drag-region
        className={`size-2.5 shrink-0 rounded-full ${paused ? "bg-amber-400" : "animate-pulse bg-red-500"}`}
      />
      <span
        data-tauri-drag-region
        className="flex-1 truncate text-[13px] font-medium tabular-nums"
      >
        {paused ? "Paused" : "Recording steps"} · {count}{" "}
        {count === 1 ? "step" : "steps"}
      </span>
      <button
        type="button"
        title={paused ? "Resume" : "Pause"}
        aria-label={paused ? "Resume" : "Pause"}
        onClick={togglePause}
        disabled={finishing}
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-zinc-200 hover:bg-white/15 disabled:opacity-40 [&_svg]:size-3.5"
      >
        {paused ? <IconPlayerPlayFilled /> : <IconPlayerPauseFilled />}
      </button>
      <button
        type="button"
        onClick={finish}
        disabled={finishing}
        className="inline-flex h-7 cursor-pointer items-center rounded-full bg-white px-3 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-200 disabled:opacity-60"
      >
        {finishing ? "Building…" : "Done"}
      </button>
    </div>
  );
}
