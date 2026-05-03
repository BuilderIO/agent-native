/**
 * Granola-style auto-record prompt banner.
 *
 * Appears at the top of the meeting detail page when the meeting's
 * `scheduledStart` is within ±2 minutes of now and `actualStart` is null.
 *
 * Behavior (matches Granola: "starts at calendar time if you're viewing the
 * event"):
 *   1. Banner appears — primary "Start recording" button.
 *   2. After 30 seconds of no interaction, recording auto-starts.
 *   3. For the first 5 seconds after auto-fire, a "Cancel" link is visible
 *      so the user can abort if they didn't notice.
 *
 * The banner does not auto-start when the user has manually dismissed it.
 */

import { useEffect, useState } from "react";
import { IconClock, IconPlayerRecord, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useAutoFireCountdown,
  useAutoRecord,
} from "@/hooks/use-auto-record";

interface AutoRecordPromptProps {
  scheduledStart?: string | null;
  actualStart?: string | null;
  /** Called when the user (or auto-fire) starts the recording. */
  onStart: () => void;
  /** Called when the user dismisses the banner. */
  onDismiss?: () => void;
  /** Disable the auto-fire countdown (e.g. while another action is pending). */
  disabled?: boolean;
}

export function AutoRecordPrompt({
  scheduledStart,
  actualStart,
  onStart,
  onDismiss,
  disabled = false,
}: AutoRecordPromptProps) {
  const [dismissed, setDismissed] = useState(false);
  const [autoFired, setAutoFired] = useState(false);
  const [graceRemaining, setGraceRemaining] = useState(0);

  const auto = useAutoRecord({ scheduledStart, actualStart });

  const armed = auto.inWindow && !dismissed && !disabled && !autoFired;

  const { secondsRemaining, cancel, cancelled } = useAutoFireCountdown({
    armed,
    durationMs: 30_000,
    onFire: () => {
      setAutoFired(true);
      setGraceRemaining(5);
      onStart();
    },
  });

  // 5-second cancel grace after auto-fire — counts down independently.
  useEffect(() => {
    if (graceRemaining <= 0) return;
    const id = setInterval(() => {
      setGraceRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [graceRemaining]);

  if (!auto.inWindow && !autoFired) return null;
  if (dismissed && !autoFired) return null;

  const handleDismiss = () => {
    cancel();
    setDismissed(true);
    onDismiss?.();
  };

  if (autoFired && graceRemaining > 0) {
    return (
      <div
        className={cn(
          "mb-4 flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2",
          "animate-in fade-in slide-in-from-top-1 duration-300",
        )}
        role="status"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        <span className="text-sm">Recording started.</span>
        <button
          type="button"
          onClick={cancel}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
        >
          Cancel ({graceRemaining}s)
        </button>
      </div>
    );
  }

  if (cancelled) return null;

  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5",
        "animate-in fade-in slide-in-from-top-1 duration-300",
      )}
      role="alert"
    >
      <IconClock className="h-4 w-4 shrink-0 text-primary" />
      <span className="text-sm font-medium">
        It's time for this meeting — start recording?
      </span>
      <span className="text-xs text-muted-foreground">
        Auto-starts in {secondsRemaining}s
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            cancel();
            onStart();
          }}
          className="cursor-pointer h-8 gap-1.5"
        >
          <IconPlayerRecord className="h-3.5 w-3.5" />
          Start recording
        </Button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 cursor-pointer"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
