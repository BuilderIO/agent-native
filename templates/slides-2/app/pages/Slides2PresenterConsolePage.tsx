import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconRotateClockwise,
  IconSquare,
  IconSun,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import {
  getPresenterConsoleCommand,
  isPresenterTypingTarget,
} from "@/components/slides-2-presenter/keyboard";
import {
  clampPresenterIndex,
  useSlides2PresenterChannel,
  type Slides2PresenterMessage,
  type Slides2PresenterState,
  type PresenterBlackout,
} from "@/components/slides-2-presenter/presenter-channel";
import { usePresenterActionBridge } from "@/components/slides-2-presenter/use-presenter-action-bridge";
import type { SlideRenderArtifact } from "@/components/slides-2-runtime/protocol";
import { SandboxedSlide } from "@/components/slides-2-runtime/SandboxedSlide";
import { Slides2Canvas } from "@/components/slides-2-runtime/Slides2Canvas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TAB_ID } from "@/lib/tab-id";

type SlideReference = {
  id: string;
  skipped?: unknown;
};

type PresenterDeckOption = {
  id: string;
  title: string;
  previewSlide?: unknown;
  previewTooLarge?: boolean;
};

type PresenterDeckList = {
  decks: PresenterDeckOption[];
  nextCursor?: string;
};

const NOTES_TEXT_SIZE_STORAGE_KEY = "slides-2:presenter-notes-text-size";
const NOTES_TEXT_SIZE_CLASSES = [
  "text-xs",
  "text-[13.5px]",
  "text-base",
  "text-lg",
  "text-xl",
] as const;
const DEFAULT_NOTES_TEXT_SIZE_INDEX = 1;

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

function visibleIndexForRawPosition(
  rawIndex: number,
  visibleRawIndexes: number[],
) {
  if (visibleRawIndexes.length === 0) return 0;
  const position = Number.isFinite(rawIndex) ? Math.max(0, rawIndex) : 0;
  const nextVisibleIndex = visibleRawIndexes.findIndex(
    (visibleRawIndex) => visibleRawIndex >= position,
  );
  return nextVisibleIndex >= 0
    ? nextVisibleIndex
    : visibleRawIndexes.length - 1;
}

function getPreviewSlideId(
  deck: PresenterDeckOption | null,
): string | undefined {
  const preview = deck?.previewSlide;
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) {
    return undefined;
  }
  const slideId = (preview as { id?: unknown }).id;
  return typeof slideId === "string" && slideId ? slideId : undefined;
}

function writeState(key: string, value: unknown) {
  void writeClientAppState(key, value, {
    keepalive: true,
    requestSource: TAB_ID,
  }).catch((error) =>
    console.error(`Could not update application state "${key}".`, error),
  );
}

function useSlidePreview(deckId: string, slideId: string | undefined) {
  const sourceQuery = useActionQuery(
    "get-slide-source",
    { deckId, slideId: slideId ?? "" },
    { enabled: Boolean(deckId && slideId) },
  );
  const source = sourceQuery.data?.slide;
  const renderQuery = useActionQuery(
    "get-slide-render",
    {
      deckId,
      slideId: source?.id ?? "",
      expectedRevision: source?.revision,
      expectedSourceHash: source?.sourceHash,
    },
    {
      enabled: Boolean(
        deckId && source?.id && source.revision && source.sourceHash,
      ),
    },
  );

  return {
    source,
    artifact: renderQuery.data as SlideRenderArtifact | undefined,
    loading: sourceQuery.isLoading || Boolean(source && renderQuery.isLoading),
    failed: Boolean(sourceQuery.error || renderQuery.error),
  };
}

