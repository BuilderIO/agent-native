import { describe, expect, it } from "vitest";

import { assertCaptureTransition, isCaptureTerminal } from "./motion-capture";

describe("capture lifecycle", () => {
  it("does not let a queued request claim actual capture", () => {
    expect(() => assertCaptureTransition("queued", "recording")).toThrow();
    expect(() => assertCaptureTransition("queued", "complete")).toThrow();
    expect(() => assertCaptureTransition("starting", "complete")).toThrow();
  });
  it("keeps stop requests nonterminal until recorder acknowledgement", () => {
    expect(isCaptureTerminal("stop-requested")).toBe(false);
    expect(() =>
      assertCaptureTransition("recording", "stop-requested"),
    ).not.toThrow();
    expect(() =>
      assertCaptureTransition("stop-requested", "recording"),
    ).toThrow();
    expect(() =>
      assertCaptureTransition("stop-requested", "finalizing"),
    ).not.toThrow();
  });
  it("permits idempotent reports but never resurrects terminal capture", () => {
    expect(() => assertCaptureTransition("complete", "complete")).not.toThrow();
    expect(() => assertCaptureTransition("failed", "starting")).toThrow();
    expect(() => assertCaptureTransition("complete", "recording")).toThrow();
  });
});
