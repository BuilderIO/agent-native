import { describe, it, expect, afterEach } from "vitest";

import {
  SYSTEM_PROMPT_CACHE_SPLIT,
  splitSystemPromptForCache,
  stablePrefixCacheControl,
} from "./prompt-cache.js";

afterEach(() => {
  delete process.env.AGENT_PROMPT_CACHE_TTL;
});

describe("splitSystemPromptForCache", () => {
  it("treats a prompt with no sentinel as entirely stable", () => {
    expect(splitSystemPromptForCache("all stable")).toEqual({
      stable: "all stable",
      volatile: "",
    });
  });

  it("drops the sentinel so the rendered prompt is unchanged", () => {
    const { stable, volatile } = splitSystemPromptForCache(
      `base${SYSTEM_PROMPT_CACHE_SPLIT}resources`,
    );
    expect(stable).toBe("base");
    expect(volatile).toBe("resources");
    expect(stable + volatile).toBe("baseresources");
  });

  // Engines that do not split forward the sentinel to the model, so it has to
  // stay zero-width rather than becoming a readable marker.
  it("is a zero-width character", () => {
    expect(SYSTEM_PROMPT_CACHE_SPLIT).toBe("\u200b");
  });
});

describe("stablePrefixCacheControl", () => {
  it("uses the gateway-compatible ephemeral cache by default", () => {
    expect(stablePrefixCacheControl()).toEqual({
      type: "ephemeral",
    });
  });

  it("opts into the 1h TTL explicitly", () => {
    process.env.AGENT_PROMPT_CACHE_TTL = "1h";
    expect(stablePrefixCacheControl()).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("keeps the provider default when 5m is selected", () => {
    process.env.AGENT_PROMPT_CACHE_TTL = "5m";
    expect(stablePrefixCacheControl()).toEqual({ type: "ephemeral" });
  });
});
