import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetRunStreamOwnership,
  claimRunStream,
  createRunStreamToken,
  ownsRunStream,
  preemptRunStream,
  releaseRunStream,
} from "./run-stream-ownership.js";

const THREAD = "thread-1";
const RUN = "run-1";

describe("run stream ownership", () => {
  beforeEach(() => {
    __resetRunStreamOwnership();
  });

  it("lets only one reader hold a run", () => {
    const reconnect = createRunStreamToken("reconnect");
    const other = createRunStreamToken("other");

    expect(claimRunStream(THREAD, RUN, reconnect)).toBe(true);
    // The second reader is the one that used to render a duplicate turn.
    expect(claimRunStream(THREAD, RUN, other)).toBe(false);
    expect(ownsRunStream(THREAD, RUN, reconnect)).toBe(true);
    expect(ownsRunStream(THREAD, RUN, other)).toBe(false);
  });

  it("treats re-claiming with the same token as success so retry loops are safe", () => {
    const token = createRunStreamToken();
    expect(claimRunStream(THREAD, RUN, token)).toBe(true);
    expect(claimRunStream(THREAD, RUN, token)).toBe(true);
  });

  it("scopes ownership per run, so concurrent runs do not block each other", () => {
    const a = createRunStreamToken("a");
    const b = createRunStreamToken("b");

    expect(claimRunStream(THREAD, "run-a", a)).toBe(true);
    expect(claimRunStream(THREAD, "run-b", b)).toBe(true);
    expect(claimRunStream("thread-2", RUN, b)).toBe(true);
  });

  it("lets the adapter preempt the reconnect fallback and revokes it synchronously", () => {
    const reconnect = createRunStreamToken("reconnect");
    const adapter = createRunStreamToken("adapter");
    claimRunStream(THREAD, RUN, reconnect);

    expect(preemptRunStream(THREAD, RUN, adapter)).toBe(true);
    // The displaced reader must observe the loss without waiting for a poll —
    // this is what stops it writing a second copy of the turn into the UI.
    expect(ownsRunStream(THREAD, RUN, reconnect)).toBe(false);
    expect(ownsRunStream(THREAD, RUN, adapter)).toBe(true);
  });

  it("reports no handover when the preempting reader already owned the run", () => {
    const adapter = createRunStreamToken("adapter");
    claimRunStream(THREAD, RUN, adapter);
    expect(preemptRunStream(THREAD, RUN, adapter)).toBe(false);
  });

  it("ignores a release from a reader that no longer owns the run", () => {
    const reconnect = createRunStreamToken("reconnect");
    const adapter = createRunStreamToken("adapter");
    claimRunStream(THREAD, RUN, reconnect);
    preemptRunStream(THREAD, RUN, adapter);

    // A late unmount of the displaced reader must not free the successor's
    // claim, or a third reader could attach beside the adapter.
    releaseRunStream(THREAD, RUN, reconnect);
    expect(ownsRunStream(THREAD, RUN, adapter)).toBe(true);
    expect(claimRunStream(THREAD, RUN, reconnect)).toBe(false);
  });

  it("frees the run for the next reader once the owner releases", () => {
    const first = createRunStreamToken("first");
    const second = createRunStreamToken("second");
    claimRunStream(THREAD, RUN, first);
    releaseRunStream(THREAD, RUN, first);

    expect(claimRunStream(THREAD, RUN, second)).toBe(true);
  });
});
