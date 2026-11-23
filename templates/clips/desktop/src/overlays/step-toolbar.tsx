import { useT } from "@agent-native/core/client/i18n";
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
  saveError: string | null;
}

export function StepToolbar() {
  const [status, setStatus] = useState<StepCaptureStatus | null>(null);
  const t = useT();
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

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
  const problem = finishError ?? status?.saveError ?? null;

  const togglePause = () => {
    invoke<StepCaptureStatus>("step_capture_set_paused", { paused: !paused })
      .then(setStatus)
      .catch((error) => console.error("step capture pause failed", error));
  };

  const finish = () => {
    setFinishing(true);
    setFinishError(null);
    invoke("step_capture_finish").catch((error: unknown) => {
      console.error("step capture finish failed", error);
      setFinishError(error instanceof Error ? error.message : String(error));
      setFinishing(false);
    });
  };

  return (
    <div
      data-tw-surface
      data-tauri-drag-region
      // guard:allow-raw-color — theme-invariant capture chrome, like the recording toolbar.
      className="flex h-screen w-screen cursor-grab items-center gap-2 rounded-full bg-zinc-900/95 px-3 text-white shadow-lg ring-1 ring-white/10 select-none"
    >
      <span
        data-tauri-drag-region
        // guard:allow-raw-color — theme-invariant capture chrome, like the recording toolbar.
        className={`size-2.5 shrink-0 rounded-full ${problem || paused ? "bg-amber-400" : "animate-pulse bg-red-500"}`}
      />
      <span
        data-tauri-drag-region
        role={problem ? "alert" : undefined}
        title={problem ?? undefined}
        className="flex-1 truncate text-[13px] font-medium tabular-nums"
      >
        {finishError
          ? t("stepGuide.finishFailed")
          : status?.saveError
            ? t("stepGuide.notSaving")
            : `${paused ? t("stepGuide.paused") : t("stepGuide.recording")} · ${t("stepGuide.stepCount", { count })}`}
      </span>
      <button
        type="button"
        title={paused ? t("stepGuide.resume") : t("stepGuide.pause")}
        aria-label={paused ? t("stepGuide.resume") : t("stepGuide.pause")}
        onClick={togglePause}
        disabled={finishing}
        // guard:allow-raw-color — theme-invariant capture chrome, like the recording toolbar.
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-zinc-200 hover:bg-white/15 disabled:opacity-40 [&_svg]:size-3.5"
      >
        {paused ? <IconPlayerPlayFilled /> : <IconPlayerPauseFilled />}
      </button>
      <button
        type="button"
        onClick={finish}
        disabled={finishing}
        // guard:allow-raw-color — theme-invariant capture chrome, like the recording toolbar.
        className="inline-flex h-7 cursor-pointer items-center rounded-full bg-white px-3 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-200 disabled:opacity-60"
      >
        {finishing ? t("stepGuide.building") : t("stepGuide.done")}
      </button>
    </div>
  );
}
