// @agent-native/pinpoint — freezeWAAPI tests
// MIT License
//
// freezeWAAPI() only touches `document.getAnimations()` plus the Animation
// objects it returns, so it's testable without jsdom/happy-dom by installing
// a minimal fake `document.getAnimations` (this package has no DOM test
// environment available — see selector-builder.spec.ts for details). The
// fake Animation objects are plain, real state machines (pause()/play()
// actually flip `playState`), not mocks that fake the assertions themselves.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { freezeWAAPI } from "./waapi-freeze.js";

interface FakeAnimation {
  playState: "idle" | "running" | "paused" | "finished";
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
}

function makeAnimation(playState: FakeAnimation["playState"]): FakeAnimation {
  const animation: FakeAnimation = {
    playState,
    pause: vi.fn(),
    play: vi.fn(),
  };
  animation.pause.mockImplementation(() => {
    animation.playState = "paused";
  });
  animation.play.mockImplementation(() => {
    animation.playState = "running";
  });
  return animation;
}

function withAnimations(animations: FakeAnimation[]): void {
  (globalThis as any).document = {
    getAnimations: () => animations,
  };
}

let originalDocument: unknown;

beforeEach(() => {
  originalDocument = (globalThis as any).document;
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as any).document;
  } else {
    (globalThis as any).document = originalDocument;
  }
});

describe("freezeWAAPI", () => {
  it("pauses only the animations that were running", () => {
    const running1 = makeAnimation("running");
    const alreadyPaused = makeAnimation("paused");
    const running2 = makeAnimation("running");
    withAnimations([running1, alreadyPaused, running2]);

    freezeWAAPI();

    expect(running1.pause).toHaveBeenCalledTimes(1);
    expect(running2.pause).toHaveBeenCalledTimes(1);
    expect(alreadyPaused.pause).not.toHaveBeenCalled();
  });

  it("resumes only the animations it paused, not ones already paused before freeze", () => {
    const running1 = makeAnimation("running");
    const alreadyPaused = makeAnimation("paused");
    withAnimations([running1, alreadyPaused]);

    const unfreeze = freezeWAAPI();
    unfreeze();

    expect(running1.play).toHaveBeenCalledTimes(1);
    expect(alreadyPaused.play).not.toHaveBeenCalled();
  });

  it("swallows errors from play() during unfreeze (e.g. an animation that was removed)", () => {
    const flaky = makeAnimation("running");
    flaky.play.mockImplementation(() => {
      throw new Error("animation was removed from the document");
    });
    const healthy = makeAnimation("running");
    withAnimations([flaky, healthy]);

    const unfreeze = freezeWAAPI();
    expect(() => unfreeze()).not.toThrow();

    // The healthy animation after flaky in iteration order must still be resumed.
    expect(flaky.play).toHaveBeenCalledTimes(1);
    expect(healthy.play).toHaveBeenCalledTimes(1);
  });

  it("is a no-op cleanup when there are no animations at all", () => {
    withAnimations([]);
    const unfreeze = freezeWAAPI();
    expect(() => unfreeze()).not.toThrow();
  });

  it("is a no-op cleanup when every animation is already paused", () => {
    const alreadyPaused = makeAnimation("paused");
    withAnimations([alreadyPaused]);

    const unfreeze = freezeWAAPI();
    unfreeze();

    expect(alreadyPaused.pause).not.toHaveBeenCalled();
    expect(alreadyPaused.play).not.toHaveBeenCalled();
  });
});
