import {
  IconChevronLeft,
  IconChevronRight,
  IconCrosshair,
  IconGridDots,
  IconKeyboard,
  IconLogout,
  IconMaximize,
  IconMinimize,
  IconPresentation,
  IconSquare,
  IconSun,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Slides2PresenterLabels } from "./Slides2Player";

type Props = {
  index: number;
  total: number;
  canPrevious: boolean;
  canNext: boolean;
  visible: boolean;
  startedAt: number;
  blackout: "black" | "white" | null;
  laser: boolean;
  fullscreen: boolean;
  allowExit: boolean;
  hasPresenter: boolean;
  labels: Slides2PresenterLabels;
  onPrevious: () => void;
  onNext: () => void;
  onOverview: () => void;
  onBlackout: (mode: "black" | "white") => void;
  onLaser: () => void;
  onPresenter: () => void;
  onFullscreen: () => void;
  onHelp: () => void;
  onExit: () => void;
  onMobileInteraction: () => void;
};

export default function Slides2ControlBar({
  index,
  total,
  canPrevious,
  canNext,
  visible,
  startedAt,
  blackout,
  laser,
  fullscreen,
  allowExit,
  hasPresenter,
  labels,
  onPrevious,
  onNext,
  onOverview,
  onBlackout,
  onLaser,
  onPresenter,
  onFullscreen,
  onHelp,
  onExit,
  onMobileInteraction,
}: Props) {
  const wrap = (action: () => void) => () => {
    action();
    onMobileInteraction();
  };

  return (
    <div
      data-state={visible ? "visible" : "hidden"}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-4 md:pb-4",
        "will-change-transform motion-safe:transition-[opacity,transform] motion-safe:ease-out",
        visible
          ? "translate-y-0 opacity-100 motion-safe:duration-300"
          : "translate-y-6 opacity-0 motion-safe:duration-200",
      )}
    >
      <div
        data-slides2-chrome
        className={cn(
          "hidden h-11 items-center gap-1 rounded-full border border-border bg-background/90 px-2 text-foreground shadow-xl backdrop-blur-md md:flex",
          visible ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <ControlButton
          label={labels.previous}
          onClick={onPrevious}
          disabled={!canPrevious}
        >
          <IconChevronLeft />
        </ControlButton>
        <ControlButton label={labels.next} onClick={onNext} disabled={!canNext}>
          <IconChevronRight />
        </ControlButton>
        <Divider />
        <span
          aria-live="polite"
          className="min-w-16 px-1 text-center font-mono text-xs tabular-nums"
        >
          {labels.position(total > 0 ? index + 1 : 0, total)}
        </span>
        <Divider />
        <ElapsedClock startedAt={startedAt} label={labels.elapsedTime} />
        <Divider />
        <ControlButton label={labels.overview} onClick={onOverview}>
          <IconGridDots />
        </ControlButton>
        <ControlButton
          label={labels.blackout}
          onClick={() => onBlackout("black")}
          active={blackout === "black"}
        >
          <IconSquare />
        </ControlButton>
        <ControlButton
          label={labels.whiteout}
          onClick={() => onBlackout("white")}
          active={blackout === "white"}
        >
          <IconSun />
        </ControlButton>
        <ControlButton label={labels.laser} onClick={onLaser} active={laser}>
          <IconCrosshair />
        </ControlButton>
        {hasPresenter && (
          <ControlButton label={labels.presenter} onClick={onPresenter}>
            <IconPresentation />
          </ControlButton>
        )}
        <ControlButton
          label={fullscreen ? labels.exitFullscreen : labels.enterFullscreen}
          onClick={onFullscreen}
        >
          {fullscreen ? <IconMinimize /> : <IconMaximize />}
        </ControlButton>
        <ControlButton label={labels.help} onClick={onHelp}>
          <IconKeyboard />
        </ControlButton>
        {allowExit && (
          <>
            <Divider />
            <ControlButton label={labels.exit} onClick={onExit}>
              <IconLogout />
            </ControlButton>
          </>
        )}
      </div>

      <div
        data-slides2-chrome
        className={cn(
          "flex w-fit max-w-[calc(100vw-1.5rem)] items-center rounded-full border border-border bg-background/90 px-1 text-foreground shadow-xl backdrop-blur-md md:hidden",
          visible ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <ControlButton
          label={labels.previous}
          onClick={wrap(onPrevious)}
          disabled={!canPrevious}
          mobile
        >
          <IconChevronLeft />
        </ControlButton>
        <span className="min-w-14 px-1 text-center font-mono text-xs tabular-nums">
          {labels.position(total > 0 ? index + 1 : 0, total)}
        </span>
        <ControlButton
          label={labels.next}
          onClick={wrap(onNext)}
          disabled={!canNext}
          mobile
        >
          <IconChevronRight />
        </ControlButton>
        <Divider mobile />
        <ControlButton
          label={labels.overview}
          onClick={wrap(onOverview)}
          mobile
        >
          <IconGridDots />
        </ControlButton>
        {allowExit && (
          <ControlButton label={labels.exit} onClick={wrap(onExit)} mobile>
            <IconLogout />
          </ControlButton>
        )}
      </div>
    </div>
  );
}

function ControlButton({
  children,
  label,
  onClick,
  disabled,
  active,
  mobile = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  mobile?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "shrink-0 rounded-full text-foreground/85 hover:bg-accent focus-visible:ring-ring",
        mobile && "size-8",
        active && "bg-primary text-primary-foreground hover:bg-primary/90",
        disabled && "opacity-35",
      )}
    >
      {children}
    </Button>
  );
}

function Divider({ mobile = false }: { mobile?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mx-1 h-4 w-px shrink-0 bg-border",
        mobile && "mx-0.5 h-3.5",
      )}
    />
  );
}

function ElapsedClock({
  startedAt,
  label,
}: {
  startedAt: number;
  label: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timeout = setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    timeout = setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => clearTimeout(timeout);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return (
    <time
      aria-label={label}
      title={label}
      className="px-2 font-mono text-xs tabular-nums text-muted-foreground"
    >
      {pad(minutes)}:{pad(seconds)}
    </time>
  );
}
