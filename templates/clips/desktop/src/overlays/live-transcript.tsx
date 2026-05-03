import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface PartialPayload {
  text: string;
}
interface FinalPayload {
  text: string;
}

/**
 * Auto-scrolling live-transcript view. Subscribes to the same Tauri events
 * the dictation flow-bar listens for:
 *
 *   - `voice:partial-transcript` — interim hypothesis (replaces tail).
 *   - `voice:final-transcript`   — locked-in segment (appended).
 *
 * Renders the locked text in plain weight and the in-flight partial in
 * a slightly muted tone so the user can see what the recognizer is still
 * thinking about.
 */
export function LiveTranscript() {
  const [finals, setFinals] = useState<string[]>([]);
  const [partial, setPartial] = useState("");
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
        setPartial(ev.payload.text || "");
      }),
    );
    trackListen(
      listen<FinalPayload>("voice:final-transcript", (ev) => {
        const txt = (ev.payload.text || "").trim();
        if (!txt) return;
        setFinals((prev) => [...prev, txt]);
        setPartial("");
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
  }, [finals, partial]);

  return (
    <div
      ref={scrollRef}
      className="flex h-full w-full flex-col gap-1 overflow-y-auto px-3 py-2 text-[12px] leading-snug text-zinc-100"
    >
      {finals.length === 0 && !partial ? (
        <div className="text-zinc-500">Listening…</div>
      ) : null}
      {finals.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
      {partial ? <div className="text-zinc-400">{partial}</div> : null}
    </div>
  );
}
