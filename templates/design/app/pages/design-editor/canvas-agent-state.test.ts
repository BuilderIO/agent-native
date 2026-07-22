import { describe, expect, it } from "vitest";

import {
  deriveCanvasAgentState,
  type CanvasAgentState,
  type CanvasAgentStateInputs,
} from "./canvas-agent-state";

const NOW = 1_000_000;

function inputs(
  overrides: Partial<CanvasAgentStateInputs> = {},
): CanvasAgentStateInputs {
  return {
    generating: false,
    generationIssue: false,
    pendingQuestionCount: 0,
    resolveNodeRewritePending: false,
    offline: false,
    lastRunCompletedAt: null,
    ...overrides,
  };
}

describe("deriveCanvasAgentState", () => {
  describe("each signal in isolation resolves to its state", () => {
    const cases: Array<
      [string, Partial<CanvasAgentStateInputs>, CanvasAgentState]
    > = [
      ["generationIssue", { generationIssue: true }, "failed"],
      ["pendingQuestionCount", { pendingQuestionCount: 2 }, "needs-answer"],
      [
        "resolveNodeRewritePending",
        { resolveNodeRewritePending: true },
        "applying",
      ],
      ["generating", { generating: true }, "working"],
      ["offline", { offline: true }, "warning"],
      ["recent completion", { lastRunCompletedAt: NOW - 100 }, "done"],
      ["nothing active", {}, "ready"],
    ];
    for (const [label, override, expected] of cases) {
      it(`${label} -> ${expected}`, () => {
        expect(deriveCanvasAgentState(inputs(override), NOW)).toBe(expected);
      });
    }
  });

  describe("pairwise priority conflicts (higher priority always wins)", () => {
    it("failed beats needs-answer", () => {
      expect(
        deriveCanvasAgentState(
          inputs({ generationIssue: true, pendingQuestionCount: 3 }),
          NOW,
        ),
      ).toBe("failed");
    });

    it("needs-answer beats applying", () => {
      expect(
        deriveCanvasAgentState(
          inputs({ pendingQuestionCount: 1, resolveNodeRewritePending: true }),
          NOW,
        ),
      ).toBe("needs-answer");
    });

    it("applying beats working", () => {
      expect(
        deriveCanvasAgentState(
          inputs({ resolveNodeRewritePending: true, generating: true }),
          NOW,
        ),
      ).toBe("applying");
    });

    it("working beats warning", () => {
      expect(
        deriveCanvasAgentState(
          inputs({ generating: true, offline: true }),
          NOW,
        ),
      ).toBe("working");
    });

    it("warning beats done", () => {
      expect(
        deriveCanvasAgentState(
          inputs({ offline: true, lastRunCompletedAt: NOW - 100 }),
          NOW,
        ),
      ).toBe("warning");
    });

    it("done beats ready", () => {
      expect(
        deriveCanvasAgentState(inputs({ lastRunCompletedAt: NOW - 100 }), NOW),
      ).toBe("done");
    });
  });

  describe("done window decay", () => {
    it("reports done strictly inside the window", () => {
      expect(
        deriveCanvasAgentState(
          inputs({ lastRunCompletedAt: NOW - 3999 }),
          NOW,
          4000,
        ),
      ).toBe("done");
    });

    it("returns ready exactly at the window boundary", () => {
      expect(
        deriveCanvasAgentState(
          inputs({ lastRunCompletedAt: NOW - 4000 }),
          NOW,
          4000,
        ),
      ).toBe("ready");
    });

    it("returns ready after the window has elapsed", () => {
      expect(
        deriveCanvasAgentState(
          inputs({ lastRunCompletedAt: NOW - 8000 }),
          NOW,
          4000,
        ),
      ).toBe("ready");
    });

    it("honors a custom window", () => {
      expect(
        deriveCanvasAgentState(
          inputs({ lastRunCompletedAt: NOW - 500 }),
          NOW,
          400,
        ),
      ).toBe("ready");
      expect(
        deriveCanvasAgentState(
          inputs({ lastRunCompletedAt: NOW - 300 }),
          NOW,
          400,
        ),
      ).toBe("done");
    });

    it("treats a null completion timestamp as ready", () => {
      expect(
        deriveCanvasAgentState(inputs({ lastRunCompletedAt: null }), NOW),
      ).toBe("ready");
    });
  });
});
