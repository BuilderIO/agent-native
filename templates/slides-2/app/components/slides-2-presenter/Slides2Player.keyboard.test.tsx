// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./Slides2HelpDialog", () => ({ default: () => null }));
vi.mock("./Slides2JumpInput", () => ({ default: () => null }));
vi.mock("./Slides2ProgressBar", () => ({ default: () => null }));
vi.mock("./useSlides2TouchSwipe", () => ({
  useSlides2TouchSwipe: vi.fn(),
}));

import type { SlideFramePointerType } from "../slides-2-runtime/protocol";
import Slides2Player, {
  type Slides2PlayerProps,
  type Slides2PresenterLabels,
} from "./Slides2Player";

type FramePointerMove = (
  position: { x: number; y: number },
  pointerType: SlideFramePointerType,
) => void;
type FramePointerActivity = (pointerType: SlideFramePointerType) => void;

afterEach(cleanup);

const labels: Slides2PresenterLabels = {
  previous: "Previous",
  next: "Next",
  overview: "Overview",
  overviewTitle: "Slide overview",
  blackout: "Black screen",
  whiteout: "White screen",
  laser: "Laser pointer",
  presenter: "Presenter",
  enterFullscreen: "Enter fullscreen",
  exitFullscreen: "Exit fullscreen",
  fullscreenBlocked: "Enter fullscreen",
  help: "Help",
  helpTitle: "Help",
  exit: "Exit",
  close: "Close",
  elapsedTime: "Elapsed time",
  jumpHint: "Jump to slide",
  slideLabel: (index) => `Slide ${index}`,
  position: (index, total) => `${index} of ${total}`,
  shortcutNext: "Next",
  shortcutPrevious: "Previous",
  shortcutFirstLast: "First and last",
  shortcutJump: "Jump",
  shortcutOverview: "Overview",
  shortcutBlackout: "Black screen",
  shortcutWhiteout: "White screen",
  shortcutLaser: "Laser pointer",
  shortcutPresenter: "Presenter",
  shortcutHelp: "Help",
  shortcutExit: "Exit",
};

function renderPlayer(
  children: Slides2PlayerProps["children"] = <div>Slide content</div>,
) {
  const onIndexChange = vi.fn();
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const view = render(
    <Slides2Player
      index={1}
      total={4}
      canPrevious
      canNext
      onIndexChange={onIndexChange}
      onPrevious={onPrevious}
      onNext={onNext}
      onExit={vi.fn()}
      labels={labels}
      initialFullscreen={false}
    >
      {children}
    </Slides2Player>,
  );
  return { ...view, onIndexChange, onPrevious, onNext };
}

