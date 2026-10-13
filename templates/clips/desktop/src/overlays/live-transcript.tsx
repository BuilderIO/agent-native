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

function historyLine(line: FinalLine): TranscriptLine {
  return {
    text: line.text,
    source: line.source,
    startMs: line.startMs ?? null,
    segments: [],
    historical: true,
  };
}

function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const PIN_SLACK_PX = 28;

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
  const pinnedRef = useRef(true);
  const preloadAppliedRef = useRef((initialLines?.length ?? 0) > 0);

  useEffect(() => {
    if (onLinesChange) onLinesChange(finals);
  }, [finals, onLinesChange]);

  useEffect(() => {
    const lines = initialLines ?? [];
    if (lines.length === 0) {
      preloadAppliedRef.current = false;
      setFinals([]);
      setMicPartial("");
      setSysPartial("");
      return;
    }
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [finals, micPartial, sysPartial]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const spokenMicPartial = useMemo(() => {
    if (!micPartial) return "";
    const inFlight: TranscriptLine[] = sysPartial
      ? [{ source: "system", text: sysPartial, startMs: null, segments: [] }]
      : [];
    return isMicEcho(micPartial, [...finals, ...inFlight]) ? "" : micPartial;
  }, [micPartial, sysPartial, finals]);

  return (
    <div
      ref={scrollRef}
      className="lt-chat"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_SLACK_PX;
      }}
    >
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
