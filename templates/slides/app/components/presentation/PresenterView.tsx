import { useT } from "@agent-native/core/client/i18n";
import { IconChevronLeft, IconChevronRight, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";

import { openPresentChannel, type PresentMessage } from "./present-channel";

interface PresenterViewProps {
  slides: Slide[];
  deckId: string;
  startIndex?: number;
  aspectRatio?: AspectRatio;
}

function formatElapsed(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function PresenterView({
  slides,
  deckId,
  startIndex = 0,
  aspectRatio,
}: PresenterViewProps) {
  const t = useT();
  const [index, setIndex] = useState(startIndex);
  const [elapsed, setElapsed] = useState(0);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const channel = openPresentChannel(deckId);
    channelRef.current = channel;
    if (!channel) return;
    channel.onmessage = (event: MessageEvent<PresentMessage>) => {
      if (event.data?.type === "state") setIndex(event.data.index);
    };
    channel.postMessage({ type: "hello" } satisfies PresentMessage);
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [deckId]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const send = useCallback((message: PresentMessage) => {
    channelRef.current?.postMessage(message);
  }, []);

  const goNext = useCallback(
    () => send({ type: "command", command: "next" }),
    [send],
  );
  const goPrev = useCallback(
    () => send({ type: "command", command: "prev" }),
    [send],
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          goPrev();
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev]);

  const safeSlides = useMemo(
    () => (Array.isArray(slides) ? slides.filter(Boolean) : []),
    [slides],
  );
  const current = safeSlides[index];
  const next = safeSlides[index + 1];
  const notes = current?.notes?.trim();

  return (
    <div className="fixed inset-0 flex flex-col bg-[hsl(240,6%,6%)] text-white">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3">
        <span className="font-mono text-sm text-white/50">
          {index + 1} / {safeSlides.length}
        </span>
        <span className="font-mono text-2xl tabular-nums text-white/80">
          {formatElapsed(elapsed)}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            disabled={index === 0}
            className="cursor-pointer rounded-lg bg-white/10 p-2 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={t("presentation.previousSlide")}
          >
            <IconChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goNext}
            disabled={index >= safeSlides.length - 1}
            className="cursor-pointer rounded-lg bg-white/10 p-2 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={t("presentation.nextSlide")}
          >
            <IconChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.close()}
            className="cursor-pointer rounded-lg bg-white/10 p-2 hover:bg-white/20"
            aria-label={t("presentation.closePresenterView")}
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex gap-4">
          <div className="w-2/3 overflow-hidden rounded-lg bg-black">
            {current && (
              <SlideRenderer
                slide={current}
                thumbnail
                aspectRatio={aspectRatio}
              />
            )}
          </div>
          <div className="flex w-1/3 flex-col gap-2">
            <div className="font-mono text-[11px] uppercase tracking-widest text-white/40">
              {t("presentation.upNext")}
            </div>
            {next ? (
              <div className="overflow-hidden rounded-lg bg-black">
                <SlideRenderer
                  slide={next}
                  thumbnail
                  aspectRatio={aspectRatio}
                />
              </div>
            ) : (
              <div className="rounded-lg bg-white/[0.04] p-4 text-sm text-white/40">
                {t("presentation.endOfDeck")}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-white/[0.04] p-5">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-white/40">
            {t("presentation.speakerNotes")}
          </div>
          {notes ? (
            <p className="whitespace-pre-wrap text-lg leading-relaxed text-white/90">
              {notes}
            </p>
          ) : (
            <p className="text-sm text-white/40">
              {t("presentation.noNotesForSlide")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
