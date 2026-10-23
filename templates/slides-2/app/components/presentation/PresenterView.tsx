import { useLocale, useT } from "@agent-native/core/client/i18n";
import { useLiveTranscription } from "@agent-native/core/client/transcription/use-live-transcription";
import {
  IconChevronLeft,
  IconChevronRight,
  IconMinus,
  IconMicrophone,
  IconPlus,
  IconSquare,
  IconSun,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import {
  isInteractiveKeyboardEvent,
  isMediaKeyboardEvent,
} from "@/lib/slide-video";

import type { DesignSystemData } from "../../../shared/api";
import type { SlideTransitionType } from "../../../shared/slide-transitions";
import {
  openPresentChannel,
  type PresentBlackout,
  type PresentMessage,
} from "./present-channel";
import {
  annotateBuildSteps,
  buildClickCount,
  getBuildSteps,
} from "./slide-build-steps";
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

const NOTES_TEXT_SIZE_STORAGE_KEY = "slides-2:presenter-notes-text-size";
const NOTES_TEXT_SIZE_CLASSES = [
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
] as const;
const DEFAULT_NOTES_TEXT_SIZE_INDEX = 3;

function readNotesTextSizeIndex() {
  if (typeof window === "undefined") return DEFAULT_NOTES_TEXT_SIZE_INDEX;
  const stored = window.localStorage.getItem(NOTES_TEXT_SIZE_STORAGE_KEY);
  if (stored === null) return DEFAULT_NOTES_TEXT_SIZE_INDEX;
  const index = Number(stored);
  return Number.isSafeInteger(index) &&
    index >= 0 &&
    index < NOTES_TEXT_SIZE_CLASSES.length
    ? index
    : DEFAULT_NOTES_TEXT_SIZE_INDEX;
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
  const [blackout, setBlackout] = useState<PresentBlackout>(null);
  const blackoutRef = useRef(blackout);
  blackoutRef.current = blackout;
  const [jumpValue, setJumpValue] = useState("");
  const [notesTextSizeIndex, setNotesTextSizeIndex] = useState(
    readNotesTextSizeIndex,
  );
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
      stepCounts: buildSteps.map((steps) => buildClickCount(steps)),
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
        const wasConnected = controllerConnectedRef.current;
        controllerConnectedRef.current = true;
        setPosition({
          index: event.data.index,
          buildStep: event.data.buildStep,
        });
        if (!wasConnected) {
          channel.postMessage({
            type: "blackout",
            mode: blackoutRef.current,
          } satisfies PresentMessage);
        }
      } else if (event.data?.type === "blackout") {
        blackoutRef.current = event.data.mode;
        setBlackout(event.data.mode);
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
      if (message.type === "goto" && !controllerConnectedRef.current) {
        channel?.postMessage(message);
        setPosition({ index: message.index, buildStep: 0 });
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
  const goTo = useCallback(
    (targetIndex: number) => {
      const index = Math.max(
        0,
        Math.min(Math.trunc(targetIndex), safeSlides.length - 1),
      );
      send({ type: "goto", index });
    },
    [safeSlides.length, send],
  );
  const setBlackoutMode = useCallback((mode: PresentBlackout) => {
    blackoutRef.current = mode;
    setBlackout(mode);
    channelRef.current?.postMessage({ type: "blackout", mode });
  }, []);
  const toggleBlackout = useCallback(
    (mode: Exclude<PresentBlackout, null>) =>
      setBlackoutMode(blackoutRef.current === mode ? null : mode),
    [setBlackoutMode],
  );

  useEffect(() => {
    window.localStorage.setItem(
      NOTES_TEXT_SIZE_STORAGE_KEY,
      String(notesTextSizeIndex),
    );
  }, [notesTextSizeIndex]);

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
      if (e.defaultPrevented) return;
      if (isMediaKeyboardEvent(e) || isInteractiveKeyboardEvent(e)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // Same as the audience view: auto-repeat keydowns are not new presses.
      if (e.repeat) return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          goPrev();
          break;
        case "b":
        case "B":
          e.preventDefault();
          toggleBlackout("black");
          break;
        case "w":
        case "W":
          e.preventDefault();
          toggleBlackout("white");
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, toggleBlackout]);

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
  const requestedSlideNumber = Number(jumpValue);
  const canJumpToSlide =
    jumpValue.trim() !== "" &&
    Number.isSafeInteger(requestedSlideNumber) &&
    requestedSlideNumber >= 1 &&
    requestedSlideNumber <= safeSlides.length;

  if (safeSlides.length === 0) {
    return (
      // guard:allow-raw-color — matches the presenter's dedicated dark surface used throughout this file, not app chrome
      <div className="fixed inset-0 flex items-center justify-center bg-[hsl(240,6%,6%)] text-white">
        <Button
          type="button"
          variant="ghost"
          onClick={() => window.close()}
          // guard:allow-raw-color — matches the presenter's dedicated dark surface used throughout this file, not app chrome
          className="h-auto cursor-pointer rounded-lg bg-white/10 px-4 py-3 text-sm text-white shadow-none hover:bg-white/20 hover:text-white"
        >
          {t("presentation.noSlides")}
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-muted-foreground">
            {index + 1} / {safeSlides.length}
          </span>
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canJumpToSlide) return;
              goTo(requestedSlideNumber - 1);
              setJumpValue("");
            }}
          >
            <Input
              type="number"
              size="sm"
              min={1}
              max={safeSlides.length}
              step={1}
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value)}
              placeholder={String(index + 1)}
              aria-label={t("slides2Presenter.shortcutJump")}
              className="w-16 bg-card px-2 font-mono text-xs tabular-nums"
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              disabled={!canJumpToSlide}
              aria-label={t("slides2Presenter.shortcutJump")}
              title={t("slides2Presenter.shortcutJump")}
              className="cursor-pointer rounded-lg text-foreground shadow-none disabled:cursor-not-allowed disabled:opacity-30"
            >
              <IconChevronRight aria-hidden="true" />
            </Button>
          </form>
        </div>
        <span className="font-mono text-2xl tabular-nums text-foreground">
          {formatElapsed(elapsed)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleVoiceNavigation}
            disabled={!voiceSupported}
            title={
              !voiceSupported
                ? t("presentation.voiceNavigationUnavailable")
                : voiceError
                  ? t("presentation.voiceNavigationError")
                  : voiceCommandHint
            }
            className={`cursor-pointer rounded-lg p-2 text-foreground shadow-none disabled:cursor-not-allowed disabled:opacity-30 ${voiceActive ? voiceActiveButtonClassName : voiceIdleButtonClassName}`}
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
          </Button>
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={goPrev}
            disabled={!canCommand(navState, presenterLayout, "prev")}
            className="cursor-pointer rounded-lg bg-muted p-2 text-foreground shadow-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={t("presentation.previousSlide")}
          >
            <IconChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={goNext}
            disabled={!canCommand(navState, presenterLayout, "next")}
            className="cursor-pointer rounded-lg bg-muted p-2 text-foreground shadow-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={t("presentation.nextSlide")}
          >
            <IconChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={blackout === "black" ? "secondary" : "ghost"}
            size="icon"
            onClick={() => toggleBlackout("black")}
            aria-label={t("slides2Presenter.blackout")}
            aria-pressed={blackout === "black"}
            title={t("slides2Presenter.blackout")}
            className="cursor-pointer rounded-lg text-foreground shadow-none"
          >
            <IconSquare aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant={blackout === "white" ? "secondary" : "ghost"}
            size="icon"
            onClick={() => toggleBlackout("white")}
            aria-label={t("slides2Presenter.whiteout")}
            aria-pressed={blackout === "white"}
            title={t("slides2Presenter.whiteout")}
            className="cursor-pointer rounded-lg text-foreground shadow-none"
          >
            <IconSun aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => window.close()}
            className="cursor-pointer rounded-lg bg-muted p-2 text-foreground shadow-none hover:bg-accent"
            aria-label={t("presentation.closePresenterView")}
          >
            <IconX className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex gap-4">
          <div
            className={
              /* guard:allow-raw-color — slide previews use the fixed black stage behind transparent content. */ "relative w-2/3 overflow-hidden rounded-lg bg-black"
            }
          >
            {currentPreview && (
              <SlideRenderer
                slide={currentPreview}
                slidePosition={{ number: index + 1, count: safeSlides.length }}
                thumbnail
                aspectRatio={aspectRatio}
                designSystem={designSystem}
              />
            )}
            {blackout && (
              <div
                aria-hidden="true"
                data-presenter-blackout={blackout}
                className={
                  /* guard:allow-raw-color — blackout controls must render pure black or white. */ `absolute inset-0 grid place-items-center ${blackout === "black" ? "bg-black text-white/50" : "bg-white text-black/50"}`
                }
              >
                {blackout === "black"
                  ? t("slides2Presenter.blackout")
                  : t("slides2Presenter.whiteout")}
              </div>
            )}
          </div>
          <div className="flex w-1/3 flex-col gap-2">
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {t("presentation.upNext")}
            </div>
            {next ? (
              <div
                className={
                  /* guard:allow-raw-color — slide previews use the fixed black stage behind transparent content. */ "overflow-hidden rounded-lg bg-black"
                }
              >
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
              <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                {t("presentation.endOfDeck")}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-muted p-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {t("presentation.speakerNotes")}
            </div>
            <div
              role="group"
              aria-label={t("slides2Presenter.notesTextSize")}
              className="flex items-center gap-1"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("slides2Presenter.decreaseNotesTextSize")}
                title={t("slides2Presenter.decreaseNotesTextSize")}
                disabled={notesTextSizeIndex === 0}
                onClick={() =>
                  setNotesTextSizeIndex((size) => Math.max(0, size - 1))
                }
              >
                <IconMinus aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("slides2Presenter.increaseNotesTextSize")}
                title={t("slides2Presenter.increaseNotesTextSize")}
                disabled={
                  notesTextSizeIndex === NOTES_TEXT_SIZE_CLASSES.length - 1
                }
                onClick={() =>
                  setNotesTextSizeIndex((size) =>
                    Math.min(NOTES_TEXT_SIZE_CLASSES.length - 1, size + 1),
                  )
                }
              >
                <IconPlus aria-hidden="true" />
              </Button>
            </div>
          </div>
          {notes ? (
            <p
              className={`whitespace-pre-wrap leading-relaxed text-foreground ${NOTES_TEXT_SIZE_CLASSES[notesTextSizeIndex]}`}
            >
              {notes}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("presentation.noNotesForSlide")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
