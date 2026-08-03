import { useEffect, useMemo, useRef, useState } from "react";

import {
  appendFinalTranscript,
  isMicEcho,
  onFinalTranscript,
  onPartialTranscript,
  type TranscriptLine,
} from "../lib/transcription-engine";

type Source = "mic" | "system";

export interface FinalLine {
  text: string;
  source: Source;
  startMs?: number;
}

/** Preloaded history arrives without its verbatim segments. */
function historyLine(line: FinalLine): TranscriptLine {
  return {
    text: line.text,
    source: line.source,
    startMs: line.startMs ?? null,
    segments: [],
    historical: true,
  };
}

/** Format ms since meeting start as m:ss. */
function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Auto-scrolling live-transcript view. Subscribes to the Tauri events that
 * the local Whisper meeting engine (`whisper_speech.rs`) emits for both the
 * mic and system-audio streams:
 *
 *   - `voice:partial-transcript` `{ text, source: "mic" | "system" }`
 *   - `voice:final-transcript`   `{ text, source: "mic" | "system" }`
 *
 * Locked-in segments are tagged with a small "You" (mic) / "Them" (system)
 * pill so the user can see who said what during a meeting. The in-flight
 * partial for each source is rendered separately so the two streams don't
 * clobber each other.
 */
export function LiveTranscript({
  onLinesChange,
  initialLines,
}: {
  onLinesChange?: (lines: TranscriptLine[]) => void;
  initialLines?: FinalLine[];
} = {}) {
  const [finals, setFinals] = useState<TranscriptLine[]>(
    () => initialLines?.map(historyLine) ?? [],
  );
  const [micPartial, setMicPartial] = useState("");
  const [sysPartial, setSysPartial] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the current session's preloaded history has been merged in. Guards
  // against the preload event firing more than once (the host emits it on both
  // the get-meeting fetch and clips:pill-ready), which would duplicate lines.
  const preloadAppliedRef = useRef((initialLines?.length ?? 0) > 0);

  useEffect(() => {
    if (onLinesChange) onLinesChange(finals);
  }, [finals, onLinesChange]);

  useEffect(() => {
    const lines = initialLines ?? [];
    // Empty = pill context reset for a new meeting: clear everything.
    if (lines.length === 0) {
      preloadAppliedRef.current = false;
      setFinals([]);
      setMicPartial("");
      setSysPartial("");
      return;
    }
    // Preloaded history arrived. Apply once, and PREPEND so any live lines that
    // were captured before the async preload resolved are kept (after the
    // older history), instead of being overwritten.
    if (preloadAppliedRef.current) return;
    preloadAppliedRef.current = true;
    setFinals((prev) => [...lines.map(historyLine), ...prev]);
  }, [initialLines]);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;

    const trackListen = (p: Promise<() => void>) => {
      p.then((u) => {
        if (stopped) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {});
    };

    trackListen(
      onPartialTranscript(({ text, source }) => {
        if (source === "system") setSysPartial(text);
        else setMicPartial(text);
      }),
    );
    trackListen(
      onFinalTranscript((event) => {
        if (!event.text.trim()) return;
        setFinals((prev) => {
          const next = [...prev];
          return appendFinalTranscript(event, next) ? next : prev;
        });
        if (event.source === "system") setSysPartial("");
        else setMicPartial("");
      }),
    );

    return () => {
      stopped = true;
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
    };
  }, []);

  // Auto-scroll the container to the bottom whenever new text lands.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [finals, micPartial, sysPartial]);

  // Partials never reach `appendFinalTranscript`, so speaker bleed shows up
  // here as a live "You" bubble mirroring what the remote side is still
  // saying. Judge the in-flight mic text against the in-flight system text too,
  // since neither has been committed to a line yet.
  const spokenMicPartial = useMemo(() => {
    if (!micPartial) return "";
    const inFlight: TranscriptLine[] = sysPartial
      ? [{ source: "system", text: sysPartial, startMs: null, segments: [] }]
      : [];
    return isMicEcho(micPartial, [...finals, ...inFlight]) ? "" : micPartial;
  }, [micPartial, sysPartial, finals]);

  return (
    <div ref={scrollRef} className="lt-chat">
      {finals.length === 0 && !spokenMicPartial && !sysPartial ? (
        <div className="lt-empty">Listening…</div>
      ) : null}
      {finals.map((line, i) => (
        <ChatBubble
          key={i}
          source={line.source}
          text={line.text}
          startMs={line.startMs}
        />
      ))}
      {sysPartial ? (
        <ChatBubble source="system" text={sysPartial} pending />
      ) : null}
      {spokenMicPartial ? (
        <ChatBubble source="mic" text={spokenMicPartial} pending />
      ) : null}
    </div>
  );
}

/**
 * A single chat-style transcript bubble. The mic stream ("You") is aligned to
 * the right; the system-audio stream ("Them") sits on the left. Both use
 * neutral greys — side, not hue, is what distinguishes the speakers. In-flight
 * partials render dimmed.
 */
function ChatBubble({
  source,
  text,
  pending = false,
  startMs,
}: {
  source: Source;
  text: string;
  pending?: boolean;
  startMs?: number | null;
}) {
  const isYou = source === "mic";
  const label = isYou ? "You" : "Them";
  const rowClass = `lt-row ${isYou ? "lt-row-you" : "lt-row-them"}${
    pending ? " lt-row-pending" : ""
  }`;
  return (
    <div className={rowClass}>
      <span className="lt-label">
        {label}
        {typeof startMs === "number" && !pending ? (
          <span className="lt-time">{formatTimestamp(startMs)}</span>
        ) : null}
      </span>
      <span className="lt-bubble">{text}</span>
    </div>
  );
}
