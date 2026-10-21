// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trackDesignRelay: vi.fn() }));

vi.mock("./design-relay-tracking", () => ({
  trackDesignRelay: mocks.trackDesignRelay,
}));

import { canvasLoadReadyBucket } from "./canvas-load-outcome";
import {
  CANVAS_OUTCOME_COUNTS_EVENT,
  clearCanvasOutcomeDesign,
  CANVAS_OUTCOME_FLUSH_MS,
  __resetCanvasOutcomeTrackingForTests,
  flushCanvasOutcomeCounts,
  holdLiveSaveFromReplayCounts,
  recordCanvasOutcome,
  recordSaveReplayOutcomes,
  runCanvasOperation,
  runDetachedCanvasOperation,
  setCanvasOutcomeContext,
} from "./canvas-outcome-tracking";
import { canvasStyleKind } from "./canvas-style-kind";

type Sent = {
  operation: string;
  outcome: string;
  reason: string;
  count: number;
  batch_id: string;
  window_ms: number;
  design_id?: string;
  ready_bucket?: string;
  style_kind?: string;
};

function sent(): Sent[] {
  return mocks.trackDesignRelay.mock.calls.map(([name, props]) => {
    expect(name).toBe(CANVAS_OUTCOME_COUNTS_EVENT);
    return props as Sent;
  });
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function requests(): number {
  return mocks.trackDesignRelay.mock.calls.length;
}

function totals(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of sent()) {
    const key = `${event.operation}/${event.outcome}/${event.reason}`;
    out[key] = (out[key] ?? 0) + event.count;
  }
  return out;
}

