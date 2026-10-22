import { describe, expect, it } from "vitest";

import {
  isRecentWorkflowGeneration,
  workflowGenerationStaleAt,
} from "./workflow.js";

describe("isRecentWorkflowGeneration", () => {
  const now = Date.parse("2026-10-18T20:00:00.000Z");

  it("keeps a recent generation active", () => {
    expect(
      isRecentWorkflowGeneration(
        { status: "generating", requestedAt: "2026-10-18T19:51:00.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it("allows retrying a generation after the server timeout", () => {
    expect(
      isRecentWorkflowGeneration(
        { status: "generating", requestedAt: "2026-10-18T19:50:00.000Z" },
        now,
      ),
    ).toBe(false);
  });

  it("returns the exact retry boundary for a generating workflow", () => {
    expect(
      workflowGenerationStaleAt({
        status: "generating",
        requestedAt: "2026-10-18T19:51:00.000Z",
      }),
    ).toBe(Date.parse("2026-10-18T20:01:00.000Z"));
  });

  it("does not schedule retry timers for terminal or malformed workflows", () => {
    expect(
      workflowGenerationStaleAt({ status: "failed", requestedAt: "invalid" }),
    ).toBeNull();
    expect(
      workflowGenerationStaleAt({
        status: "generating",
        requestedAt: "invalid",
      }),
    ).toBeNull();
  });

  it("keeps malformed generation timestamps fail-closed", () => {
    expect(
      isRecentWorkflowGeneration(
        { status: "generating", requestedAt: "invalid" },
        now,
      ),
    ).toBe(true);
  });

  it("does not treat terminal workflows as active", () => {
    expect(
      isRecentWorkflowGeneration(
        { status: "failed", requestedAt: "2026-10-18T19:59:00.000Z" },
        now,
      ),
    ).toBe(false);
  });
});
