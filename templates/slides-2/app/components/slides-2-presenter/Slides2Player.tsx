import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Button } from "@/components/ui/button";

import {
  isSlideFramePointerType,
  type SlideFrameNavigationInput,
  type SlideFramePointerType,
} from "../slides-2-runtime/protocol";
import { getPresenterConsoleCommand, hasPresenterModifier } from "./keyboard";
import type {
  Slides2PresenterState,
  PresenterBlackout,
} from "./presenter-channel";
import Slides2BlackoutOverlay from "./Slides2BlackoutOverlay";
import Slides2ControlBar from "./Slides2ControlBar";
import Slides2HelpDialog from "./Slides2HelpDialog";
import Slides2JumpInput from "./Slides2JumpInput";
import Slides2LaserPointer from "./Slides2LaserPointer";
import Slides2Overview from "./Slides2Overview";
import Slides2ProgressBar from "./Slides2ProgressBar";
import { useSlides2TouchSwipe } from "./useSlides2TouchSwipe";

type Slides2PlayerContentProps = {
  onNavigationInput: (input: SlideFrameNavigationInput) => void;
  onFramePointerActivity: (pointerType: SlideFramePointerType) => void;
  onFramePointerMove: (
    position: { x: number; y: number },
    pointerType: SlideFramePointerType,
  ) => void;
};

export type Slides2PresenterLabels = {
  previous: string;
  next: string;
  overview: string;
  overviewTitle: string;
  blackout: string;
  whiteout: string;
  laser: string;
  presenter: string;
  enterFullscreen: string;
  exitFullscreen: string;
  fullscreenBlocked: string;
  help: string;
  helpTitle: string;
  exit: string;
  close: string;
  elapsedTime: string;
  jumpHint: string;
  slideLabel: (index: number, total: number) => string;
  position: (index: number, total: number) => string;
  shortcutNext: string;
  shortcutPrevious: string;
  shortcutFirstLast: string;
  shortcutJump: string;
  shortcutOverview: string;
  shortcutBlackout: string;
  shortcutWhiteout: string;
  shortcutLaser: string;
  shortcutPresenter: string;
  shortcutHelp: string;
  shortcutExit: string;
};

export type Slides2PlayerProps = {
  index: number;
  total: number;
  canPrevious: boolean;
  canNext: boolean;
  onIndexChange: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onExit: () => void;
  children: ReactNode | ((props: Slides2PlayerContentProps) => ReactNode);
  labels: Slides2PresenterLabels;
  initialFullscreen?: boolean;
  allowExit?: boolean;
  controls?: boolean;
  onPresenter?: () => void;
  blackout?: PresenterBlackout;
  onBlackoutChange?: (blackout: PresenterBlackout) => void;
  onPresentationStateChange?: (state: Slides2PresenterState) => void;
  renderOverviewSlide?: (index: number) => ReactNode;
};

const IDLE_DELAY_MS = 2000;
const CONTROL_HOTZONE_PX = 160;
const MAX_JUMP_DIGITS = 4;
const WHEEL_PAGE_THRESHOLD_PX = 12;
const WHEEL_NAV_COOLDOWN_MS = 100;
const WHEEL_GESTURE_IDLE_MS = 80;
const MOBILE_EDGE_RATIO = 0.3;
const NAV_PASSTHROUGH =
  'a, button, input, textarea, select, label, summary, iframe, video, audio, embed, object, [role="button"], [role="link"], [contenteditable="true"], [data-slides2-interactive], [data-slides2-chrome]';
const WHEEL_PASSTHROUGH =
  'input, textarea, select, [contenteditable="true"], [data-wheel-nav-ignore]';

function normalizeWheelDelta(delta: number, deltaMode: number) {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 800;
  return delta;
}

function isZoomedViewport() {
  return (window.visualViewport?.scale ?? 1) > 1.01;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 767.98px)").matches;
}

