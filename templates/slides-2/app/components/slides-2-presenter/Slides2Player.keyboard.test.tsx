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
import type {
  FrameKeyboard,
  FramePointer,
} from "../slides-2-runtime/SandboxedSlide";
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
  total = 4,
  initialFullscreen = false,
) {
  const onIndexChange = vi.fn();
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const createPlayer = (index: number) => (
    <Slides2Player
      index={index}
      total={total}
      canPrevious
      canNext
      onIndexChange={onIndexChange}
      onPrevious={onPrevious}
      onNext={onNext}
      onExit={vi.fn()}
      labels={labels}
      initialFullscreen={initialFullscreen}
    >
      {children}
    </Slides2Player>
  );
  const view = render(createPlayer(1));
  return {
    ...view,
    onIndexChange,
    onPrevious,
    onNext,
    rerenderAtIndex: (index: number) => view.rerender(createPlayer(index)),
  };
}

function frameKeyboard(overrides: Partial<FrameKeyboard> = {}): FrameKeyboard {
  return {
    key: "ArrowRight",
    keyCode: 39,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isTypingTarget: false,
    isControlTarget: false,
    isComposing: false,
    ...overrides,
  };
}

function framePointer(overrides: Partial<FramePointer> = {}): FramePointer {
  return {
    phase: "down",
    x: 200,
    y: 200,
    button: 0,
    pointerId: 1,
    pointerType: "touch",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    ...overrides,
  };
}

