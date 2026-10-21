// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trackDesignRelay: vi.fn() }));

vi.mock("@/lib/design-relay-tracking", () => ({
  trackDesignRelay: mocks.trackDesignRelay,
}));

import {
  __resetCanvasOutcomeTrackingForTests,
  flushCanvasOutcomeCounts,
  setCanvasOutcomeContext,
} from "@/lib/canvas-outcome-tracking";

import { commitTextContentChange } from "./text-content-change-result";

function totals(): Record<string, number> {
  flushCanvasOutcomeCounts();
  const out: Record<string, number> = {};
  for (const [, props] of mocks.trackDesignRelay.mock.calls) {
    const { operation, outcome, reason, count } = props as Record<
      string,
      string | number
    >;
    const key = `${operation}/${outcome}/${reason}`;
    out[key] = (out[key] ?? 0) + Number(count);
  }
  mocks.trackDesignRelay.mockReset();
  return out;
}

function commitArgs(
  overrides: Partial<Parameters<typeof commitTextContentChange>[0]>,
) {
  return {
    owner: "screen",
    nodeId: "text-1",
    value: "Hello",
    isPendingTextCreation: false,
    commit: () => "accepted" as const,
    queueHostCommit: vi.fn(() => false),
    cancelHostCommit: vi.fn(),
    requestSnapshot: vi.fn(),
    ...overrides,
  };
}

describe("text edit outcomes", () => {
  beforeEach(() => {
    __resetCanvasOutcomeTrackingForTests();
    setCanvasOutcomeContext({ designId: undefined, signedIn: true });
    mocks.trackDesignRelay.mockReset();
  });

  it("counts an accepted edit once", () => {
    commitTextContentChange(commitArgs({}));
    expect(totals()).toEqual({ "text_edit/succeeded/none": 1 });
  });

  it("counts a refused edit as failed even though it reports published", () => {
    const result = commitTextContentChange(
      commitArgs({ commit: () => "refused" as const }),
    );
    expect(result).toBe("published");
    expect(totals()).toEqual({ "text_edit/failed/refused": 1 });
  });

  it("counts a refusal queued for retry once, as deferred", () => {
    let settle: ((outcome: "accepted" | "failed") => void) | undefined;
    const result = commitTextContentChange(
      commitArgs({
        isPendingTextCreation: true,
        commit: () => "refused" as const,
        queueHostCommit: vi.fn((_owner, _node, _text, onSettled) => {
          settle = onSettled;
          return true;
        }),
      }),
    );
    expect(result).toBe("fallback-queued");
    expect(totals()).toEqual({ "text_edit/deferred/fallback_queued": 1 });

    // The retry counts on its own, so the edit is never counted twice.
    settle!("accepted");
    expect(totals()).toEqual({ "text_retry/succeeded/none": 1 });
  });

  it("counts a retry that could not write the text as failed", () => {
    commitTextContentChange(
      commitArgs({
        isPendingTextCreation: true,
        commit: () => "refused" as const,
        // Settles before the queue call returns, as a retry with no writer does.
        queueHostCommit: vi.fn((_owner, _node, _text, onSettled) => {
          onSettled?.("failed");
          return true;
        }),
      }),
    );
    expect(totals()).toEqual({
      "text_edit/deferred/fallback_queued": 1,
      "text_retry/failed/not_written": 1,
    });
  });

  it("counts a refusal that could not be queued as failed", () => {
    commitTextContentChange(
      commitArgs({
        isPendingTextCreation: true,
        commit: () => "refused" as const,
        queueHostCommit: vi.fn(() => false),
      }),
    );
    expect(totals()).toEqual({ "text_edit/failed/refused": 1 });
  });

  it("counts a commit that throws as failed and rethrows", () => {
    const error = new Error("boom");
    expect(() =>
      commitTextContentChange(
        commitArgs({
          commit: () => {
            throw error;
          },
        }),
      ),
    ).toThrow(error);
    expect(totals()).toEqual({ "text_edit/failed/exception": 1 });
  });
});
