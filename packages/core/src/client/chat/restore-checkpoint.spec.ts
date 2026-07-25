import { describe, it, expect } from "vitest";

import {
  assistantMessageRunId,
  shouldOfferRestore,
} from "./message-components.js";

const base = {
  devMode: true,
  isComplete: true,
  isLast: false,
  runId: "run-1",
  checkpointRunIds: new Set(["run-1"]),
};

describe("assistantMessageRunId", () => {
  it("reads the live-yield and server-persisted shapes", () => {
    expect(
      assistantMessageRunId({ metadata: { custom: { runId: "a" } } }),
    ).toBe("a");
    expect(assistantMessageRunId({ metadata: { runId: "b" } })).toBe("b");
    expect(assistantMessageRunId({ metadata: {} })).toBeUndefined();
    expect(assistantMessageRunId(undefined)).toBeUndefined();
  });
});

describe("shouldOfferRestore", () => {
  it("offers restore when a checkpoint exists for the turn", () => {
    expect(shouldOfferRestore(base)).toBe(true);
  });

  it("hides restore when no checkpoint was saved for the turn", () => {
    // Auto-checkpointing skips turns that start from a dirty tree or a non-git
    // cwd. Offering restore anyway produced a menu item that did nothing.
    expect(
      shouldOfferRestore({ ...base, checkpointRunIds: new Set<string>() }),
    ).toBe(false);
    expect(shouldOfferRestore({ ...base, checkpointRunIds: undefined })).toBe(
      false,
    );
    expect(
      shouldOfferRestore({ ...base, checkpointRunIds: new Set(["other"]) }),
    ).toBe(false);
  });

  it("hides restore without a run id to address the checkpoint by", () => {
    expect(shouldOfferRestore({ ...base, runId: undefined })).toBe(false);
  });

  it("hides restore outside Code mode, mid-turn, and on the last message", () => {
    expect(shouldOfferRestore({ ...base, devMode: false })).toBe(false);
    expect(shouldOfferRestore({ ...base, devMode: undefined })).toBe(false);
    expect(shouldOfferRestore({ ...base, isComplete: false })).toBe(false);
    expect(shouldOfferRestore({ ...base, isLast: true })).toBe(false);
  });
});