describe("Slides2Player keyboard navigation", () => {
  it("navigates when a slide frame forwards a keyboard event", () => {
    let sendFrameKeyboard: ((keyboard: FrameKeyboard) => void) | null = null;
    const { onNext } = renderPlayer(({ onFrameKeyboard }) => {
      sendFrameKeyboard = onFrameKeyboard;
      return <div>Slide content</div>;
    });

    act(() => sendFrameKeyboard?.(frameKeyboard()));

    expect(onNext).toHaveBeenCalledOnce();
  });

  it.each([
    ["typing", frameKeyboard({ isTypingTarget: true })],
    ["a slide control", frameKeyboard({ isControlTarget: true })],
    ["an active composition", frameKeyboard({ isComposing: true })],
    ["the legacy IME key", frameKeyboard({ keyCode: 229 })],
  ])("ignores frame keyboard input from %s", (_target, keyboard) => {
    let sendFrameKeyboard: ((keyboard: FrameKeyboard) => void) | null = null;
    const { onNext } = renderPlayer(({ onFrameKeyboard }) => {
      sendFrameKeyboard = onFrameKeyboard;
      return <div>Slide content</div>;
    });

    act(() => sendFrameKeyboard?.(keyboard));

    expect(onNext).not.toHaveBeenCalled();
  });

  it("keeps presenter modifier behavior for forwarded keys", () => {
    let sendFrameKeyboard: ((keyboard: FrameKeyboard) => void) | null = null;
    const { onIndexChange, onNext } = renderPlayer(({ onFrameKeyboard }) => {
      sendFrameKeyboard = onFrameKeyboard;
      return <div>Slide content</div>;
    });

    act(() =>
      sendFrameKeyboard?.(frameKeyboard({ key: "ArrowRight", ctrlKey: true })),
    );
    act(() =>
      sendFrameKeyboard?.(
        frameKeyboard({ key: "3", keyCode: 51, ctrlKey: true }),
      ),
    );

    expect(onNext).toHaveBeenCalledOnce();
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("recognizes the document fullscreen element after the editor handoff", () => {
    const originalFullscreen = Object.getOwnPropertyDescriptor(
      document,
      "fullscreenElement",
    );
    const originalExit = Object.getOwnPropertyDescriptor(
      document,
      "exitFullscreen",
    );
    const originalRequest = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "requestFullscreen",
    );
    const requestFullscreen = vi.fn(() => Promise.resolve());

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    try {
      renderPlayer(undefined, 4, true);

      expect(requestFullscreen).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Exit fullscreen" }),
      ).toBeTruthy();
    } finally {
      cleanup();
      if (originalFullscreen) {
        Object.defineProperty(
          document,
          "fullscreenElement",
          originalFullscreen,
        );
      } else {
        Reflect.deleteProperty(document, "fullscreenElement");
      }
      if (originalExit) {
        Object.defineProperty(document, "exitFullscreen", originalExit);
      } else {
        Reflect.deleteProperty(document, "exitFullscreen");
      }
      if (originalRequest) {
        Object.defineProperty(
          HTMLElement.prototype,
          "requestFullscreen",
          originalRequest,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
      }
    }
  });

  it("keeps the requested windowed presentation from auto-entering fullscreen", () => {
    const currentLocation = new URL(window.location.href);
    const originalRequest = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "requestFullscreen",
    );
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    window.history.replaceState({}, "", "/?windowed=1");

    try {
      renderPlayer(undefined, 4, true);

      expect(requestFullscreen).not.toHaveBeenCalled();
      expect(
        screen.getAllByRole("button", { name: "Enter fullscreen" }),
      ).toHaveLength(1);
    } finally {
      cleanup();
      window.history.replaceState(
        {},
        "",
        `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`,
      );
      if (originalRequest) {
        Object.defineProperty(
          HTMLElement.prototype,
          "requestFullscreen",
          originalRequest,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
      }
    }
  });

  it("offers a windowed fallback when the fullscreen request throws", () => {
    const originalFullscreen = Object.getOwnPropertyDescriptor(
      document,
      "fullscreenElement",
    );
    const originalRequest = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "requestFullscreen",
    );
    const requestFullscreen = vi.fn(() => {
      throw new Error("Fullscreen is unavailable");
    });

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    try {
      renderPlayer(undefined, 4, true);

      expect(requestFullscreen).toHaveBeenCalledOnce();
      expect(
        screen.getAllByRole("button", { name: "Enter fullscreen" }),
      ).toHaveLength(2);
    } finally {
      cleanup();
      if (originalFullscreen) {
        Object.defineProperty(
          document,
          "fullscreenElement",
          originalFullscreen,
        );
      } else {
        Reflect.deleteProperty(document, "fullscreenElement");
      }
      if (originalRequest) {
        Object.defineProperty(
          HTMLElement.prototype,
          "requestFullscreen",
          originalRequest,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
      }
    }
  });

  it("keeps system-modified navigation keys active", () => {
    const { onIndexChange, onPrevious, onNext } = renderPlayer();

    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(window, { key: "PageDown", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Home", metaKey: true });
    fireEvent.keyDown(window, { key: "End", altKey: true });

    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onIndexChange).toHaveBeenCalledTimes(2);
    expect(onIndexChange).toHaveBeenNthCalledWith(1, 0);
    expect(onIndexChange).toHaveBeenNthCalledWith(2, 3);
  });

  it("leaves presenter keys inside editable slide content alone", () => {
    const { onNext } = renderPlayer(
      <span data-testid="editable-content">Editable content</span>,
    );
    const editableContent = screen.getByTestId("editable-content");
    editableContent.setAttribute("contenteditable", "plaintext-only");
    Object.defineProperty(editableContent, "isContentEditable", {
      configurable: true,
      value: true,
    });

    fireEvent.keyDown(editableContent, { key: "ArrowRight" });

    expect(onNext).not.toHaveBeenCalled();
  });

  it("keeps Space available to activate a focused presenter button", () => {
    const { onNext, onPrevious } = renderPlayer();
    const previousButton = screen.getAllByRole("button", {
      name: "Previous",
    })[0]!;
    previousButton.focus();

    fireEvent.keyDown(previousButton, { key: " " });

    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();

    fireEvent.click(previousButton);

    expect(onPrevious).toHaveBeenCalledOnce();
  });

  it("keeps Shift navigation available", () => {
    const { onNext } = renderPlayer();

    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });

    expect(onNext).toHaveBeenCalledOnce();
  });

  it("commits a typed slide number after the input settles", () => {
    vi.useFakeTimers();
    try {
      const { onIndexChange } = renderPlayer();

      fireEvent.keyDown(window, { key: "3" });
      expect(onIndexChange).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1199));
      expect(onIndexChange).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1));
      expect(onIndexChange).toHaveBeenCalledWith(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps an idle numeric jump to the last slide", () => {
    vi.useFakeTimers();
    try {
      const { onIndexChange } = renderPlayer();

      fireEvent.keyDown(window, { key: "9" });
      act(() => vi.advanceTimersByTime(1200));

      expect(onIndexChange).toHaveBeenCalledOnce();
      expect(onIndexChange).toHaveBeenCalledWith(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits a typed slide number immediately when Enter is pressed", () => {
    vi.useFakeTimers();
    try {
      const { onIndexChange } = renderPlayer();

      fireEvent.keyDown(window, { key: "3" });
      fireEvent.keyDown(window, { key: "Enter" });

      expect(onIndexChange).toHaveBeenCalledOnce();
      expect(onIndexChange).toHaveBeenCalledWith(2);

      act(() => vi.advanceTimersByTime(1200));
      expect(onIndexChange).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps an Enter numeric jump to the last slide", () => {
    vi.useFakeTimers();
    try {
      const { onIndexChange } = renderPlayer();

      fireEvent.keyDown(window, { key: "9" });
      fireEvent.keyDown(window, { key: "Enter" });

      expect(onIndexChange).toHaveBeenCalledOnce();
      expect(onIndexChange).toHaveBeenCalledWith(3);

      act(() => vi.advanceTimersByTime(1200));
      expect(onIndexChange).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the first four digits of a longer numeric jump", () => {
    vi.useFakeTimers();
    try {
      const { onIndexChange } = renderPlayer(undefined, 1234);

      for (const key of ["1", "2", "3", "4", "5"]) {
        fireEvent.keyDown(window, { key });
      }
      fireEvent.keyDown(window, { key: "Enter" });

      expect(onIndexChange).toHaveBeenCalledOnce();
      expect(onIndexChange).toHaveBeenCalledWith(1233);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending number jump when a presenter control is activated", () => {
    vi.useFakeTimers();
    try {
      const { onIndexChange, onPrevious } = renderPlayer();

      fireEvent.keyDown(window, { key: "3" });
      fireEvent.click(screen.getAllByRole("button", { name: "Previous" })[0]!);
      act(() => vi.advanceTimersByTime(1200));

      expect(onPrevious).toHaveBeenCalledOnce();
      expect(onIndexChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending number jump after slide pointer activity", () => {
    vi.useFakeTimers();
    try {
      let onFramePointerActivity: FramePointerActivity | null = null;
      const { onIndexChange } = renderPlayer(
        ({ onFramePointerActivity: onActivity }) => {
          onFramePointerActivity = onActivity;
          return <div>Slide content</div>;
        },
      );

      fireEvent.keyDown(window, { key: "3" });
      act(() => onFramePointerActivity?.("mouse"));
      act(() => vi.advanceTimersByTime(1200));

      expect(onIndexChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending number jump when the current slide changes externally", () => {
    vi.useFakeTimers();
    try {
      const { onIndexChange, rerenderAtIndex } = renderPlayer();

      fireEvent.keyDown(window, { key: "3" });
      rerenderAtIndex(2);
      act(() => vi.advanceTimersByTime(1200));

      expect(onIndexChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
      return <iframe data-slides2-frame title="Slide" />;
    });
    const frame = container.querySelector<HTMLIFrameElement>(
      "iframe[data-slides2-frame]",
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

  it("navigates on a horizontal touch swipe inside a sandboxed slide", () => {
    let onFramePointer: ((pointer: FramePointer) => void) | null = null;
    const { container, onNext } = renderPlayer(
      ({ onFramePointer: onPointer }) => {
        onFramePointer = onPointer;
        return <iframe data-slides2-frame title="Slide" />;
      },
    );
    const frame = container.querySelector<HTMLIFrameElement>(
      "iframe[data-slides2-frame]",
    )!;
    Object.defineProperties(frame, {
      clientWidth: { configurable: true, value: 1920 },
      clientHeight: { configurable: true, value: 1080 },
    });
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 960,
      bottom: 540,
      width: 960,
      height: 540,
      toJSON: () => ({}),
    });
    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);

    try {
      act(() => onFramePointer?.(framePointer({ x: 400, y: 400 })));
      now = 1100;
      act(() =>
        onFramePointer?.(
          framePointer({ phase: "up", x: 300, y: 400, pointerId: 1 }),
        ),
      );

      expect(onNext).toHaveBeenCalledOnce();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("ignores vertical and multi-finger gestures inside sandboxed slides", () => {
    let onFramePointer: ((pointer: FramePointer) => void) | null = null;
    const { container, onPrevious, onNext } = renderPlayer(
      ({ onFramePointer: onPointer }) => {
        onFramePointer = onPointer;
        return <iframe data-slides2-frame title="Slide" />;
      },
    );
    const frame = container.querySelector<HTMLIFrameElement>(
      "iframe[data-slides2-frame]",
    )!;
    Object.defineProperties(frame, {
      clientWidth: { configurable: true, value: 1920 },
      clientHeight: { configurable: true, value: 1080 },
    });
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 960,
      bottom: 540,
      width: 960,
      height: 540,
      toJSON: () => ({}),
    });
    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);

    try {
      act(() => onFramePointer?.(framePointer({ x: 400, y: 400 })));
      now = 1100;
      act(() =>
        onFramePointer?.(
          framePointer({ phase: "up", x: 400, y: 300, pointerId: 1 }),
        ),
      );

      act(() => onFramePointer?.(framePointer({ pointerId: 2 })));
      act(() =>
        onFramePointer?.(framePointer({ pointerId: 3, x: 500, y: 400 })),
      );
      now = 1200;
      act(() =>
        onFramePointer?.(
          framePointer({ phase: "up", pointerId: 2, x: 300, y: 400 }),
        ),
      );
      act(() =>
        onFramePointer?.(
          framePointer({ phase: "up", pointerId: 3, x: 400, y: 400 }),
        ),
      );

      expect(onPrevious).not.toHaveBeenCalled();
      expect(onNext).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("restores activity and reveals controls for iframe movement in the bottom hot zone", () => {
    vi.useFakeTimers();
    try {
      let onFramePointerMove: FramePointerMove | null = null;
      const { container } = renderPlayer(({ onFramePointerMove: onMove }) => {
        onFramePointerMove = onMove;
        return <iframe data-slides2-frame title="Slide" />;
      });
      const frame = container.querySelector<HTMLIFrameElement>(
        "iframe[data-slides2-frame]",
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
          return <iframe data-slides2-frame title="Slide" />;
        },
      );
      const frame = container.querySelector<HTMLIFrameElement>(
        "iframe[data-slides2-frame]",
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
          return <iframe data-slides2-frame title="Slide" />;
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