function SlidePreview({
  artifact,
  failed,
  loading,
  title,
  blackout,
  initialRevealedSteps,
  className,
}: {
  artifact: SlideRenderArtifact | undefined;
  failed: boolean;
  loading: boolean;
  title: string;
  blackout?: PresenterBlackout;
  initialRevealedSteps?: number | null;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      className={
        /* guard:allow-raw-color — presenter preview renders on the theme-independent black stage. */ `relative overflow-hidden rounded-md bg-black ring-1 ring-border ${className ?? "aspect-video"}`
      }
    >
      {artifact ? (
        <Slides2Canvas flat>
          <SandboxedSlide
            artifact={artifact}
            title={title}
            onNodes={() => {}}
            onPointer={() => {}}
            initialRevealedSteps={initialRevealedSteps}
          />
        </Slides2Canvas>
      ) : (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-muted-foreground">
          {loading ? (
            <div
              className="h-2 w-24 animate-pulse rounded bg-muted"
              aria-hidden="true"
            />
          ) : failed ? (
            t("presentation.loadFailed")
          ) : null}
        </div>
      )}
      {blackout && (
        <div
          aria-hidden="true"
          className={
            blackout === "black"
              ? /* guard:allow-raw-color — blackout must render fully black. */ "absolute inset-0 bg-black"
              : /* guard:allow-raw-color — whiteout must render fully white. */ "absolute inset-0 bg-white"
          }
        />
      )}
    </div>
  );
}

function CurrentClock() {
  const t = useT();
  const formatters = useFormatters();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <time
      dateTime={new Date(now).toISOString()}
      title={t("slides2Presenter.currentTime")}
      className="font-mono text-xs tabular-nums text-muted-foreground"
    >
      {formatters.formatDate(now, {
        hour: "numeric",
        minute: "2-digit",
      })}
    </time>
  );
}