describe("Slides2Player keyboard navigation", () => {
  it("leaves system-modified navigation keys to the browser", () => {
    const { onIndexChange, onPrevious, onNext } = renderPlayer();

    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(window, { key: "PageDown", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Home", metaKey: true });
    fireEvent.keyDown(window, { key: "End", altKey: true });

    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("keeps Shift navigation available", () => {
    const { onNext } = renderPlayer();

    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });

    expect(onNext).toHaveBeenCalledOnce();
  });

  it("opens overview and navigates to the selected slide", () => {
    const { onIndexChange } = renderPlayer();

    fireEvent.keyDown(window, { key: "o" });

    fireEvent.click(screen.getByRole("button", { name: "Slide 3" }));

    expect(onIndexChange).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("dialog", { name: "Slide overview" })).toBeNull();
  });

  it("toggles black and white blackout and clears it on slide navigation", () => {
    const { container, onNext } = renderPlayer();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Black screen" })[0]!,
    );
    expect(
      container.querySelector('[aria-hidden="true"].z-20')?.className,
    ).toContain("bg-black");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Black screen" })[0]!,
    );
    expect(container.querySelector('[aria-hidden="true"].z-20')).toBeNull();

    fireEvent.click(
      screen.getAllByRole("button", { name: "White screen" })[0]!,
    );
    expect(
      container.querySelector('[aria-hidden="true"].z-20')?.className,
    ).toContain("bg-white");
    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(onNext).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-hidden="true"].z-20')).toBeNull();
  });

  it("toggles the laser pointer and tracks pointer movement", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return 1;
    });
    const { container } = renderPlayer();

    fireEvent.keyDown(window, { key: "l" });

    const laser = container.querySelector<HTMLDivElement>(
      '[aria-hidden="true"].fixed',
    );
    expect(laser).not.toBeNull();
    expect(laser?.className).toContain("opacity-0");
    fireEvent.pointerMove(window, { clientX: 100, clientY: 70 });
    expect(laser?.className).toContain("opacity-100");
    act(() => frames.shift()?.(performance.now()));
    expect(laser?.style.transform).toBe("translate3d(91px, 61px, 0)");

    fireEvent.keyDown(window, { key: "l" });
    expect(container.querySelector('[aria-hidden="true"].fixed')).toBeNull();
  });

  it("maps sandboxed slide pointer movement into viewport coordinates", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return 1;
    });
    let onFramePointerMove: FramePointerMove | null = null;
    const { container } = renderPlayer(({ onFramePointerMove: onMove }) => {
      onFramePointerMove = onMove;
      return <iframe data-slides-2-frame title="Slide" />;
    });
    const frame = container.querySelector<HTMLIFrameElement>(
      "iframe[data-slides-2-frame]",
    )!;
    Object.defineProperties(frame, {
      clientWidth: { configurable: true, value: 1920 },
      clientHeight: { configurable: true, value: 1080 },
    });
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 1060,
      bottom: 590,
      width: 960,
      height: 540,
      toJSON: () => ({}),
    });

    fireEvent.keyDown(window, { key: "l" });
    const laser = container.querySelector<HTMLDivElement>(
      '[aria-hidden="true"].fixed',
    );
    expect(laser?.className).toContain("opacity-0");
    act(() => onFramePointerMove?.({ x: 480, y: 270 }, "mouse"));

    expect(laser?.className).toContain("opacity-100");
    act(() => frames.shift()?.(performance.now()));
    expect(laser?.style.transform).toBe("translate3d(331px, 176px, 0)");
  });

  it("restores activity and reveals controls for iframe movement in the bottom hot zone", () => {
    vi.useFakeTimers();
    try {
      let onFramePointerMove: FramePointerMove | null = null;
      const { container } = renderPlayer(({ onFramePointerMove: onMove }) => {
        onFramePointerMove = onMove;
        return <iframe data-slides-2-frame title="Slide" />;
      });
      const frame = container.querySelector<HTMLIFrameElement>(
        "iframe[data-slides-2-frame]",
      )!;
      const frameRect = {
        x: 32,
        y: 0,
        left: 32,
        top: 0,
        right: window.innerWidth - 32,
        bottom: window.innerHeight,
        width: window.innerWidth - 64,
        height: window.innerHeight,
        toJSON: () => ({}),
      };
      Object.defineProperties(frame, {
        clientWidth: {
          configurable: true,
          value: frameRect.width * 2,
        },
        clientHeight: {
          configurable: true,
          value: frameRect.height * 2,
        },
      });
      vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(frameRect);

      act(() => vi.advanceTimersByTime(2300));

      const player = container.firstChild as HTMLElement;
      const chrome = container.querySelector<HTMLElement>(
        "[data-slides2-chrome]",
      )?.parentElement;
      expect(chrome?.getAttribute("data-state")).toBe("hidden");
      expect(player.className).toContain("cursor-none");

      act(() =>
        onFramePointerMove?.(
          {
            x: frame.clientWidth / 2,
            y: frame.clientHeight / 2,
          },
          "mouse",
        ),
      );

      expect(player.className).toContain("cursor-default");
      expect(chrome?.getAttribute("data-state")).toBe("hidden");

      act(() =>
        onFramePointerMove?.(
          {
            x: frame.clientWidth / 2,
            y: frame.clientHeight - 160,
          },
          "mouse",
        ),
      );

      expect(chrome?.getAttribute("data-state")).toBe("visible");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores mobile chrome and keyboard cursor mode for iframe touch movement", () => {
    vi.useFakeTimers();
    try {
      let onFramePointerMove: FramePointerMove | null = null;
      const { container, onNext } = renderPlayer(
        ({ onFramePointerMove: onMove }) => {
          onFramePointerMove = onMove;
          return <iframe data-slides-2-frame title="Slide" />;
        },
      );
      const frame = container.querySelector<HTMLIFrameElement>(
        "iframe[data-slides-2-frame]",
      )!;
      const frameRect = {
        x: 32,
        y: 0,
        left: 32,
        top: 0,
        right: window.innerWidth - 32,
        bottom: window.innerHeight,
        width: window.innerWidth - 64,
        height: window.innerHeight,
        toJSON: () => ({}),
      };
      Object.defineProperties(frame, {
        clientWidth: {
          configurable: true,
          value: frameRect.width,
        },
        clientHeight: {
          configurable: true,
          value: frameRect.height,
        },
      });
      vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(frameRect);

      act(() => vi.advanceTimersByTime(2300));

      const player = container.firstChild as HTMLElement;
      const chrome = container.querySelector<HTMLElement>(
        "[data-slides2-chrome]",
      )?.parentElement;
      expect(chrome?.getAttribute("data-state")).toBe("hidden");
      expect(player.className).toContain("cursor-none");

      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(onNext).toHaveBeenCalledOnce();
      expect(player.className).toContain("cursor-none");

      act(() =>
        onFramePointerMove?.(
          {
            x: frame.clientWidth / 2,
            y: frame.clientHeight / 2,
          },
          "touch",
        ),
      );

      expect(chrome?.getAttribute("data-state")).toBe("visible");
      expect(player.className).toContain("cursor-default");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores mobile chrome and activity for iframe touch down without movement", () => {
    vi.useFakeTimers();
    try {
      let onFramePointerActivity: FramePointerActivity | null = null;
      const { container, onNext } = renderPlayer(
        ({ onFramePointerActivity: onActivity }) => {
          onFramePointerActivity = onActivity;
          return <iframe data-slides-2-frame title="Slide" />;
        },
      );

      act(() => vi.advanceTimersByTime(2300));

      const player = container.firstChild as HTMLElement;
      const chrome = container.querySelector<HTMLElement>(
        "[data-slides2-chrome]",
      )?.parentElement;
      expect(chrome?.getAttribute("data-state")).toBe("hidden");
      expect(player.className).toContain("cursor-none");

      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(onNext).toHaveBeenCalledOnce();
      expect(player.className).toContain("cursor-none");

      act(() => onFramePointerActivity?.("touch"));

      expect(chrome?.getAttribute("data-state")).toBe("visible");
      expect(player.className).toContain("cursor-default");
    } finally {
      vi.useRealTimers();
    }
  });
});
