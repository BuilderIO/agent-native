import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type Source = "mic" | "system";

interface PartialPayload {
  text: string;
  source?: Source;
}
interface FinalPayload {
  text: string;
  source?: Source;
}

interface FinalLine {
  text: string;
  source: Source;
}

/**
 * Auto-scrolling live-transcript view. Subscribes to the Tauri events that
 * both the mic recognizer (`native_speech.rs`) and the system-audio
 * recognizer (`system_audio.rs`) emit:
 *
 *   - `voice:partial-transcript` `{ text, source: "mic" | "system" }`
 *   - `voice:final-transcript`   `{ text, source: "mic" | "system" }`
 *
 * Locked-in segments are tagged with a small "you" / "speaker" pill so the
 * user can see who said what during a meeting. The in-flight partial for
 * each source is rendered separately so the two recognizers don't clobber
 * each other.
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
        setFinals((prev) => [...prev, { text: txt, source }]);
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
    <div
      ref={scrollRef}
      className="flex h-full w-full flex-col gap-1 overflow-y-auto px-3 py-2 text-[12px] leading-snug text-zinc-100"
    >
      {finals.length === 0 && !micPartial && !sysPartial ? (
        <div className="text-zinc-500">Listening…</div>
      ) : null}
      {finals.map((line, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <SourceTag source={line.source} />
          <span>{line.text}</span>
        </div>
      ))}
      {sysPartial ? (
        <div className="flex items-start gap-1.5 text-zinc-400">
          <SourceTag source="system" muted />
          <span>{sysPartial}</span>
        </div>
      ) : null}
      {micPartial ? (
        <div className="flex items-start gap-1.5 text-zinc-400">
          <SourceTag source="mic" muted />
          <span>{micPartial}</span>
        </div>
      ) : null}
    </div>
  );
}

function SourceTag({
  source,
  muted = false,
}: {
  source: Source;
  muted?: boolean;
}) {
  const isYou = source === "mic";
  const label = isYou ? "you" : "speaker";
  // Mic = warm amber, system = cool sky. Picked to read clearly against
  // the zinc-900 pill background while staying calm.
  const base = isYou
    ? "bg-amber-500/20 text-amber-200"
    : "bg-sky-500/20 text-sky-200";
  const opacity = muted ? "opacity-70" : "";
  return (
    <span
      className={`mt-0.5 shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${base} ${opacity}`}
    >
      {label}
    </span>
  );
}
