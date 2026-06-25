import { describe, expect, it } from "vitest";

import {
  mergeAgentNativeRouteWarmupConfig,
  normalizeAgentNativeRouteWarmupConfig,
  isAgentNativeRouteWarmupStrategy,
} from "./route-warmup-config.js";

describe("route warmup config normalization", () => {
  it("accepts only known route warmup strategy strings", () => {
    expect(isAgentNativeRouteWarmupStrategy("render")).toBe(true);
    expect(isAgentNativeRouteWarmupStrategy("hover")).toBe(false);
  });

  it("normalizes invalid strategy strings to the safe default", () => {
    expect(normalizeAgentNativeRouteWarmupConfig("hover" as any).strategy).toBe(
      "intent",
    );
    expect(
      normalizeAgentNativeRouteWarmupConfig({
        strategy: "eager" as any,
        selector: "",
        maxConcurrent: -1,
      }),
    ).toMatchObject({
      strategy: "intent",
      selector: 'a[data-an-prefetch="render"][href]',
      maxConcurrent: 4,
    });
  });

  it("merges runtime partial overrides with build-time config", () => {
    expect(
      mergeAgentNativeRouteWarmupConfig(
        {
          strategy: "viewport",
          data: true,
          modules: true,
          selector: "a[data-warm-route][href]",
          maxConcurrent: 8,
        },
        { data: false },
      ),
    ).toEqual({
      strategy: "viewport",
      data: false,
      modules: true,
      selector: "a[data-warm-route][href]",
      maxConcurrent: 8,
    });
  });

  it("lets runtime strategy shorthands override only strategy", () => {
    expect(
      mergeAgentNativeRouteWarmupConfig(
        {
          strategy: "viewport",
          data: false,
          modules: true,
          selector: "a[data-warm-route][href]",
          maxConcurrent: 8,
        },
        "render",
      ),
    ).toEqual({
      strategy: "render",
      data: false,
      modules: true,
      selector: "a[data-warm-route][href]",
      maxConcurrent: 8,
    });
  });
});
