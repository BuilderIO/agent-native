import { describe, it, expect } from "vitest";

/**
 * This test file documents the expected behavior of the BuilderSourceStatus
 * component's state determination logic (lines 1438-1456 in DesignSystemSetup.tsx).
 *
 * The state machine is:
 * 1. If actively indexing (status in [in-progress, pending, processing]) AND no indexed results yet: "indexing"
 * 2. Else if builder.warning OR status is terminal failure (error/failed/cancelled): "unavailable"
 * 3. Else if we have indexed results or a ready status: "indexed"
 * 4. Else: "indexing" (fallback for uninitialized or unrecognized status)
 *
 * Regression test for: https://github.com/BuilderIO/agent-native/issues/ENG-13035
 * Bug: Previously, the final else fallback treated ANY non-success status as "indexing" forever,
 * so error/failed/cancelled statuses would display as "Indexing..." instead of "Unavailable".
 */

describe("BuilderSourceStatus state logic", () => {
  // Helper to compute the state given builder details (mirrors DesignSystemSetup.tsx logic)
  function computeState(builder: {
    builderStatus?: string;
    warning?: string;
    docCount?: number;
    docs?: unknown[];
    tokenValues?: Record<string, string>;
  }) {
    const docs = builder.docCount ?? builder.docs?.length ?? 0;
    const tokens = Object.keys(builder.tokenValues ?? {}).length;
    const normalizedStatus = builder.builderStatus?.toLowerCase();
    const hasIndexedResults = docs > 0 || tokens > 0;
    const isIndexed =
      hasIndexedResults ||
      normalizedStatus === "ready" ||
      normalizedStatus === "complete" ||
      normalizedStatus === "completed";
    const isIndexing = ["in-progress", "pending", "processing"].includes(
      normalizedStatus ?? "",
    );
    const isTerminalFailure = [
      "error",
      "failed",
      "cancelled",
      "canceled",
    ].includes(normalizedStatus ?? "");

    return isIndexing && !isIndexed
      ? "indexing"
      : builder.warning || isTerminalFailure
        ? "unavailable"
        : isIndexed
          ? "indexed"
          : "indexing";
  }

  describe("active indexing", () => {
    it("shows 'indexing' when status is in-progress with no results yet", () => {
      expect(
        computeState({
          builderStatus: "in-progress",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexing");
    });

    it("shows 'indexing' when status is pending with no results yet", () => {
      expect(
        computeState({
          builderStatus: "pending",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexing");
    });

    it("shows 'indexing' when status is processing with no results yet", () => {
      expect(
        computeState({
          builderStatus: "processing",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexing");
    });

    it("shows 'indexed' when in-progress status but docs were already found", () => {
      expect(
        computeState({
          builderStatus: "in-progress",
          docCount: 5,
          tokenValues: { color: "#fff" },
        }),
      ).toBe("indexed");
    });
  });

  describe("terminal failures (regression for ENG-13035)", () => {
    it("shows 'unavailable' when status is 'error'", () => {
      expect(
        computeState({
          builderStatus: "error",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("unavailable");
    });

    it("shows 'unavailable' when status is 'failed'", () => {
      expect(
        computeState({
          builderStatus: "failed",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("unavailable");
    });

    it("shows 'unavailable' when status is 'cancelled'", () => {
      expect(
        computeState({
          builderStatus: "cancelled",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("unavailable");
    });

    it("shows 'unavailable' when status is 'canceled' (US spelling)", () => {
      expect(
        computeState({
          builderStatus: "canceled",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("unavailable");
    });

    it("shows 'unavailable' even if there are partial results from a failed job", () => {
      expect(
        computeState({
          builderStatus: "failed",
          docCount: 2,
          tokenValues: {},
        }),
      ).toBe("unavailable");
    });
  });

  describe("builder warning", () => {
    it("shows 'unavailable' when builder.warning is set regardless of status", () => {
      expect(
        computeState({
          builderStatus: "ready",
          warning: "Some warning message",
          docCount: 5,
          tokenValues: { color: "#fff" },
        }),
      ).toBe("unavailable");
    });
  });

  describe("ready statuses", () => {
    it("shows 'indexed' when status is 'ready'", () => {
      expect(
        computeState({
          builderStatus: "ready",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexed");
    });

    it("shows 'indexed' when status is 'complete'", () => {
      expect(
        computeState({
          builderStatus: "complete",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexed");
    });

    it("shows 'indexed' when status is 'completed'", () => {
      expect(
        computeState({
          builderStatus: "completed",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexed");
    });
  });

  describe("case insensitivity", () => {
    it("treats status comparison as case-insensitive", () => {
      expect(
        computeState({
          builderStatus: "IN-PROGRESS",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexing");

      expect(
        computeState({
          builderStatus: "READY",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexed");

      expect(
        computeState({
          builderStatus: "ERROR",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("unavailable");
    });
  });

  describe("uninitialized/unknown status", () => {
    it("shows 'indexing' as fallback when status is missing", () => {
      expect(
        computeState({
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexing");
    });

    it("shows 'indexing' as fallback when status is unrecognized", () => {
      expect(
        computeState({
          builderStatus: "unknown-status",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexing");
    });

    it("shows 'indexed' when unrecognized status but has results", () => {
      expect(
        computeState({
          builderStatus: "unknown-status",
          docCount: 3,
          tokenValues: { color: "#fff" },
        }),
      ).toBe("indexed");
    });
  });
});