describe("canvas outcome tracking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetCanvasOutcomeTrackingForTests();
    setCanvasOutcomeContext({ designId: undefined, signedIn: true });
    mocks.trackDesignRelay.mockReset();
  });

  afterEach(() => {
    setVisibility("visible");
    vi.useRealTimers();
  });

  describe("one outcome per operation", () => {
    it("counts a success once", () => {
      runCanvasOperation("style_commit", (op) => op.succeed());
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "style_commit/succeeded/none": 1 });
    });

    it("counts a run that reports nothing as unsettled, never success", () => {
      runCanvasOperation("style_commit", () => {});
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "style_commit/unsettled/none": 1 });
    });

    it("counts a throw as failed and rethrows the original error", () => {
      const error = new Error("boom");
      expect(() =>
        runCanvasOperation("style_commit", () => {
          throw error;
        }),
      ).toThrow(error);
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "style_commit/failed/exception": 1 });
    });

    it("lets a failure outrank an earlier success in the same run", () => {
      runCanvasOperation("style_commit", (op) => {
        op.succeed();
        op.fail("patch_failed");
        op.succeed();
      });
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "style_commit/failed/patch_failed": 1 });
    });

    it("keeps the first failure reason", () => {
      runCanvasOperation("style_commit", (op) => {
        op.fail("selector_missing");
        op.fail("patch_failed");
      });
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "style_commit/failed/selector_missing": 1 });
    });

    it("never counts deferred work as success", () => {
      runCanvasOperation("style_commit", (op) => {
        op.defer("runtime_pending");
      });
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({
        "style_commit/deferred/runtime_pending": 1,
      });
    });

    it("maps an unknown reason to unknown instead of sending free text", () => {
      runCanvasOperation("style_commit", (op) =>
        op.fail("Cannot read properties of null" as never),
      );
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "style_commit/failed/unknown": 1 });
    });
  });

  describe("nesting", () => {
    it("rolls a nested operation into the outer one, counting once", () => {
      runCanvasOperation("text_edit", (outer) => {
        runCanvasOperation("style_commit", (inner) => inner.succeed());
        outer.succeed();
      });
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "text_edit/succeeded/none": 1 });
    });

    it("gives the outer operation an inner failure's reason", () => {
      runCanvasOperation("text_edit", (outer) => {
        runCanvasOperation("style_commit", (inner) =>
          inner.fail("selector_missing"),
        );
        outer.succeed();
      });
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "text_edit/failed/selector_missing": 1 });
    });

    it("never lets a detached operation join the running one", () => {
      runCanvasOperation("style_commit", (op) => {
        runDetachedCanvasOperation("save", (save) => save.succeed());
        op.succeed();
      });
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({
        "style_commit/succeeded/none": 1,
        "save/succeeded/none": 1,
      });
    });

    it("counts sequential operations separately", () => {
      runCanvasOperation("style_commit", (op) => op.succeed());
      runCanvasOperation("style_commit", (op) => op.succeed());
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "style_commit/succeeded/none": 2 });
    });
  });

  describe("work that finishes later", () => {
    it("waits for a continuation before counting", () => {
      let resume: ((run: (op: never) => void) => void) | null = null;
      runCanvasOperation("style_commit", (op) => {
        resume = op.continueLater() as never;
      });
      flushCanvasOutcomeCounts();
      expect(sent()).toHaveLength(0);

      resume!((op: { fail(reason: string): void }) => op.fail("patch_failed"));
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "style_commit/failed/patch_failed": 1 });
    });

    it("counts a continuation that reports nothing as unsettled", () => {
      let resume: ((run: () => void) => void) | null = null;
      runCanvasOperation("style_commit", (op) => {
        resume = op.continueLater();
      });
      resume!(() => {});
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "style_commit/unsettled/none": 1 });
    });

    it("counts a continuation once but always runs its work", () => {
      let resume: ((run: (op: { succeed(): void }) => void) => void) | null =
        null;
      runCanvasOperation("style_commit", (op) => {
        resume = op.continueLater();
      });
      const work = vi.fn((op: { succeed(): void }) => op.succeed());
      resume!(work);
      resume!(work);
      flushCanvasOutcomeCounts();
      expect(work).toHaveBeenCalledTimes(2);
      expect(totals()).toEqual({ "style_commit/succeeded/none": 1 });
    });

    it("runs a continuation's work even after its operation was counted", () => {
      runCanvasOperation("style_commit", (op) => op.succeed());
      let late: ((run: () => void) => void) | null = null;
      runCanvasOperation("style_commit", (op) => {
        op.succeed();
        late = op.continueLater();
      });
      const work = vi.fn();
      late!(work);
      late!(work);
      expect(work).toHaveBeenCalledTimes(2);
    });

    it("counts a promise when it settles", async () => {
      const done = runDetachedCanvasOperation("save", async (op) => {
        await Promise.resolve();
        op.defer("offline_queued");
      });
      flushCanvasOutcomeCounts();
      expect(sent()).toHaveLength(0);
      await done;
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "save/deferred/offline_queued": 1 });
    });

    it("counts a rejected promise as failed and keeps the rejection", async () => {
      const error = new Error("network");
      const done = runDetachedCanvasOperation("save", async () => {
        throw error;
      });
      await expect(done).rejects.toBe(error);
      flushCanvasOutcomeCounts();
      expect(totals()).toEqual({ "save/failed/exception": 1 });
    });
  });

  describe("sending", () => {
    it("batches counts and sends them once the window ends", () => {
      for (let i = 0; i < 30; i += 1) {
        runCanvasOperation("style_commit", (op) => op.succeed());
      }
      expect(sent()).toHaveLength(0);
      vi.advanceTimersByTime(CANVAS_OUTCOME_FLUSH_MS);
      expect(sent()).toEqual([
        expect.objectContaining({
          operation: "style_commit",
          outcome: "succeeded",
          reason: "none",
          count: 30,
          window_ms: CANVAS_OUTCOME_FLUSH_MS,
        }),
      ]);
    });

    it("does not restart the window on later counts", () => {
      runCanvasOperation("style_commit", (op) => op.succeed());
      vi.advanceTimersByTime(CANVAS_OUTCOME_FLUSH_MS - 1_000);
      runCanvasOperation("style_commit", (op) => op.succeed());
      vi.advanceTimersByTime(1_000);
      expect(totals()).toEqual({ "style_commit/succeeded/none": 2 });
    });

    it("sends the first failure of a kind at once, and only that key", () => {
      runCanvasOperation("style_commit", (op) => op.succeed());
      runCanvasOperation("style_commit", (op) => op.fail("patch_failed"));
      expect(totals()).toEqual({ "style_commit/failed/patch_failed": 1 });

      runCanvasOperation("style_commit", (op) => op.fail("patch_failed"));
      expect(sent()).toHaveLength(1);

      vi.advanceTimersByTime(CANVAS_OUTCOME_FLUSH_MS);
      expect(totals()).toEqual({
        "style_commit/failed/patch_failed": 2,
        "style_commit/succeeded/none": 1,
      });
    });

    it("holds counts while the page is hidden and sends them when it shows", () => {
      runCanvasOperation("style_commit", (op) => op.succeed());
      setVisibility("hidden");
      vi.advanceTimersByTime(CANVAS_OUTCOME_FLUSH_MS * 2);
      expect(requests()).toBe(0);

      setVisibility("visible");
      expect(sent()).toEqual([
        expect.objectContaining({
          count: 1,
          window_ms: CANVAS_OUTCOME_FLUSH_MS * 2,
        }),
      ]);
    });

    it("holds a failure recorded while the page is hidden", () => {
      setVisibility("hidden");
      runCanvasOperation("style_commit", (op) => op.fail("patch_failed"));
      expect(requests()).toBe(0);
      setVisibility("visible");
      expect(totals()).toEqual({ "style_commit/failed/patch_failed": 1 });
    });

    it("gives every key in one send the same batch id", () => {
      runCanvasOperation("style_commit", (op) => op.succeed());
      runCanvasOperation("text_edit", (op) => op.succeed());
      flushCanvasOutcomeCounts();
      const [first, second] = sent();
      expect(first.batch_id).toBeTruthy();
      expect(second.batch_id).toBe(first.batch_id);
    });

    it("keeps pending counts under the design they were recorded in", () => {
      setCanvasOutcomeContext({ designId: "design-a", signedIn: true });
      runCanvasOperation("style_commit", (op) => op.succeed());
      setCanvasOutcomeContext({ designId: "design-b", signedIn: true });
      runCanvasOperation("style_commit", (op) => op.succeed());
      flushCanvasOutcomeCounts();
      expect(sent().map((event) => event.design_id)).toEqual([
        "design-a",
        "design-b",
      ]);
    });

    it("folds keys past the cap into an overflow key that keeps the outcome", () => {
      const reasons = [
        "conflict",
        "dropped",
        "error",
        "offline",
        "rebased",
        "stale_mirror",
        "superseded",
        "aborted",
      ] as const;
      const operations = [
        "save",
        "save_replay",
        "style_commit",
        "text_edit",
      ] as const;
      const outcomes = ["succeeded", "skipped"] as const;
      // 8 reasons x 4 operations x 2 outcomes = 64 distinct keys, past the cap of 50.
      for (const reason of reasons) {
        for (const operation of operations) {
          for (const outcome of outcomes) {
            recordCanvasOutcome(operation, outcome, reason);
          }
        }
      }
      flushCanvasOutcomeCounts();

      const events = sent();
      const overflow = events.filter((event) => event.operation === "overflow");
      expect(events.length).toBeLessThanOrEqual(52);
      expect(overflow.map((event) => event.outcome).sort()).toEqual(
        expect.arrayContaining(["skipped"]),
      );
      expect(overflow.every((event) => event.reason === "overflow")).toBe(true);
      expect(events.reduce((sum, event) => sum + event.count, 0)).toBe(64);
    });

    it("still sends on the timer when the visibility listener cannot be installed", () => {
      const addEventListener = vi
        .spyOn(document, "addEventListener")
        .mockImplementation(() => {
          throw new Error("no document listeners");
        });
      try {
        __resetCanvasOutcomeTrackingForTests();
        setCanvasOutcomeContext({ designId: undefined, signedIn: true });
        expect(addEventListener).toHaveBeenCalled();
        runCanvasOperation("style_commit", (op) => op.succeed());
        vi.advanceTimersByTime(CANVAS_OUTCOME_FLUSH_MS);
        expect(totals()).toEqual({ "style_commit/succeeded/none": 1 });
      } finally {
        addEventListener.mockRestore();
      }
    });

    it("never throws into the edit when the relay throws", () => {
      mocks.trackDesignRelay.mockImplementation(() => {
        throw new Error("relay down");
      });
      expect(() =>
        runCanvasOperation("style_commit", (op) => op.fail("patch_failed")),
      ).not.toThrow();
      expect(() => flushCanvasOutcomeCounts()).not.toThrow();
    });
  });

  describe("who counts are sent for", () => {
    it("sends one event per distinct count, not per action", () => {
      for (let i = 0; i < 10; i += 1) {
        runCanvasOperation("style_commit", (op) => op.succeed());
      }
      runCanvasOperation("text_edit", (op) => op.succeed());
      flushCanvasOutcomeCounts();
      expect(requests()).toBe(2);
      expect(totals()).toEqual({
        "style_commit/succeeded/none": 10,
        "text_edit/succeeded/none": 1,
      });
    });

    it("sends a signed-out viewer's counts through the browser beacon", () => {
      setCanvasOutcomeContext({ designId: "design-a", signedIn: false });
      runCanvasOperation("style_commit", (op) => op.fail("patch_failed"));
      expect(mocks.trackDesignRelay).toHaveBeenCalledWith(
        CANVAS_OUTCOME_COUNTS_EVENT,
        expect.objectContaining({ reason: "patch_failed" }),
        { signedIn: false },
      );
    });

    it("sends a signed-in viewer's counts through the relay", () => {
      runCanvasOperation("style_commit", (op) => op.fail("patch_failed"));
      expect(mocks.trackDesignRelay).toHaveBeenCalledWith(
        CANVAS_OUTCOME_COUNTS_EVENT,
        expect.anything(),
        { signedIn: true },
      );
    });

    it("holds counts while the session loads, then sends them once", () => {
      setCanvasOutcomeContext({ designId: "design-a", signedIn: undefined });
      runCanvasOperation("style_commit", (op) => op.fail("patch_failed"));
      runCanvasOperation("style_commit", (op) => op.succeed());
      vi.advanceTimersByTime(CANVAS_OUTCOME_FLUSH_MS);
      expect(requests()).toBe(0);

      setCanvasOutcomeContext({ designId: "design-a", signedIn: true });
      vi.advanceTimersByTime(CANVAS_OUTCOME_FLUSH_MS);
      expect(totals()).toEqual({
        "style_commit/failed/patch_failed": 1,
        "style_commit/succeeded/none": 1,
      });
    });

    it("keeps a chained save under the design it was queued for", () => {
      setCanvasOutcomeContext({ designId: "design-b", signedIn: true });
      runDetachedCanvasOperation("save", (op) => op.succeed(), {
        designId: "design-a",
      });
      flushCanvasOutcomeCounts();
      expect(sent()).toEqual([
        expect.objectContaining({ operation: "save", design_id: "design-a" }),
      ]);
    });

    it("keeps a late save under the design it started in", async () => {
      setCanvasOutcomeContext({ designId: "design-a", signedIn: true });
      let finish!: () => void;
      const saving = runDetachedCanvasOperation(
        "save",
        (op) =>
          new Promise<void>((resolve) => {
            finish = () => {
              op.succeed();
              resolve();
            };
          }),
      );
      setCanvasOutcomeContext({ designId: "design-b", signedIn: true });
      finish();
      await saving;
      flushCanvasOutcomeCounts();
      expect(sent()).toEqual([
        expect.objectContaining({ operation: "save", design_id: "design-a" }),
      ]);
    });

    it("still sends counts after the editor closes", () => {
      setCanvasOutcomeContext({ designId: "design-a", signedIn: true });
      runCanvasOperation("style_commit", (op) => op.succeed());
      clearCanvasOutcomeDesign();
      expect(sent()).toEqual([
        expect.objectContaining({ design_id: "design-a" }),
      ]);
      recordCanvasOutcome("save", "succeeded", "none", {
        designId: "design-a",
      });
      flushCanvasOutcomeCounts();
      expect(sent()).toHaveLength(2);
    });
  });

  it("counts finished file-save replays only", () => {
    const fileSave = { actionName: "update-file", key: "file-a" };
    const geometry = { actionName: "update-design", key: "geometry-a" };
    const drain = {
      saved: [fileSave, fileSave, geometry],
      rebased: [
        {
          entry: fileSave,
          error: new Error("File changed since it was read."),
        },
        { entry: fileSave, error: { errorCode: "screen_restore_claim_used" } },
        {
          entry: geometry,
          error: new Error("File changed since it was read."),
        },
      ],
      dropped: [],
      failed: [{ entry: fileSave }],
    };
    recordSaveReplayOutcomes(drain, "design-a");
    // The still-failing entry comes back on the next drain and is not counted.
    recordSaveReplayOutcomes({ ...drain, saved: [], rebased: [] }, "design-a");
    flushCanvasOutcomeCounts();
    expect(sent().every((event) => event.design_id === "design-a")).toBe(true);
    expect(totals()).toEqual({
      "save_replay/succeeded/none": 2,
      "save_replay/failed/rebased": 1,
    });
  });

  it("never counts a replay of a save still live", () => {
    const release = holdLiveSaveFromReplayCounts("file-a");
    const drain = {
      saved: [
        { actionName: "update-file", key: "file-a" },
        { actionName: "update-file", key: "file-b" },
      ],
      rebased: [],
      dropped: [],
    };
    recordSaveReplayOutcomes(drain, "design-a");
    release();
    release();
    recordSaveReplayOutcomes(drain, "design-a");
    flushCanvasOutcomeCounts();
    expect(totals()).toEqual({ "save_replay/succeeded/none": 3 });
  });

  describe("style kind", () => {
    it.each([
      [["backgroundColor"], "fill"],
      [["color"], "fill"],
      [["position", "left", "top"], "position"],
      [["width", "height"], "size"],
      [["left", "top", "width", "height"], "size"],
      [["fontSize", "lineHeight"], "typography"],
      [["paddingLeft", "gap"], "spacing"],
      [["borderTopLeftRadius"], "effects"],
      [["opacity", "boxShadow"], "effects"],
      [["fontSize", "color"], "mixed"],
      [["--an-vector-stroke-position"], "other"],
      [[], "other"],
    ])("classifies %j as %s", (properties, kind) => {
      expect(canvasStyleKind(properties)).toBe(kind);
    });

    it("sends the kind on a style commit", () => {
      runCanvasOperation("style_commit", (op) => {
        op.setStyleKind("fill");
        op.fail("patch_failed");
      });
      expect(sent()).toEqual([
        expect.objectContaining({
          operation: "style_commit",
          outcome: "failed",
          style_kind: "fill",
        }),
      ]);
    });

    it("counts each kind separately", () => {
      runCanvasOperation("style_commit", (op) => {
        op.setStyleKind("fill");
        op.succeed();
      });
      runCanvasOperation("style_commit", (op) => {
        op.setStyleKind("position");
        op.succeed();
      });
      flushCanvasOutcomeCounts();
      expect(
        sent()
          .map((event) => event.style_kind)
          .sort(),
      ).toEqual(["fill", "position"]);
    });

    it("never puts a kind on another operation, even when nested", () => {
      runCanvasOperation("text_edit", (outer) => {
        runCanvasOperation("style_commit", (inner) => {
          inner.setStyleKind("typography");
          inner.succeed();
        });
      });
      flushCanvasOutcomeCounts();
      expect(sent()).toEqual([
        expect.not.objectContaining({ style_kind: expect.anything() }),
      ]);
      expect(totals()).toEqual({ "text_edit/succeeded/none": 1 });
    });
  });

  it("buckets canvas load time", () => {
    expect(canvasLoadReadyBucket(200)).toBe("lt_1s");
    expect(canvasLoadReadyBucket(2_500)).toBe("1_to_4s");
    expect(canvasLoadReadyBucket(9_000)).toBe("gt_4s");
  });
});
