import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type Source = "mic" | "system";

interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

interface PartialPayload {
  text: string;
  source?: Source;
}
interface FinalPayload {
  text: string;
  source?: Source;
  segments?: Segment[];
}

interface FinalLine {
  text: string;
  source: Source;
  startMs?: number;
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
export function LiveTranscript() {
  const [finals, setFinals] = useState<FinalLine[]>([]);
  const [micPartial, setMicPartial] = useState("");
  const [sysPartial, setSysPartial] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
      listen<PartialPayload>("voice:partial-transcript", (ev) => {
        const text = ev.payload.text || "";
        const source: Source = ev.payload.source ?? "mic";
        if (source === "system") setSysPartial(text);
        else setMicPartial(text);
      }),
    );
    trackListen(
      listen<FinalPayload>("voice:final-transcript", (ev) => {
        const txt = (ev.payload.text || "").trim();
        const source: Source = ev.payload.source ?? "mic";
        if (!txt) return;
        const startMs = ev.payload.segments?.[0]?.startMs;
        setFinals((prev) => [...prev, { text: txt, source, startMs }]);
        if (source === "system") setSysPartial("");
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

  return (
    <div ref={scrollRef} className="lt-chat">
      {finals.length === 0 && !micPartial && !sysPartial ? (
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
      {micPartial ? (
        <ChatBubble source="mic" text={micPartial} pending />
      ) : null}
    </div>
  );
}

/**
 * A single chat-style transcript bubble. The mic stream ("You") is aligned to
 * the right with a warm amber bubble; the system-audio stream ("Them") sits on
 * the left with a cool sky bubble. In-flight partials render dimmed.
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
  startMs?: number;
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
