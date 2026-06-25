import { describe, expect, it } from "vitest";

import { CONTEXT_XRAY_MODEL_LIMIT, resolveContextWindow } from "./format.js";

describe("resolveContextWindow", () => {
  it("returns the fallback constant when no model is provided", () => {
    expect(resolveContextWindow()).toBe(CONTEXT_XRAY_MODEL_LIMIT);
    expect(resolveContextWindow(null)).toBe(CONTEXT_XRAY_MODEL_LIMIT);
    expect(resolveContextWindow("")).toBe(CONTEXT_XRAY_MODEL_LIMIT);
  });

  it("returns 1M for claude-sonnet-4-6 (1M context model)", () => {
    expect(resolveContextWindow("claude-sonnet-4-6")).toBe(1_000_000);
  });

  it("returns 200K for claude-haiku-4-5 (standard context model)", () => {
    expect(resolveContextWindow("claude-haiku-4-5")).toBe(200_000);
  });

  it("returns 1.05M for gpt-5.5 (large context model)", () => {
    expect(resolveContextWindow("gpt-5.5")).toBe(1_050_000);
  });

  it("returns 1M for gemini-3.5-flash", () => {
    expect(resolveContextWindow("gemini-3.5-flash")).toBe(1_048_576);
  });

  it("falls back to 128K for completely unknown models", () => {
    expect(resolveContextWindow("unknown-future-model")).toBe(128_000);
  });

  it("CONTEXT_XRAY_MODEL_LIMIT is 200K (backward-compat constant)", () => {
    expect(CONTEXT_XRAY_MODEL_LIMIT).toBe(200_000);
  });
});
