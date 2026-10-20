// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));

vi.mock("@agent-native/core/client/analytics", () => ({
  track: mocks.track,
}));

import {
  firstDeckReadyView,
  runWhenTabVisible,
  trackSlidesRelay,
} from "./slides-relay-tracking";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  mocks.track.mockClear();
});

afterEach(() => {
  setVisibility("visible");
});

describe("trackSlidesRelay", () => {
  afterEach(() => {
    delete (window as { __AGENT_NATIVE_SYNTHETIC_TRAFFIC__?: unknown })
      .__AGENT_NATIVE_SYNTHETIC_TRAFFIC__;
  });

  it("never throws into the flow it describes", async () => {
    mocks.track.mockImplementationOnce(() => {
      throw new Error("storage blocked");
    });
    expect(() => trackSlidesRelay("deck_exported", {})).not.toThrow();

    mocks.track.mockImplementationOnce(() =>
      Promise.reject(new Error("network down")),
    );
    expect(() => trackSlidesRelay("deck_exported", {})).not.toThrow();
    await Promise.resolve();
  });

  it("drops events from synthetic test traffic", () => {
    Object.assign(window, { __AGENT_NATIVE_SYNTHETIC_TRAFFIC__: "beta-e2e" });

    trackSlidesRelay("presented", { output_id: "deck-1" });

    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("adds the Slides app keys", () => {
    trackSlidesRelay("deck_ready_viewed", { output_id: "deck-1" });

    expect(mocks.track).toHaveBeenCalledWith("deck_ready_viewed", {
      output_id: "deck-1",
      app_name: "slides",
      template_name: "slides",
    });
  });
});

describe("firstDeckReadyView", () => {
  it("allows one send per attempt in the page", () => {
    expect(firstDeckReadyView("attempt-a")).toBe(true);
    expect(firstDeckReadyView("attempt-a")).toBe(false);
    expect(firstDeckReadyView("attempt-b")).toBe(true);
  });
});

describe("runWhenTabVisible", () => {
  it("runs immediately when the tab is visible", () => {
    setVisibility("visible");
    const callback = vi.fn();

    runWhenTabVisible(callback);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("waits for the tab to become visible, once", () => {
    setVisibility("hidden");
    const callback = vi.fn();

    runWhenTabVisible(callback);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).not.toHaveBeenCalled();

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("never runs once cancelled", () => {
    setVisibility("hidden");
    const callback = vi.fn();

    const cancel = runWhenTabVisible(callback);
    cancel();
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(callback).not.toHaveBeenCalled();
  });
});