function ElapsedTimer({
  startedAt,
  resetAt,
}: {
  startedAt: number;
  resetAt: number | null;
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const elapsed = Math.max(
    0,
    Math.floor((now - Math.max(startedAt, resetAt ?? startedAt)) / 1000),
  );
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  const value =
    hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;

  return (
    <time
      title={t("slides2Presenter.elapsedTime")}
      className="font-mono text-base tabular-nums text-foreground"
    >
      {value}
    </time>
  );
}

export default function Slides2PresenterConsolePage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const formatters = useFormatters();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [deckSearch, setDeckSearch] = useState("");
  const [focusedDeckId, setFocusedDeckId] = useState(id ?? "");
  const deckQuery = useActionQuery(
    "get-deck",
    { id: id ?? "", compact: "true" },
    { enabled: Boolean(id) },
  );
  const deck = deckQuery.data;
  const rawSlides: SlideReference[] = deck?.slides ?? [];
  const visibleRawIndexes = useMemo(
    () =>
      rawSlides.flatMap((slide, rawIndex) =>
        slide.skipped === true ? [] : [rawIndex],
      ),
    [rawSlides],
  );
  const slides = useMemo(
    () => visibleRawIndexes.map((rawIndex) => rawSlides[rawIndex]),
    [rawSlides, visibleRawIndexes],
  );
  const deckListQuery = useActionQuery(
    "list-decks",
    {
      includePreview: "true",
      limit: 12,
      search: deckSearch.trim(),
    },
    { enabled: deckPickerOpen },
  );
  const deckList = deckListQuery.data as PresenterDeckList | undefined;
  const pickerDecks = deckList?.decks ?? [];
  const currentDeckOption: PresenterDeckOption | null = deck
    ? {
        id: id ?? "",
        title: deck.title,
        previewSlide: slides[0] ? { id: slides[0].id } : undefined,
        previewTooLarge: false,
      }
    : null;
  const focusedDeck =
    pickerDecks.find((pickerDeck) => pickerDeck.id === focusedDeckId) ??
    (focusedDeckId === id ? currentDeckOption : null) ??
    pickerDecks[0] ??
    null;
  const pickerPreviewSlideId = getPreviewSlideId(focusedDeck);
  const pickerPreview = useSlidePreview(
    focusedDeck?.id ?? "",
    pickerPreviewSlideId,
  );
  const requestedSlide = Number.parseInt(searchParams.get("slide") ?? "1", 10);
  const requestedRawIndex = Number.isFinite(requestedSlide)
    ? requestedSlide - 1
    : 0;
  const requestedIndex = visibleIndexForRawPosition(
    requestedRawIndex,
    visibleRawIndexes,
  );
  const [localBlackout, setLocalBlackout] = useState<PresenterBlackout>(null);
  const [localStart] = useState(() => Date.now());
  const [timerResetAt, setTimerResetAt] = useState<number | null>(null);
  const [notesTextSizeIndex, setNotesTextSizeIndex] = useState(
    readNotesTextSizeIndex,
  );
  const [jumpValue, setJumpValue] = useState("");
  const [receivedState, setReceivedState] = useState<{
    deckId: string;
    state: Slides2PresenterState;
    receivedAt: number;
  } | null>(null);
  const onMessage = useCallback(
    (message: Slides2PresenterMessage) => {
      if (message.type === "state" && id) {
        setReceivedState({
          deckId: id,
          state: message.state,
          receivedAt: Date.now(),
        });
      }
    },
    [id],
  );
  const channel = useSlides2PresenterChannel(id ?? "", onMessage);
  const connectedState =
    receivedState && receivedState.deckId === id ? receivedState.state : null;
  const projectionLinked = Boolean(connectedState);
  const navigatePresenterConsoleToDeck = useCallback(
    (targetDeckId: string) => {
      navigate(
        `/deck/${encodeURIComponent(targetDeckId)}/present?view=presenter`,
        { replace: true },
      );
    },
    [navigate],
  );
  const presenterControls = usePresenterActionBridge({
    deckId: id ?? "",
    enabled: projectionLinked,
    send: channel.send,
    onSwitchDeck: navigatePresenterConsoleToDeck,
  });

  const openDeckPicker = useCallback(() => {
    setDeckSearch("");
    setFocusedDeckId(id ?? "");
    setDeckPickerOpen(true);
  }, [id]);

  const switchDeck = useCallback(
    async (targetDeckId: string) => {
      if (!connectedState) return;
      setDeckPickerOpen(false);
      if (!id || targetDeckId === id) return;
      const relayed = await presenterControls.run({
        operation: "switch-deck",
        deckId: id,
        targetDeckId,
      });
      return relayed;
    },
    [connectedState, id, presenterControls.run],
  );

  useEffect(() => {
    setReceivedState(null);
    setLocalBlackout(null);
    setTimerResetAt(null);
  }, [id]);

  useEffect(() => {
    window.localStorage.setItem(
      NOTES_TEXT_SIZE_STORAGE_KEY,
      String(notesTextSizeIndex),
    );
  }, [notesTextSizeIndex]);

  useEffect(() => {
    if (!id || !channel.available) return;
    const requestState = () => channel.send({ type: "request-state" });
    requestState();
    const interval = window.setInterval(requestState, 2_000);
    return () => window.clearInterval(interval);
  }, [channel.available, channel.send, id]);

  useEffect(() => {
    if (!receivedState || receivedState.deckId !== id) return;
    const { receivedAt } = receivedState;
    const timeout = window.setTimeout(() => {
      setReceivedState((current) =>
        current?.receivedAt === receivedAt ? null : current,
      );
    }, 6_000);
    return () => window.clearTimeout(timeout);
  }, [id, receivedState]);

  const index = clampPresenterIndex(
    connectedState?.index ?? requestedIndex,
    slides.length,
  );
  const rawIndex = visibleRawIndexes[index] ?? 0;
  const total = slides.length;
  const currentSlide = slides[index];
  const nextSlide = slides[index + 1];
  const blackout = connectedState ? connectedState.blackout : localBlackout;
  const startedAt = connectedState ? connectedState.startedAt : localStart;
  const stepIndex = connectedState?.stepIndex ?? 0;
  const stepCount = connectedState?.stepCount ?? null;
  const canPrevious = index > 0 || stepIndex > 0;
  const hasNextBuildStep = stepCount !== null && stepIndex < stepCount;
  const canNext = index < total - 1 || hasNextBuildStep;
  const upNextSlide = hasNextBuildStep ? currentSlide : nextSlide;
  const upNextSlideIndex = hasNextBuildStep ? index + 1 : index + 2;
  const upNextInitialRevealedSteps = hasNextBuildStep ? stepIndex + 1 : 0;
  const hasUpNext = hasNextBuildStep || Boolean(nextSlide);
  const currentPreview = useSlidePreview(id ?? "", currentSlide?.id);
  const upNextPreview = useSlidePreview(id ?? "", upNextSlide?.id);

  useEffect(() => {
    if (total === 0 || requestedSlide === rawIndex + 1) return;
    const next = new URLSearchParams(searchParams);
    next.set("slide", String(rawIndex + 1));
    setSearchParams(next, { replace: true });
  }, [rawIndex, requestedSlide, searchParams, setSearchParams, total]);

  useEffect(() => {
    if (!id) return;
    const navigation = {
      app: "slides-2",
      view: "presenter",
      deckId: id,
      slideId: currentSlide?.id ?? null,
      slideIndex: rawIndex,
      slideNumber: rawIndex + 1,
      path: `/deck/${encodeURIComponent(id)}/present?view=presenter&slide=${rawIndex + 1}`,
    };
    writeState(appStateKeyForBrowserTab("navigation", TAB_ID), navigation);
    writeState("navigation", navigation);
    const selection = {
      deckId: id,
      slideId: currentSlide?.id ?? null,
      slideIndex: rawIndex,
      slideNumber: rawIndex + 1,
      items: [],
    };
    writeState(appStateKeyForBrowserTab("slides-selection", TAB_ID), selection);
  }, [currentSlide?.id, id, rawIndex]);

  const goTo = useCallback(
    (nextIndex: number) => {
      if (!id) return;
      const next = clampPresenterIndex(nextIndex, total);
      const nextRawIndex = visibleRawIndexes[next] ?? 0;
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("slide", String(nextRawIndex + 1));
      setSearchParams(nextParams, { replace: true });
      if (!connectedState) return;
      void presenterControls.run({
        operation: "goto",
        deckId: id,
        slideNumber: nextRawIndex + 1,
      });
    },
    [
      connectedState,
      id,
      presenterControls.run,
      searchParams,
      setSearchParams,
      total,
      visibleRawIndexes,
    ],
  );
  const step = useCallback(
    (direction: "next" | "prev") => {
      if (!id) return;
      if (!connectedState) {
        goTo(index + (direction === "next" ? 1 : -1));
        return;
      }
      void presenterControls.run({
        operation: direction === "next" ? "next" : "previous",
        deckId: id,
      });
    },
    [connectedState, goTo, id, index, presenterControls.run],
  );
  const toggleBlackout = useCallback(
    (mode: Exclude<PresenterBlackout, null>) => {
      if (!connectedState) {
        setLocalBlackout(mode);
        return;
      }
      if (!id) return;
      void presenterControls.run({
        operation: "blackout",
        deckId: id,
        mode,
      });
    },
    [connectedState, id, presenterControls.run],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (deckPickerOpen || isPresenterTypingTarget(event.target)) {
        return;
      }

      switch (getPresenterConsoleCommand(event)) {
        case "next":
          event.preventDefault();
          step("next");
          break;
        case "previous":
          event.preventDefault();
          step("prev");
          break;
        case "first":
          event.preventDefault();
          goTo(0);
          break;
        case "last":
          event.preventDefault();
          goTo(total - 1);
          break;
        case "blackout":
          event.preventDefault();
          toggleBlackout("black");
          break;
        case "whiteout":
          event.preventDefault();
          toggleBlackout("white");
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deckPickerOpen, goTo, step, toggleBlackout, total]);

  if (!id) return <Navigate to="/" replace />;

  if (deckQuery.isLoading) {
    return (
      <div
        className="dark h-dvh animate-pulse bg-neutral-950"
        aria-hidden="true"
      />
    );
  }

  if (deckQuery.error || !deck) {
    return (
      <div className="dark grid h-dvh place-items-center bg-neutral-950 px-6 text-center text-sm text-foreground">
        {actionErrorMessage(deckQuery.error) ?? t("presentation.loadFailed")}
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="dark grid h-dvh place-items-center bg-neutral-950 px-6 text-center text-sm text-foreground">
        {t("presentation.noSlides")}
      </div>
    );
  }

  const nextLabel = hasUpNext
    ? t("presentation.upNext")
    : t("presentation.endOfDeck");
  const position = t("slides2Presenter.position", {
    index: index + 1,
    total,
  });
  return (
    <div className="dark flex h-dvh min-h-[480px] w-screen flex-col overflow-hidden bg-neutral-950 text-foreground">
      {presenterControls.hasError ? (
        <div
          className="border-b border-destructive/30 px-5 py-2 text-xs text-destructive"
          role="alert"
        >
          {presenterControls.errorMessage ??
            t("slides2Presenter.controlFailed")}
        </div>
      ) : null}
      <header className="grid h-12 min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border px-5 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {/* guard:allow-eyebrow — deliberate: matches the source presenter console's mode nameplate. */}
          <span className="hidden shrink-0 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:inline">
            {t("slides2Presenter.presenterLabel")}
          </span>
          <h1 className="min-w-0 text-sm font-semibold tracking-tight">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto max-w-full justify-start gap-2 px-2 py-1 text-left"
              aria-label={t("slides2Presenter.switchDeck")}
              aria-haspopup="dialog"
              aria-expanded={deckPickerOpen}
              onClick={openDeckPicker}
            >
              <span className="truncate">
                {deck.title || t("navigation.brand")}
              </span>
              <IconChevronDown
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </Button>
          </h1>
        </div>
        <div className="col-start-2 flex shrink-0 items-center gap-3">
          {!projectionLinked && (
            <span
              role="status"
              className="flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-muted-foreground"
              />
              {t("slides2Presenter.projectionNotLinked")}
            </span>
          )}
        </div>
        <div className="col-start-3 flex shrink-0 items-center gap-3">
          <CurrentClock />
          <ElapsedTimer startedAt={startedAt} resetAt={timerResetAt} />
          <span
            aria-label={position}
            className="font-mono text-base tabular-nums text-foreground"
          >
            {formatters.formatNumber(index + 1, {
              minimumIntegerDigits: 2,
              useGrouping: false,
            })}{" "}
            /{" "}
            {formatters.formatNumber(total, {
              minimumIntegerDigits: 2,
              useGrouping: false,
            })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => window.close()}
            aria-label={t("presentation.closePresenterView")}
            title={t("presentation.closePresenterView")}
          >
            <IconX aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="grid h-6 shrink-0 grid-cols-1 items-center gap-4 px-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] lg:gap-6 lg:px-6">
        <h2 className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {t("slides2Presenter.nowShowing")}
        </h2>
        <h2 className="hidden font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:block">
          {nextLabel}
        </h2>
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 pb-4 pt-0 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] lg:gap-6 lg:px-6 lg:pb-4">
        <section className="flex min-h-0 flex-col gap-2 pt-1">
          <h2 className="sr-only">{position}</h2>
          <div className="min-h-0 flex-1">
            <SlidePreview
              artifact={currentPreview.artifact}
              failed={currentPreview.failed}
              loading={currentPreview.loading}
              title={t("slides2Presenter.slideLabel", { index: index + 1 })}
              blackout={blackout}
              initialRevealedSteps={stepIndex}
              className="h-full min-h-[220px]"
            />
          </div>
        </section>

        <aside className="grid min-h-0 grid-rows-[auto_minmax(180px,1fr)_auto] gap-4">
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground lg:hidden">
              {nextLabel}
            </h2>
            {hasUpNext ? (
              <SlidePreview
                artifact={upNextPreview.artifact}
                failed={upNextPreview.failed}
                loading={upNextPreview.loading}
                title={t("slides2Presenter.slideLabel", {
                  index: upNextSlideIndex,
                })}
                initialRevealedSteps={upNextInitialRevealedSteps}
              />
            ) : (
              <div className="grid aspect-video place-items-center rounded-md bg-card text-xs text-muted-foreground ring-1 ring-border">
                {t("presentation.endOfDeck")}
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {t("presentation.speakerNotes")}
              </h2>
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
                  A↓
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
                  A↑
                </Button>
              </div>
            </div>
            <div
              className={`min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-neutral-900 p-3 leading-relaxed text-card-foreground ${NOTES_TEXT_SIZE_CLASSES[notesTextSizeIndex]}`}
            >
              {currentPreview.loading ? (
                <div
                  className="h-2 w-24 animate-pulse rounded bg-muted"
                  aria-hidden="true"
                />
              ) : currentPreview.failed ? (
                <span className="text-muted-foreground">
                  {t("presentation.loadFailed")}
                </span>
              ) : currentPreview.source?.notes?.trim() ? (
                <div className="space-y-[0.65em] whitespace-pre-wrap [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-[1.4em] [&_p]:mb-0 [&_ul]:list-disc [&_ul]:pl-[1.4em]">
                  <ReactMarkdown>
                    {currentPreview.source.notes ?? ""}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  {t("presentation.noNotesForSlide")}
                </span>
              )}
            </div>
          </section>

          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const slideNumber = Number.parseInt(jumpValue, 10);
              if (slideNumber >= 1 && slideNumber <= total) {
                goTo(slideNumber - 1);
                setJumpValue("");
              }
            }}
          >
            <span className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {t("slides2Presenter.jumpLabel")}
            </span>
            <Input
              type="number"
              size="sm"
              min={1}
              max={total}
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value)}
              placeholder={String(index + 1)}
              aria-label={t("slides2Presenter.shortcutJump")}
              className="w-16 rounded-md bg-card px-2 font-mono text-xs tabular-nums text-foreground"
            />
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              /{" "}
              {formatters.formatNumber(total, {
                minimumIntegerDigits: 2,
                useGrouping: false,
              })}
            </span>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="sr-only focus:not-sr-only"
              aria-label={t("slides2Presenter.shortcutJump")}
              disabled={
                !jumpValue ||
                Number.parseInt(jumpValue, 10) < 1 ||
                Number.parseInt(jumpValue, 10) > total
              }
            >
              {t("slides2Presenter.jumpLabel")}
            </Button>
          </form>
        </aside>
      </main>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => step("prev")}
            disabled={projectionLinked && !canPrevious}
            aria-label={t("presentation.previousSlide")}
            title={t("presentation.previousSlide")}
          >
            <IconChevronLeft aria-hidden="true" />
            {t("slides2Presenter.previousShort")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => step("next")}
            disabled={projectionLinked && !canNext}
            aria-label={t("presentation.nextSlide")}
            title={t("presentation.nextSlide")}
          >
            {t("slides2Presenter.nextShort")}
            <IconChevronRight aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={blackout === "black" ? "default" : "outline"}
            size="sm"
            onClick={() => toggleBlackout("black")}
            aria-label={t("slides2Presenter.blackout")}
            aria-pressed={blackout === "black"}
            title={t("slides2Presenter.blackout")}
          >
            <IconSquare aria-hidden="true" />
            {t("slides2Presenter.blackLabel")}
          </Button>
          <Button
            variant={blackout === "white" ? "default" : "outline"}
            size="sm"
            onClick={() => toggleBlackout("white")}
            aria-label={t("slides2Presenter.whiteout")}
            aria-pressed={blackout === "white"}
            title={t("slides2Presenter.whiteout")}
          >
            <IconSun aria-hidden="true" />
            {t("slides2Presenter.whiteLabel")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTimerResetAt(Date.now())}
            aria-label={t("slides2Presenter.resetTimer")}
            title={t("slides2Presenter.resetTimer")}
          >
            <IconRotateClockwise aria-hidden="true" />
            {t("slides2Presenter.resetShort")}
          </Button>
        </div>
      </footer>

      <Dialog open={deckPickerOpen} onOpenChange={setDeckPickerOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("slides2Presenter.switchDeck")}</DialogTitle>
          </DialogHeader>
          <Input
            type="search"
            value={deckSearch}
            onChange={(event) => setDeckSearch(event.target.value)}
            placeholder={t("slides2Presenter.searchDecks")}
            aria-label={t("slides2Presenter.searchDecks")}
            autoComplete="off"
          />
          <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section aria-label={t("slides2Presenter.searchDecks")}>
              <div className="max-h-[min(48vh,360px)] min-h-24 overflow-y-auto rounded-md border border-border p-1">
                {deckListQuery.isError ? (
                  <div
                    className="flex min-h-24 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground"
                    role="alert"
                  >
                    <span>
                      {actionErrorMessage(deckListQuery.error) ??
                        t("presentation.loadFailed")}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void deckListQuery.refetch()}
                    >
                      {t("presentation.tryAgain")}
                    </Button>
                  </div>
                ) : deckListQuery.isLoading && !deckList ? (
                  <div
                    className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    {t("slides2Presenter.loadingDecks")}
                  </div>
                ) : pickerDecks.length > 0 ? (
                  pickerDecks.map((pickerDeck) => (
                    <Button
                      key={pickerDeck.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-pressed={focusedDeck?.id === pickerDeck.id}
                      onClick={() => setFocusedDeckId(pickerDeck.id)}
                      className={`h-auto w-full justify-start rounded-sm px-3 py-2 text-left text-sm font-normal outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground ${focusedDeck?.id === pickerDeck.id ? "bg-accent text-accent-foreground" : "text-foreground"}`}
                    >
                      <span className="truncate">
                        {pickerDeck.title || t("navigation.brand")}
                      </span>
                    </Button>
                  ))
                ) : (
                  <div className="flex min-h-24 items-center justify-center p-4 text-center text-sm text-muted-foreground">
                    {deckSearch.trim()
                      ? t("slides2Presenter.noMatchingDecks")
                      : t("slides2Presenter.noDecks")}
                  </div>
                )}
              </div>
              {deckList?.nextCursor && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("slides2Presenter.searchForMoreDecks")}
                </p>
              )}
            </section>

            <section
              aria-label={t("slides2Presenter.deckPreview")}
              className="min-w-0"
            >
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">
                {t("slides2Presenter.deckPreview")}
              </h2>
              {focusedDeck ? (
                focusedDeck.previewTooLarge || !pickerPreviewSlideId ? (
                  <div className="grid aspect-video place-items-center rounded-md border border-border bg-card p-4 text-center text-sm text-muted-foreground">
                    {t("slides2Presenter.deckPreviewUnavailable")}
                  </div>
                ) : (
                  <SlidePreview
                    artifact={pickerPreview.artifact}
                    failed={pickerPreview.failed}
                    loading={pickerPreview.loading}
                    title={focusedDeck.title || t("navigation.brand")}
                  />
                )
              ) : (
                <div className="grid aspect-video place-items-center rounded-md border border-border bg-card p-4 text-center text-sm text-muted-foreground">
                  {t("slides2Presenter.selectDeckToPreview")}
                </div>
              )}
            </section>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => focusedDeck && switchDeck(focusedDeck.id)}
              disabled={
                !projectionLinked || !focusedDeck || focusedDeck.id === id
              }
            >
              {t("slides2Presenter.switchToDeck")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