export default function Slides2Player({
  index,
  total,
  canPrevious,
  canNext,
  onIndexChange,
  onPrevious,
  onNext,
  onExit,
  children,
  labels,
  initialFullscreen = true,
  allowExit = true,
  controls = true,
  onPresenter,
  blackout,
  onBlackoutChange,
  onPresentationStateChange,
  renderOverviewSlide,
}: Slides2PlayerProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [windowed, setWindowed] = useState(!initialFullscreen);
  const windowedRef = useRef(windowed);
  windowedRef.current = windowed;
  const exitedRef = useRef(false);
  const [fullscreenPrompt, setFullscreenPrompt] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [localBlackout, setLocalBlackout] = useState<PresenterBlackout>(null);
  const activeBlackout = blackout === undefined ? localBlackout : blackout;
  const setBlackout = useCallback(
    (
      next:
        | PresenterBlackout
        | ((current: PresenterBlackout) => PresenterBlackout),
    ) => {
      const resolved = typeof next === "function" ? next(activeBlackout) : next;
      if (blackout === undefined) setLocalBlackout(resolved);
      else onBlackoutChange?.(resolved);
    },
    [activeBlackout, blackout, onBlackoutChange],
  );
  const [laser, setLaser] = useState(false);
  const laserPointerMoveHandlerRef = useRef<
    ((position: { x: number; y: number }) => void) | null
  >(null);
  const [pointerNearBottom, setPointerNearBottom] = useState(false);
  const [mobileChromeVisible, setMobileChromeVisible] = useState(true);
  const [keyboardDriven, setKeyboardDriven] = useState(false);
  const [jumpNumber, setJumpNumber] = useState("");
  const [idle, setIdle] = useState(false);
  const [mobileDeadline, setMobileDeadline] = useState(() => Date.now() + 2200);
  const [startedAt] = useState(() => Date.now());
  const overlayOpen = overviewOpen || helpOpen;
  const idleTimerRef = useRef<number | null>(null);
  const accumulatedWheelRef = useRef(0);
  const lastWheelAtRef = useRef(0);
  const lastWheelNavigationAtRef = useRef(0);

  useEffect(() => {
    onPresentationStateChange?.({
      index,
      total,
      blackout: activeBlackout,
      startedAt,
    });
  }, [activeBlackout, index, onPresentationStateChange, startedAt, total]);

  const markActivity = useCallback(() => {
    setIdle(false);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(
      () => setIdle(true),
      IDLE_DELAY_MS,
    );
  }, []);

  const showMobileChrome = useCallback(() => {
    markActivity();
    setMobileChromeVisible(true);
    const deadline = Date.now() + 2200;
    setMobileDeadline(deadline);
  }, [markActivity]);

  const handlePointerActivity = useCallback(
    (pointerType: SlideFramePointerType, revealMobileChrome = false) => {
      setKeyboardDriven(false);
      if (pointerType === "touch" || revealMobileChrome) {
        showMobileChrome();
      } else {
        markActivity();
      }
    },
    [markActivity, showMobileChrome],
  );

  const handlePointerPosition = useCallback(
    (
      position: { x: number; y: number },
      pointerType: SlideFramePointerType,
    ) => {
      handlePointerActivity(pointerType);
      if (pointerType === "touch") return;
      setPointerNearBottom(
        window.innerHeight - position.y <= CONTROL_HOTZONE_PX,
      );
    },
    [handlePointerActivity],
  );

  const clampIndex = useCallback(
    (next: number) => {
      if (total <= 0) return 0;
      return Math.max(0, Math.min(total - 1, Number.isFinite(next) ? next : 0));
    },
    [total],
  );

  const goTo = useCallback(
    (next: number) => onIndexChange(clampIndex(next)),
    [clampIndex, onIndexChange],
  );
  const goPrevious = useCallback(() => onPrevious(), [onPrevious]);
  const goNext = useCallback(() => onNext(), [onNext]);

  const handleWheelInput = useCallback(
    (
      input: Extract<SlideFrameNavigationInput, { type: "wheel" }>,
      preventDefault?: () => void,
    ) => {
      if (overlayOpen || input.ctrlKey || isZoomedViewport()) return;

      const deltaX = normalizeWheelDelta(input.deltaX, input.deltaMode);
      const deltaY = normalizeWheelDelta(input.deltaY, input.deltaMode);
      if (Math.abs(deltaY) <= Math.abs(deltaX)) return;

      const now = performance.now();
      if (now - lastWheelAtRef.current > WHEEL_GESTURE_IDLE_MS) {
        accumulatedWheelRef.current = 0;
      }
      lastWheelAtRef.current = now;

      if (now - lastWheelNavigationAtRef.current < WHEEL_NAV_COOLDOWN_MS) {
        preventDefault?.();
        return;
      }

      accumulatedWheelRef.current += deltaY;
      if (Math.abs(accumulatedWheelRef.current) < WHEEL_PAGE_THRESHOLD_PX) {
        preventDefault?.();
        return;
      }

      const direction = Math.sign(accumulatedWheelRef.current);
      accumulatedWheelRef.current = 0;
      preventDefault?.();

      if (direction > 0 && canNext) {
        lastWheelNavigationAtRef.current = now;
        goNext();
      } else if (direction < 0 && canPrevious) {
        lastWheelNavigationAtRef.current = now;
        goPrevious();
      }
    },
    [canNext, canPrevious, goNext, goPrevious, overlayOpen],
  );

  const handleViewportClick = useCallback(
    (
      input: Extract<SlideFrameNavigationInput, { type: "click" }>,
      x: number,
      y: number,
    ) => {
      if (
        overlayOpen ||
        input.button !== 0 ||
        input.defaultPrevented ||
        input.interactive ||
        input.hasSelection
      ) {
        return;
      }

      if (controls && isMobileViewport() && y >= 0.5) showMobileChrome();
      if (x < MOBILE_EDGE_RATIO && canPrevious) goPrevious();
      else if (x > 1 - MOBILE_EDGE_RATIO && canNext) goNext();
    },
    [
      canNext,
      canPrevious,
      controls,
      goNext,
      goPrevious,
      overlayOpen,
      showMobileChrome,
    ],
  );

  const handleFrameNavigationInput = useCallback(
    (input: SlideFrameNavigationInput) => {
      if (input.type === "wheel") {
        handleWheelInput(input);
        return;
      }

      const frame = root?.querySelector<HTMLIFrameElement>(
        "iframe[data-slides-2-frame]",
      );
      const frameRect = frame?.getBoundingClientRect();
      const rootRect = root?.getBoundingClientRect();
      if (
        !frameRect ||
        !rootRect ||
        !frameRect.width ||
        !frameRect.height ||
        !rootRect.width ||
        !rootRect.height
      ) {
        return;
      }
      const x =
        (frameRect.left + input.x * frameRect.width - rootRect.left) /
        rootRect.width;
      const y =
        (frameRect.top + input.y * frameRect.height - rootRect.top) /
        rootRect.height;
      handleViewportClick(input, x, y);
    },
    [handleViewportClick, handleWheelInput, root],
  );

  const setLaserPointerMoveHandler = useCallback(
    (handler: ((position: { x: number; y: number }) => void) | null) => {
      laserPointerMoveHandlerRef.current = handler;
    },
    [],
  );

  const handleFramePointerMove = useCallback(
    (
      position: { x: number; y: number },
      pointerType: SlideFramePointerType,
    ) => {
      const frame = root?.querySelector<HTMLIFrameElement>(
        "iframe[data-slides-2-frame]",
      );
      if (!frame?.clientWidth || !frame.clientHeight) return;
      const rect = frame.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const viewportPosition = {
        x: rect.left + (position.x / frame.clientWidth) * rect.width,
        y: rect.top + (position.y / frame.clientHeight) * rect.height,
      };
      handlePointerPosition(viewportPosition, pointerType);
      laserPointerMoveHandlerRef.current?.(viewportPosition);
    },
    [handlePointerPosition, root],
  );

  const handleFramePointerActivity = useCallback(
    (pointerType: SlideFramePointerType) => {
      handlePointerActivity(
        pointerType,
        window.matchMedia("(pointer: coarse)").matches,
      );
    },
    [handlePointerActivity],
  );

  useEffect(() => {
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        (event.target instanceof Element &&
          (event.target.closest(WHEEL_PASSTHROUGH) ||
            event.target.closest("iframe[data-slides-2-frame]")))
      ) {
        return;
      }
      handleWheelInput(
        {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          type: "wheel",
        },
        () => event.preventDefault(),
      );
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [handleWheelInput, root]);

  useEffect(() => {
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(NAV_PASSTHROUGH)
      ) {
        return;
      }
      if (window.getSelection()?.toString()) return;
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      handleViewportClick(
        {
          type: "click",
          x,
          y,
          button: event.button,
          defaultPrevented: event.defaultPrevented,
          interactive: false,
          hasSelection: false,
        },
        x,
        y,
      );
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [handleViewportClick, root]);

  const content =
    typeof children === "function"
      ? children({
          onNavigationInput: handleFrameNavigationInput,
          onFramePointerActivity: handleFramePointerActivity,
          onFramePointerMove: handleFramePointerMove,
        })
      : children;

  useSlides2TouchSwipe({
    target: root,
    enabled: controls && !overlayOpen,
    onPrevious: goPrevious,
    onNext: goNext,
  });
  const exitOnce = useCallback(() => {
    if (exitedRef.current || !allowExit) return;
    exitedRef.current = true;
    onExit();
  }, [allowExit, onExit]);

  const requestFullscreen = useCallback(async () => {
    if (!root?.requestFullscreen) {
      setFullscreenPrompt(true);
      windowedRef.current = true;
      setWindowed(true);
      return;
    }
    try {
      await root.requestFullscreen();
      windowedRef.current = false;
      setWindowed(false);
      setFullscreenPrompt(false);
    } catch {
      windowedRef.current = true;
      setWindowed(true);
      setFullscreenPrompt(true);
    }
  }, [root]);

  useEffect(() => {
    if (!root || !initialFullscreen) return;
    let cancelled = false;
    const request = root.requestFullscreen?.();
    if (!request) {
      setFullscreenPrompt(true);
      windowedRef.current = true;
      setWindowed(true);
      return;
    }
    request.then(
      () => {
        if (!cancelled) {
          setFullscreenPrompt(false);
          windowedRef.current = false;
          setWindowed(false);
        }
      },
      () => {
        if (!cancelled) {
          setFullscreenPrompt(true);
          windowedRef.current = true;
          setWindowed(true);
        }
      },
    );
    return () => {
      cancelled = true;
      if (document.fullscreenElement === root) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [initialFullscreen, root]);

  useEffect(() => {
    if (!root) return;
    let wasFullscreen = document.fullscreenElement === root;
    const handleFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement === root;
      setFullscreen(isFullscreen);
      if (wasFullscreen && !isFullscreen && !windowedRef.current) exitOnce();
      wasFullscreen = isFullscreen;
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [exitOnce, root]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === root && root) {
      windowedRef.current = true;
      setWindowed(true);
      setFullscreenPrompt(false);
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    windowedRef.current = false;
    setWindowed(false);
    void requestFullscreen();
  }, [requestFullscreen, root]);

  useEffect(() => {
    if (!overlayOpen) showMobileChrome();
  }, [overlayOpen, showMobileChrome]);

  useEffect(() => {
    if (!mobileChromeVisible || overlayOpen) return;
    const timeout = window.setTimeout(
      () => setMobileChromeVisible(false),
      Math.max(0, mobileDeadline - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [mobileChromeVisible, mobileDeadline, overlayOpen]);

  useEffect(() => {
    idleTimerRef.current = window.setTimeout(
      () => setIdle(true),
      IDLE_DELAY_MS,
    );
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      handlePointerPosition(
        { x: event.clientX, y: event.clientY },
        isSlideFramePointerType(event.pointerType)
          ? event.pointerType
          : "mouse",
      );
    },
    [handlePointerPosition],
  );

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"]',
        ),
      );
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (overlayOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setOverviewOpen(false);
          setHelpOpen(false);
        } else if (
          helpOpen &&
          (event.key === "?" || event.key === "h" || event.key === "H")
        ) {
          event.preventDefault();
          setHelpOpen(false);
        }
        return;
      }

      if (event.key === "Escape") {
        if (controls && jumpNumber) {
          event.preventDefault();
          setJumpNumber("");
          return;
        }
        if (controls && activeBlackout) {
          event.preventDefault();
          setBlackout(null);
          return;
        }
        exitOnce();
        return;
      }

      if (controls && jumpNumber && event.key === "Enter") {
        event.preventDefault();
        const slideNumber = Number(jumpNumber);
        setJumpNumber("");
        if (slideNumber >= 1 && slideNumber <= total) goTo(slideNumber - 1);
        markActivity();
        return;
      }

      if (
        controls &&
        !hasPresenterModifier(event) &&
        /^[0-9]$/.test(event.key)
      ) {
        event.preventDefault();
        const next = `${jumpNumber}${event.key}`;
        const slideNumber = Number(next);
        if (
          next.length > MAX_JUMP_DIGITS || // i18n-ignore: numeric jump bound, not UI copy
          slideNumber < 1 ||
          slideNumber > total
        ) {
          setJumpNumber("");
        } else {
          setJumpNumber(next);
        }
        setKeyboardDriven(true);
        markActivity();
        return;
      }

      if (controls && jumpNumber && event.key === "Backspace") {
        event.preventDefault();
        setJumpNumber((current) => current.slice(0, -1));
        return;
      }

      if (jumpNumber) setJumpNumber("");

      const command = getPresenterConsoleCommand(event);
      if (command === "next") {
        event.preventDefault();
        setKeyboardDriven(true);
        markActivity();
        if (activeBlackout) setBlackout(null);
        goNext();
        return;
      }
      if (command === "previous") {
        event.preventDefault();
        setKeyboardDriven(true);
        markActivity();
        if (activeBlackout) setBlackout(null);
        goPrevious();
        return;
      }
      if (command === "first") {
        event.preventDefault();
        setKeyboardDriven(true);
        goTo(0);
        return;
      }
      if (command === "last") {
        event.preventDefault();
        setKeyboardDriven(true);
        goTo(total - 1);
        return;
      }
      if (!controls || hasPresenterModifier(event)) return;

      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        setBlackout((current) => (current === "black" ? null : "black"));
      } else if (key === "w") {
        event.preventDefault();
        setBlackout((current) => (current === "white" ? null : "white"));
      } else if (key === "o") {
        event.preventDefault();
        setOverviewOpen((current) => !current);
      } else if (key === "l") {
        event.preventDefault();
        setLaser((current) => !current);
      } else if (key === "h" || event.key === "?") {
        event.preventDefault();
        setHelpOpen((current) => !current);
      } else if (key === "p" && onPresenter) {
        event.preventDefault();
        onPresenter();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeBlackout,
    controls,
    exitOnce,
    goNext,
    goPrevious,
    goTo,
    helpOpen,
    jumpNumber,
    markActivity,
    onPresenter,
    overlayOpen,
    total,
  ]);

  const chromeVisible = overlayOpen || pointerNearBottom || mobileChromeVisible;
  const hideCursor =
    controls && (laser || keyboardDriven || (idle && !pointerNearBottom));
  const playerClassName = /* guard:allow-raw-color — slides sit on a pure black playback surface. */ `fixed inset-0 flex items-center justify-center overflow-hidden bg-black ${
    controls ? "select-none" : ""
  } ${hideCursor ? "cursor-none" : "cursor-default"}`;

  return (
    <div
      ref={setRoot}
      onPointerMove={handlePointerMove}
      onPointerDown={(event) => {
        handlePointerActivity(
          isSlideFramePointerType(event.pointerType)
            ? event.pointerType
            : "mouse",
          window.matchMedia("(pointer: coarse)").matches,
        );
      }}
      className={playerClassName}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {content}
      </div>

      {controls && (
        <>
          <Slides2ProgressBar
            index={index}
            total={total}
            visible={chromeVisible}
          />
          <Slides2BlackoutOverlay mode={activeBlackout} />
          <Slides2JumpInput
            active={!overlayOpen}
            value={jumpNumber}
            label={labels.jumpHint}
          />
          <Slides2LaserPointer
            enabled={laser}
            onPointerMoveHandlerChange={setLaserPointerMoveHandler}
          />
          <Slides2ControlBar
            index={index}
            total={total}
            canPrevious={canPrevious}
            canNext={canNext}
            visible={chromeVisible}
            startedAt={startedAt}
            blackout={activeBlackout}
            laser={laser}
            fullscreen={fullscreen}
            allowExit={allowExit}
            hasPresenter={Boolean(onPresenter)}
            labels={labels}
            onPrevious={goPrevious}
            onNext={goNext}
            onOverview={() => setOverviewOpen(true)}
            onBlackout={(mode) =>
              setBlackout((current) => (current === mode ? null : mode))
            }
            onLaser={() => setLaser((current) => !current)}
            onPresenter={() => onPresenter?.()}
            onFullscreen={toggleFullscreen}
            onHelp={() => setHelpOpen(true)}
            onExit={exitOnce}
            onMobileInteraction={showMobileChrome}
          />
          {fullscreenPrompt && (
            <Button
              type="button"
              onClick={() => void requestFullscreen()}
              variant="ghost"
              size="default"
              className="absolute right-4 top-4 z-50 h-auto rounded-md border border-border bg-background/90 px-3 py-2 text-sm text-foreground shadow-lg backdrop-blur transition-none hover:bg-background/90 hover:text-foreground active:scale-100"
            >
              {labels.fullscreenBlocked}
            </Button>
          )}
          <Slides2Overview
            open={overviewOpen}
            onOpenChange={setOverviewOpen}
            index={index}
            total={total}
            onSelect={(next) => {
              goTo(next);
              setOverviewOpen(false);
            }}
            renderSlide={renderOverviewSlide}
            labels={labels}
            container={root}
          />
          <Slides2HelpDialog
            open={helpOpen}
            onOpenChange={setHelpOpen}
            labels={labels}
            hasPresenter={Boolean(onPresenter)}
            container={root}
          />
        </>
      )}
    </div>
  );
}
