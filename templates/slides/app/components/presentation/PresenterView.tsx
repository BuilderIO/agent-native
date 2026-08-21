import { useT } from "@agent-native/core/client/i18n";
import { IconChevronLeft, IconChevronRight, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";

import type { DesignSystemData } from "../../../shared/api";
import { openPresentChannel, type PresentMessage } from "./present-channel";

interface PresenterViewProps {
  slides: Slide[];
  deckId: string;
  startIndex?: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
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
  designSystem,
}: PresenterViewProps) {
  const t = useT();
  // `startIndex` is a raw index into the full (unfiltered) deck.slides array.
  // Skipped slides are absent from safeSlides below, so translate it to the
  // nearest visible slide's position within safeSlides — matching
  // PresentationView, whose filtered currentIndex this view's `index` state
  // otherwise mirrors via the BroadcastChannel.
  const initialIndex = useMemo(() => {
    const rawSlides = (Array.isArray(slides) ? slides : []).filter(Boolean);
    if (rawSlides.length === 0) return 0;
    const clampedRaw = Math.max(0, Math.min(startIndex, rawSlides.length - 1));
    for (let i = clampedRaw; i < rawSlides.length; i++) {
      if (!rawSlides[i]?.skipped) {
        return rawSlides.slice(0, i).filter((s) => !s?.skipped).length;
      }
    }
    for (let i = clampedRaw - 1; i >= 0; i--) {
      if (!rawSlides[i]?.skipped) {
        return rawSlides.slice(0, i).filter((s) => !s?.skipped).length;
      }
    }
    return 0;
  }, [slides, startIndex]);
  const [index, setIndex] = useState(initialIndex);
  const [elapsed, setElapsed] = useState(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;

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
    () =>
      Array.isArray(slides)
        ? slides.filter(
            (slide): slide is Slide => Boolean(slide) && !slide.skipped,
          )
        : [],
    [slides],
  );

  // One atomic effect handles both cases so they can't race each other:
  // - A genuine deep link or deck switch (startIndex/deckId changed) reseeds
  //   from initialIndex. This route is reused across decks (see the
  //   BroadcastChannel effect above, keyed on deckId).
  // - Otherwise, a skip toggle or reorder changed safeSlides without a new
  //   deep link. A length-only clamp would silently swap in a different
  //   slide at the same index, so follow the previously-shown slide's id to
  //   its new position, falling back to a raw clamp only when it's gone.
  const prevDeepLinkKeyRef = useRef({ startIndex, deckId });
  const prevSafeSlideIdsRef = useRef<string[]>(safeSlides.map((s) => s.id));
  useEffect(() => {
    const prevKey = prevDeepLinkKeyRef.current;
    const isDeepLinkChange =
      prevKey.startIndex !== startIndex || prevKey.deckId !== deckId;
    prevDeepLinkKeyRef.current = { startIndex, deckId };

    if (isDeepLinkChange) {
      prevSafeSlideIdsRef.current = safeSlides.map((s) => s.id);
      setIndex(initialIndex);
      return;
    }

    // Read the prior ids before overwriting the ref below — the lookup
    // needs the slide order from before this update, not the one it's
    // producing.
    const activeId = prevSafeSlideIdsRef.current[indexRef.current];
    const newIds = safeSlides.map((s) => s.id);
    const followedIndex = activeId ? newIds.indexOf(activeId) : -1;
    prevSafeSlideIdsRef.current = newIds;
    setIndex(
      followedIndex >= 0
        ? followedIndex
        : Math.max(0, Math.min(indexRef.current, safeSlides.length - 1)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSlides, startIndex, deckId]);

  const current = safeSlides[index];
  const next = safeSlides[index + 1];
  const notes = current?.notes?.trim();

  if (safeSlides.length === 0) {
    return (
      // guard:allow-raw-color — matches the presenter's dedicated dark surface used throughout this file, not app chrome
      <div className="fixed inset-0 flex items-center justify-center bg-[hsl(240,6%,6%)] text-white">
        <button
          type="button"
          onClick={() => window.close()}
          // guard:allow-raw-color — matches the presenter's dedicated dark surface used throughout this file, not app chrome
          className="cursor-pointer rounded-lg bg-white/10 px-4 py-3 text-sm hover:bg-white/20"
        >
          {t("presentation.noSlides")}
        </button>
      </div>
    );
  }

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
                designSystem={designSystem}
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
                  designSystem={designSystem}
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
