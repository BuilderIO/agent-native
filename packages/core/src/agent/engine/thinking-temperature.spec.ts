import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetThinkingTemperatureWarningForTests,
  temperatureForThinkingRequest,
} from "./thinking-temperature.js";

const ctx = { engine: "anthropic-engine", model: "claude-sonnet-4-5" };

beforeEach(() => {
  __resetThinkingTemperatureWarningForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("temperatureForThinkingRequest", () => {
  // The exact combination that 400s: "`temperature` may only be set to 1 when
  // thinking is enabled or in adaptive mode."
  it("drops a non-1 temperature when a thinking block is present", () => {
    expect(temperatureForThinkingRequest(0.7, true, ctx)).toBeUndefined();
  });

  it("keeps an explicit 1, which the provider accepts alongside thinking", () => {
    expect(temperatureForThinkingRequest(1, true, ctx)).toBe(1);
  });

  it("leaves the temperature alone when thinking is off", () => {
    expect(temperatureForThinkingRequest(0.7, false, ctx)).toBe(0.7);
    expect(temperatureForThinkingRequest(0, false, ctx)).toBe(0);
  });

  it("passes through an absent temperature either way", () => {
    expect(temperatureForThinkingRequest(undefined, true, ctx)).toBeUndefined();
    expect(
      temperatureForThinkingRequest(undefined, false, ctx),
    ).toBeUndefined();
  });

  // 0 is falsy: a truthiness check here would silently keep it and 400.
  it("drops a temperature of 0 rather than treating it as absent", () => {
    expect(temperatureForThinkingRequest(0, true, ctx)).toBeUndefined();
  });

  // Dropping an explicit request is a silent change unless it says so.
  it("warns once, naming the value and model, rather than dropping quietly", () => {
    temperatureForThinkingRequest(0.7, true, ctx);

    expect(console.warn).toHaveBeenCalledTimes(1);
    const message = vi.mocked(console.warn).mock.calls[0]?.[0] as string;
    expect(message).toContain("0.7");
    expect(message).toContain("claude-sonnet-4-5");
  });

  it("does not repeat the warning on every request", () => {
    for (let i = 0; i < 5; i += 1) {
      temperatureForThinkingRequest(0.7, true, ctx);
    }

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when there is nothing to reconcile", () => {
    temperatureForThinkingRequest(1, true, ctx);
    temperatureForThinkingRequest(0.7, false, ctx);
    temperatureForThinkingRequest(undefined, true, ctx);

    expect(console.warn).not.toHaveBeenCalled();
  });
});
