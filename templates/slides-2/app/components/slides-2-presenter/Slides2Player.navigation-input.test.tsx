// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./Slides2HelpDialog", () => ({ default: () => null }));
vi.mock("./Slides2JumpInput", () => ({ default: () => null }));
vi.mock("./Slides2ProgressBar", () => ({ default: () => null }));
vi.mock("./useSlides2TouchSwipe", () => ({
  useSlides2TouchSwipe: vi.fn(),
}));

import type {
  Slides2PlayerProps,
  Slides2PresenterLabels,
} from "./Slides2Player";
import Slides2Player from "./Slides2Player";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

function renderPlayer(children: Slides2PlayerProps["children"] = null) {
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
      controls={false}
    >
      {children ?? <div>Slide content</div>}
    </Slides2Player>,
  );
  const root = view.container.firstElementChild as HTMLElement;

  return { ...view, root, onIndexChange, onPrevious, onNext };
}

function setPlayerBounds(root: HTMLElement) {
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
    toJSON: () => ({}),
  });
}

function dispatchWheel(
  target: Element,
  init: WheelEventInit & { deltaY: number },
) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if ("ctrlKey" in init) {
    Object.defineProperty(event, "ctrlKey", { value: init.ctrlKey });
  }
  fireEvent(target, event);
  return event;
}

function controlPerformanceTime(initialTime = 500) {
  let currentTime = initialTime;
  vi.spyOn(performance, "now").mockImplementation(() => currentTime);
  return {
    set: (time: number) => {
      currentTime = time;
    },
  };
}

describe("Slides2Player click navigation", () => {
  it.each([
    ["left edge", 29, "previous"],
    ["right edge", 71, "next"],
  ] as const)("navigates from the %s", (_edge, clientX, direction) => {
    const { root, onPrevious, onNext } = renderPlayer();
    setPlayerBounds(root);

    fireEvent.click(root, { clientX, clientY: 50 });

    expect(onPrevious).toHaveBeenCalledTimes(direction === "previous" ? 1 : 0);
    expect(onNext).toHaveBeenCalledTimes(direction === "next" ? 1 : 0);
  });

  it("keeps the center and the exact 30% boundaries inert", () => {
    const { root, onPrevious, onNext } = renderPlayer();
    setPlayerBounds(root);

    for (const clientX of [30, 50, 70]) {
      fireEvent.click(root, { clientX, clientY: 50 });
    }

    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("ignores buttons and marked interactive slide content", () => {
    const { root, getByTestId, onPrevious, onNext } = renderPlayer(
      <>
        <button data-testid="button">Slide control</button>
        <div data-testid="interactive" data-slides2-interactive>
          Interactive content
        </div>
        <div data-testid="chrome" data-slides2-chrome>
          Player chrome
        </div>
        <div data-testid="editable" contentEditable="true" />
      </>,
    );
    setPlayerBounds(root);

    fireEvent.click(getByTestId("button"), { clientX: 5, clientY: 50 });
    fireEvent.click(getByTestId("interactive"), {
      clientX: 95,
      clientY: 50,
    });
    fireEvent.click(getByTestId("chrome"), { clientX: 95, clientY: 50 });
    fireEvent.click(getByTestId("editable"), { clientX: 5, clientY: 50 });

    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe("Slides2Player wheel navigation", () => {
  it("accumulates pixel deltas until the 12 px threshold is reached", () => {
    const { root, onNext, onPrevious } = renderPlayer();
    const clock = controlPerformanceTime();

    const first = dispatchWheel(root, { deltaY: 6 });
    expect(first.defaultPrevented).toBe(true);
    expect(onNext).not.toHaveBeenCalled();

    clock.set(520);
    dispatchWheel(root, { deltaY: 5 });
    expect(onNext).not.toHaveBeenCalled();

    clock.set(540);
    const threshold = dispatchWheel(root, { deltaY: 1 });
    expect(threshold.defaultPrevented).toBe(true);
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it("ignores modifier, zoomed-viewport, and interactive-target wheel input", () => {
    const { root, getByTestId, onNext, onPrevious } = renderPlayer(
      <>
        <input data-testid="input" />
        <textarea data-testid="textarea" />
        <select data-testid="select" />
        <div data-testid="editable" contentEditable="true" />
        <div data-testid="ignored" data-wheel-nav-ignore>
          Wheel ignored
        </div>
      </>,
    );
    const clock = controlPerformanceTime();

    dispatchWheel(root, { deltaY: 12, ctrlKey: true });
    expect(onNext, "modifier wheel input").not.toHaveBeenCalled();
    let currentTime = 520;
    for (const testId of [
      "input",
      "textarea",
      "select",
      "editable",
      "ignored",
    ]) {
      clock.set(currentTime);
      dispatchWheel(getByTestId(testId), { deltaY: 12 });
      expect(onNext, `wheel input from ${testId}`).not.toHaveBeenCalled();
      currentTime += 20;
    }

    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { scale: 1.5 },
    });
    try {
      clock.set(700);
      dispatchWheel(root, { deltaY: 12 });
      expect(onNext, "zoomed viewport wheel input").not.toHaveBeenCalled();
    } finally {
      if (originalVisualViewport) {
        Object.defineProperty(window, "visualViewport", originalVisualViewport);
      } else {
        Reflect.deleteProperty(window, "visualViewport");
      }
    }

    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it("navigates only when the vertical delta dominates", () => {
    const { root, onNext, onPrevious } = renderPlayer();
    const clock = controlPerformanceTime();

    dispatchWheel(root, { deltaX: 12, deltaY: 12 });
    clock.set(520);
    dispatchWheel(root, { deltaX: 13, deltaY: 12 });

    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();

    clock.set(540);
    dispatchWheel(root, { deltaX: 11, deltaY: 12 });

    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it("allows one navigation per 100 ms cooldown", () => {
    const { root, onNext } = renderPlayer();
    const clock = controlPerformanceTime();

    dispatchWheel(root, { deltaY: 12 });
    expect(onNext).toHaveBeenCalledOnce();

    clock.set(550);
    const duringCooldown = dispatchWheel(root, { deltaY: 12 });
    expect(duringCooldown.defaultPrevented).toBe(true);
    expect(onNext).toHaveBeenCalledOnce();

    clock.set(600);
    dispatchWheel(root, { deltaY: 12 });
    expect(onNext).toHaveBeenCalledTimes(2);
  });
});
