import { describe, it, expect } from "vitest";

/**
 * This test file documents the expected behavior of the BuilderSourceStatus
 * component's state determination logic (lines 1435-1450 in DesignSystemSetup.tsx).
 *
 * The state machine prioritizes document count (proof of completion) over status:
 * 1. If docCount > 0: "indexed" (proof of work, status-independent)
 * 2. Else if builder.warning OR status is terminal failure (error/failed/cancelled): "unavailable"
 * 3. Else if actively indexing (status in [in-progress, pending, processing]): "indexing"
 * 4. Else: "indexing" (fallback for uninitialized or unrecognized status)
 *
 * Regression test for: https://github.com/BuilderIO/agent-native/issues/ENG-13035
 * Bug: Previously, status checks alone allowed error/failed statuses to display as "Indexing..." forever.
 * Fix: Use docCount > 0 as primary proof of completion, independent of status field stability.
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

    // Primary indicator: if docCount > 0, indexing is complete regardless of status.
    // This is more robust than status alone, which can get stuck.
    const hasIndexedResults = docs > 0 || tokens > 0;
    const isTerminalFailure = ["error", "failed", "cancelled", "canceled"].includes(
      normalizedStatus ?? "",
    );
    const isIndexing = ["in-progress", "pending", "processing"].includes(
      normalizedStatus ?? "",
    );

    return hasIndexedResults
      ? "indexed"
      : builder.warning || isTerminalFailure
        ? "unavailable"
        : isIndexing
          ? "indexing"
          : "indexing"; // Fallback for uninitialized/unknown status
  }

  describe("doc count (primary indicator)", () => {
    it("shows 'indexed' when docCount > 0 regardless of status", () => {
      expect(
        computeState({
          builderStatus: "in-progress",
          docCount: 5,
          tokenValues: { color: "#fff" },
        }),
      ).toBe("indexed");
    });

    it("shows 'indexed' when docCount > 0 even with 'pending' status", () => {
      expect(
        computeState({
          builderStatus: "pending",
          docCount: 3,
          tokenValues: {},
        }),
      ).toBe("indexed");
    });

    it("shows 'indexed' when docCount > 0 even with error status (stuck job)", () => {
      // Regression: if a system has docs but status stuck at error, show indexed
      expect(
        computeState({
          builderStatus: "error",
          docCount: 2,
          tokenValues: { color: "#000" },
        }),
      ).toBe("indexed");
    });

    it("shows 'indexed' when tokenValues present (docs implicitly > 0)", () => {
      expect(
        computeState({
          builderStatus: "in-progress",
          docCount: 0,
          tokenValues: { primary: "#fff", secondary: "#000" },
        }),
      ).toBe("indexed");
    });

    it("shows 'indexed' when docs array present (fallback for docCount)", () => {
      expect(
        computeState({
          builderStatus: "in-progress",
          docCount: undefined,
          docs: [{ name: "Button.tsx" }, { name: "Card.tsx" }],
          tokenValues: {},
        }),
      ).toBe("indexed");
    });
  });

  describe("active indexing (when docCount = 0)", () => {
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

    it("shows 'indexed' even if status is failed but docCount > 0 (doc count takes priority)", () => {
      // New logic: docCount > 0 is proof of work, so show indexed regardless of failure status
      // This handles the stuck-status case: if a system has docs, it's done indexing
      expect(
        computeState({
          builderStatus: "failed",
          docCount: 2,
          tokenValues: {},
        }),
      ).toBe("indexed");
    });
  });

  describe("builder warning", () => {
    it("shows 'indexed' when builder.warning is set but docCount > 0 (docCount takes priority)", () => {
      // New logic: if docCount > 0, show indexed (proof of work complete)
      // Warning is only checked when docCount = 0
      expect(
        computeState({
          builderStatus: "ready",
          warning: "Some warning message",
          docCount: 5,
          tokenValues: { color: "#fff" },
        }),
      ).toBe("indexed");
    });

    it("shows 'unavailable' when builder.warning is set and docCount = 0", () => {
      expect(
        computeState({
          builderStatus: "ready",
          warning: "Some warning message",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("unavailable");
    });
  });

  describe("ready statuses (only matter when docCount > 0)", () => {
    it("shows 'indexed' when docCount > 0 and status is 'ready'", () => {
      expect(
        computeState({
          builderStatus: "ready",
          docCount: 3,
          tokenValues: {},
        }),
      ).toBe("indexed");
    });

    it("shows 'indexed' when docCount > 0 and status is 'complete'", () => {
      expect(
        computeState({
          builderStatus: "complete",
          docCount: 5,
          tokenValues: {},
        }),
      ).toBe("indexed");
    });

    it("shows 'indexed' when docCount > 0 and status is 'completed'", () => {
      expect(
        computeState({
          builderStatus: "completed",
          docCount: 2,
          tokenValues: {},
        }),
      ).toBe("indexed");
    });

    it("shows 'indexing' (fallback) when docCount = 0 and status is 'ready' (no results to prove completion)", () => {
      // New logic: status doesn't determine state when docCount = 0
      // Without documents, we can't prove indexing completed
      expect(
        computeState({
          builderStatus: "ready",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexing");
    });
  });

  describe("case insensitivity", () => {
    it("treats status comparison as case-insensitive for isIndexing", () => {
      expect(
        computeState({
          builderStatus: "IN-PROGRESS",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("indexing");
    });

    it("treats status comparison as case-insensitive for isTerminalFailure", () => {
      expect(
        computeState({
          builderStatus: "ERROR",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("unavailable");

      expect(
        computeState({
          builderStatus: "FAILED",
          docCount: 0,
          tokenValues: {},
        }),
      ).toBe("unavailable");
    });

    it("docCount > 0 takes priority regardless of case", () => {
      expect(
        computeState({
          builderStatus: "IN-PROGRESS",
          docCount: 5,
          tokenValues: {},
        }),
      ).toBe("indexed");
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
