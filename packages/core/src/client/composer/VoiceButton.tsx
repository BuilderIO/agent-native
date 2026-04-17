/**
 * Voice dictation button + recording overlay for the agent composer.
 *
 * UX mirrors Lovable: click-to-toggle record, a live amplitude bar and
 * MM:SS timer replace the editor area while recording, and a cancel X
 * discards without transcribing. The mic is always visible alongside the
 * send button (Cursor replaces send with mic; their users complain — we
 * don't copy that).
 */

import React from "react";
import {
  IconMicrophone,
  IconPlayerStopFilled,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import type { VoiceDictationApi } from "./useVoiceDictation.js";

export interface VoiceButtonProps {
  voice: VoiceDictationApi;
  isMac: boolean;
  disabled?: boolean;
}

export function VoiceButton({ voice, isMac, disabled }: VoiceButtonProps) {
  const { state, start, stop, supported } = voice;

  if (!supported) return null;

  const recording = state === "recording" || state === "starting";
  const transcribing = state === "transcribing";

  const label = recording
    ? "Stop recording"
    : transcribing
      ? "Transcribing…"
      : `Dictate (${isMac ? "⌘⇧V" : "Ctrl+Shift+V"})`;

  const onClick = () => {
    if (recording) stop();
    else if (!transcribing) void start();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || transcribing}
      title={label}
      aria-label={label}
      aria-pressed={recording}
      className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30 disabled:cursor-not-allowed ${
        recording
          ? "text-[#625DF5] bg-[#625DF5]/10 hover:bg-[#625DF5]/20"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      }`}
    >
      {transcribing ? (
        <IconLoader2 className="h-4 w-4 animate-spin" />
      ) : recording ? (
        <IconPlayerStopFilled className="h-3.5 w-3.5" />
      ) : (
        <IconMicrophone className="h-4 w-4" />
      )}
    </button>
  );
}

export interface VoiceRecordingOverlayProps {
  voice: VoiceDictationApi;
}

export function VoiceRecordingOverlay({ voice }: VoiceRecordingOverlayProps) {
  const { state, amplitude, durationMs, errorMessage, cancel } = voice;

  if (state === "error" && errorMessage) {
    return (
      <div
        role="alert"
        className="mx-2 mt-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-500"
      >
        {errorMessage}
      </div>
    );
  }

  if (state !== "recording" && state !== "starting" && state !== "transcribing")
    return null;

  return (
    <div
      className="flex items-center gap-2 mx-2 mt-2 mb-1 h-[2rem] rounded-md border border-[#625DF5]/40 bg-[#625DF5]/10 px-2"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={cancel}
        className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/40"
        title="Cancel (Esc)"
        aria-label="Cancel recording"
      >
        <IconX className="h-3 w-3" />
      </button>

      <div className="flex-1 flex items-center gap-[2px] min-w-0 h-4">
        {state === "transcribing" ? (
          <span className="text-[11px] text-muted-foreground">
            Transcribing…
          </span>
        ) : (
          <AmplitudeBars amplitude={amplitude} />
        )}
      </div>

      <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
        {state === "transcribing" ? (
          <IconLoader2 className="h-3 w-3 animate-spin" />
        ) : (
          formatDuration(durationMs)
        )}
      </span>
    </div>
  );
}

const BAR_COUNT = 24;

function AmplitudeBars({ amplitude }: { amplitude: number }) {
  // Render a symmetric meter — the middle bars peak first so the visual
  // matches what voice input looks like in Lovable / iOS dictation.
  const bars = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const centerDistance =
      Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
    const heightPct =
      Math.max(0.1, amplitude * (1 - centerDistance * 0.6)) * 100;
    bars.push(
      <span
        key={i}
        className="flex-1 rounded-full bg-[#625DF5]"
        style={{ height: `${heightPct}%`, minHeight: 2 }}
      />,
    );
  }
  return <>{bars}</>;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
