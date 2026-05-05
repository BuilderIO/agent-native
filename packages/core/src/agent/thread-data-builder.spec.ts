import { describe, expect, it } from "vitest";
import { buildAssistantMessage } from "./thread-data-builder.js";
import type { RunEvent } from "./types.js";

describe("buildAssistantMessage", () => {
  it("does not persist partial output from internal continuation boundaries", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "partial answer" } },
      { seq: 1, event: { type: "auto_continue", reason: "run_timeout" } },
    ];

    expect(
      buildAssistantMessage(events, "run-timeout", {
        suppressInternalContinuation: true,
      }),
    ).toBeNull();
  });

  it("does not persist partial output from suppressed loop-limit boundaries", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "partial answer" } },
      { seq: 1, event: { type: "loop_limit", maxIterations: 50 } },
    ];

    expect(
      buildAssistantMessage(events, "run-loop-limit", {
        suppressInternalContinuation: true,
      }),
    ).toBeNull();
  });

  it("does not persist partial output from recoverable gateway errors when suppressed", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "checking..." } },
      {
        seq: 1,
        event: {
          type: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
        },
      },
    ];

    expect(
      buildAssistantMessage(events, "run-gateway-timeout", {
        suppressInternalContinuation: true,
      }),
    ).toBeNull();
  });

  it("persists recoverable errors by default for non-continuation server paths", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "checking..." } },
      {
        seq: 1,
        event: {
          type: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
        },
      },
    ];

    const message = buildAssistantMessage(events, "run-gateway-timeout");

    expect(message?.content).toEqual([
      {
        type: "text",
        text: "checking...\n\nError: Builder gateway timed out after 45s",
      },
    ]);
    expect(message?.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("still persists non-recoverable errors", () => {
    const events: RunEvent[] = [
      { seq: 0, event: { type: "text", text: "checking..." } },
      {
        seq: 1,
        event: {
          type: "error",
          error: "Missing API key",
          errorCode: "missing_api_key",
        },
      },
    ];

    const message = buildAssistantMessage(events, "run-missing-key");

    expect(message?.content).toEqual([
      { type: "text", text: "checking...\n\nError: Missing API key" },
    ]);
    expect(message?.status).toEqual({ type: "incomplete", reason: "error" });
  });
});
