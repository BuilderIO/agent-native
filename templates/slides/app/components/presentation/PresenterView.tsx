import { useLocale, useT } from "@agent-native/core/client/i18n";
import { useLiveTranscription } from "@agent-native/core/client/transcription/use-live-transcription";
import {
  IconChevronLeft,
  IconChevronRight,
  IconMicrophone,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import {
  isInteractiveKeyboardEvent,
  isMediaKeyboardEvent,
} from "@/lib/slide-video";

import type { DesignSystemData } from "../../../shared/api";
import type { SlideTransitionType } from "../../../shared/slide-transitions";
import { openPresentChannel, type PresentMessage } from "./present-channel";
import { annotateBuildSteps, getBuildSteps } from "./slide-build-steps";
import {
  canCommand,
  createSlideNavigation,
  reduceSlideNavigation,
  type SlideNavigationLayout,
  type SlideNavigationState,
} from "./slide-navigation";
import {
  hasVoiceNavigationPartialExpired,
  matchVoiceNavigationPhrase,
} from "./voice-navigation";

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

// The presenter holds no flight, only the settled position it mirrors.
function presenterNavState(position: {
  index: number;
  buildStep: number;
}): SlideNavigationState {
  return {
    ...createSlideNavigation(position.index),
    buildStep: position.buildStep,
  };
}

export default function PresenterView({
  slides,
  deckId,
  startIndex = 0,
  aspectRatio,
  designSystem,
}: PresenterViewProps) {
  const t = useT();
  const { locale } = useLocale();
  const {
    supported: voiceSupported,
    isActive: voiceActive,
    transcript: voiceTranscript,
    start: startVoiceTranscription,
    stop: stopVoiceTranscription,
    getIncompleteReason,
  } = useLiveTranscription({ lang: locale });
  const [voiceError, setVoiceError] = useState(false);
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
  // The index and build step move together, so one update can take both.
  const [position, setPosition] = useState({
    index: initialIndex,
    buildStep: 0,
  });
  const index = position.index;
  const [elapsed, setElapsed] = useState(0);
  const safeSlides = useMemo(
    () =>
      Array.isArray(slides)
        ? slides.filter(
            (slide): slide is Slide => Boolean(slide) && !slide.skipped,
          )
        : [],
    [slides],
  );
  const buildSteps = useMemo(
    () => safeSlides.map((slide) => getBuildSteps(slide).steps),
    [safeSlides],
  );
  // The presenter animates nothing, so each press commits at its boundary.
  const presenterLayout = useMemo<SlideNavigationLayout>(
    () => ({
      stepCounts: buildSteps.map((steps) => steps.length),
      transitions: buildSteps.map((): SlideTransitionType => "none"),
    }),
    [buildSteps],
  );
  const channelRef = useRef<BroadcastChannel | null>(null);
  const controllerConnectedRef = useRef(false);
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const channel = openPresentChannel(deckId);
    channelRef.current = channel;
    controllerConnectedRef.current = false;
    if (!channel) return;
    channel.onmessage = (event: MessageEvent<PresentMessage>) => {
      if (event.data?.type === "state") {
        controllerConnectedRef.current = true;
        setPosition({
          index: event.data.index,
          buildStep: event.data.buildStep,
        });
      } else if (event.data?.type === "bye") {
        controllerConnectedRef.current = false;
      }
    };
    channel.postMessage({ type: "hello" } satisfies PresentMessage);
    return () => {
      channel.close();
      channelRef.current = null;
      controllerConnectedRef.current = false;
    };
  }, [deckId]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const send = useCallback(
    (message: PresentMessage) => {
      const channel = channelRef.current;
      if (message.type === "command" && !controllerConnectedRef.current) {
        channel?.postMessage(message);
        // With no audience to report back, the presenter moves itself by the
        // audience's own rule: a press reveals the next build before it advances.
        setPosition((current) => {
          const next = reduceSlideNavigation(
            presenterNavState(current),
            { type: "command", command: message.command },
            presenterLayout,
          );
          if (
            next.displayedIndex === current.index &&
            next.buildStep === current.buildStep
          ) {
            return current;
          }
          return { index: next.displayedIndex, buildStep: next.buildStep };
        });
        return;
      }
      // Connected: this is a relay only. The audience applies the command once
      // and reports its new state back, so nothing here steps the presenter.
      channel?.postMessage(message);
    },
    [presenterLayout],
  );

  const goNext = useCallback(
    () => send({ type: "command", command: "next" }),
    [send],
  );
  const goPrev = useCallback(
    () => send({ type: "command", command: "prev" }),
    [send],
  );

  const nextVoiceCommand = t("presentation.voiceNavigationNextCommand");
  const previousVoiceCommand = t("presentation.voiceNavigationPreviousCommand");
  const voiceCommandHint = t("presentation.voiceNavigationHint", {
    next: nextVoiceCommand,
    previous: previousVoiceCommand,
  });
  // guard:allow-raw-color — presenter controls stay legible on the dedicated dark stage.
  const voiceActiveButtonClassName = "bg-white/25 ring-1 ring-white/40";
  // guard:allow-raw-color — presenter controls stay legible on the dedicated dark stage.
  const voiceIdleButtonClassName = "bg-white/10 hover:bg-white/20";
  const voiceStatusClassName =
    // guard:allow-raw-color — presenter status stays legible on the dedicated dark stage.
    "sr-only min-w-0 max-w-48 truncate text-xs text-white/60 md:not-sr-only";
  const lastTranscriptRef = useRef("");
  const pendingVoicePhraseRef = useRef("");
  const pendingVoicePhraseAtRef = useRef<number | null>(null);

  const toggleVoiceNavigation = useCallback(() => {
    if (voiceActive) {
      stopVoiceTranscription();
      lastTranscriptRef.current = voiceTranscript;
      pendingVoicePhraseRef.current = "";
      pendingVoicePhraseAtRef.current = null;
      setVoiceError(false);
      return;
    }

    lastTranscriptRef.current = "";
    pendingVoicePhraseRef.current = "";
    pendingVoicePhraseAtRef.current = null;
    setVoiceError(false);
    startVoiceTranscription();
    if (getIncompleteReason()) setVoiceError(true);
  }, [
    getIncompleteReason,
    startVoiceTranscription,
    stopVoiceTranscription,
    voiceActive,
    voiceTranscript,
  ]);

  useEffect(() => {
    if (!voiceActive && getIncompleteReason()) setVoiceError(true);
  }, [getIncompleteReason, voiceActive]);

  useEffect(() => {
    if (!voiceActive) {
      lastTranscriptRef.current = voiceTranscript;
      pendingVoicePhraseRef.current = "";
      pendingVoicePhraseAtRef.current = null;
      return;
    }

    const previousTranscript = lastTranscriptRef.current;
    const addition = voiceTranscript.startsWith(previousTranscript)
      ? voiceTranscript.slice(previousTranscript.length)
      : voiceTranscript;
    lastTranscriptRef.current = voiceTranscript;
    if (!addition.trim()) return;

    const now = Date.now();
    if (
      pendingVoicePhraseAtRef.current !== null &&
      hasVoiceNavigationPartialExpired(pendingVoicePhraseAtRef.current, now)
    ) {
      pendingVoicePhraseRef.current = "";
      pendingVoicePhraseAtRef.current = null;
    }
    const candidate = pendingVoicePhraseRef.current + addition;
    const match = matchVoiceNavigationPhrase(candidate, {
      next: nextVoiceCommand,
      previous: previousVoiceCommand,
    });
    const additionMatch = matchVoiceNavigationPhrase(addition, {
      next: nextVoiceCommand,
      previous: previousVoiceCommand,
    });
    const commandMatch = match.type === "command" ? match : additionMatch;
    if (commandMatch.type === "command") {
      pendingVoicePhraseRef.current = "";
      pendingVoicePhraseAtRef.current = null;
      if (commandMatch.command === "next") goNext();
      else goPrev();
    } else if (additionMatch.type === "partial") {
      pendingVoicePhraseRef.current = addition;
      pendingVoicePhraseAtRef.current = now;
    } else if (match.type === "partial") {
      pendingVoicePhraseRef.current = candidate;
      pendingVoicePhraseAtRef.current = now;
    } else {
      pendingVoicePhraseRef.current = "";
      pendingVoicePhraseAtRef.current = null;
    }
  }, [
    goNext,
    goPrev,
    nextVoiceCommand,
    previousVoiceCommand,
    voiceActive,
    voiceTranscript,
  ]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (isMediaKeyboardEvent(e) || isInteractiveKeyboardEvent(e)) return;
      // Same as the audience view: auto-repeat keydowns are not new presses.
      if (e.repeat) return;
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
      setPosition({ index: initialIndex, buildStep: 0 });
      return;
    }

    const activeId = prevSafeSlideIdsRef.current[indexRef.current];
    const newIds = safeSlides.map((s) => s.id);
    const followedIndex = activeId ? newIds.indexOf(activeId) : -1;
    prevSafeSlideIdsRef.current = newIds;
    const nextIndex =
      followedIndex >= 0
        ? followedIndex
        : Math.max(0, Math.min(indexRef.current, safeSlides.length - 1));
    setPosition((current) => ({ ...current, index: nextIndex }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSlides, startIndex, deckId]);

  const current = safeSlides[index];
  const next = safeSlides[index + 1];
  // A button is enabled exactly when its key press would move the presenter.
  const navState = presenterNavState(position);
  const notes = current?.notes?.trim();
  // The same annotation the audience renders, at the audience's build step.
  const currentPreview = useMemo(
    () =>
      current &&
      annotateBuildSteps(current, buildSteps[index], position.buildStep),
    [buildSteps, current, index, position.buildStep],
  );

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
            type="button"
            onClick={toggleVoiceNavigation}
            disabled={!voiceSupported}
            title={
              !voiceSupported
                ? t("presentation.voiceNavigationUnavailable")
                : voiceError
                  ? t("presentation.voiceNavigationError")
                  : voiceCommandHint
            }
            className={`cursor-pointer rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-30 ${voiceActive ? voiceActiveButtonClassName : voiceIdleButtonClassName}`}
            aria-label={t("presentation.voiceNavigation")}
            aria-description={
              !voiceSupported
                ? t("presentation.voiceNavigationUnavailable")
                : voiceError
                  ? t("presentation.voiceNavigationError")
                  : voiceCommandHint
            }
            aria-pressed={voiceActive}
          >
            <IconMicrophone className="h-4 w-4" aria-hidden="true" />
          </button>
          <span
            role="status"
            aria-live="polite"
            className={voiceStatusClassName}
          >
            {voiceError
              ? t("presentation.voiceNavigationError")
              : voiceActive
                ? t("presentation.voiceNavigationListening", {
                    next: nextVoiceCommand,
                    previous: previousVoiceCommand,
                  })
                : !voiceSupported
                  ? t("presentation.voiceNavigationUnavailable")
                  : ""}
          </span>
          <button
            onClick={goPrev}
            disabled={!canCommand(navState, presenterLayout, "prev")}
            className="cursor-pointer rounded-lg bg-white/10 p-2 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={t("presentation.previousSlide")}
          >
            <IconChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goNext}
            disabled={!canCommand(navState, presenterLayout, "next")}
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
            {currentPreview && (
              <SlideRenderer
                slide={currentPreview}
                slidePosition={{ number: index + 1, count: safeSlides.length }}
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
                  slidePosition={{
                    number: index + 2,
                    count: safeSlides.length,
                  }}
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
