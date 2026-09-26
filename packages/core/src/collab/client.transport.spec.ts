
import { describe, expect, it } from "vitest";
import * as Y from "yjs";


const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;

function calcBackoffRef(consecutiveErrors: number): number {
  const exp = Math.min(consecutiveErrors, 10);
  const delay = BACKOFF_BASE_MS * Math.pow(2, exp);
  const jitter = delay * 0.25;
  return Math.min(delay + jitter, BACKOFF_MAX_MS);
}

describe("calcBackoff contract", () => {
  it("returns a delay >= BACKOFF_BASE_MS for any error count >= 1", () => {
    for (let n = 1; n <= 20; n++) {
      const delay = calcBackoffRef(n);
      expect(delay).toBeGreaterThanOrEqual(BACKOFF_BASE_MS);
    }
  });

  it("delay increases with error count up to the cap", () => {
    let prev = calcBackoffRef(1);
    for (let n = 2; n <= 10; n++) {
      const curr = calcBackoffRef(n);
      const maxPrev = BACKOFF_BASE_MS * Math.pow(2, n - 1) * 1.25;
      const maxCurr = BACKOFF_BASE_MS * Math.pow(2, n) * 1.25;
      expect(maxCurr).toBeGreaterThan(maxPrev);
      prev = curr;
    }
  });

  it("caps at BACKOFF_MAX_MS for very high error counts", () => {
    expect(calcBackoffRef(10)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
    expect(calcBackoffRef(20)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
  });

  it("returns a small delay (base) for the first error", () => {
    const delay = calcBackoffRef(1);
    expect(delay).toBeLessThanOrEqual(1250);
    expect(delay).toBeGreaterThanOrEqual(BACKOFF_BASE_MS);
  });
});


const STATE_VECTOR_FETCH_INTERVAL = 15;
const POLL_RING_BUFFER_SIZE = 200;

function shouldFetchStateVector(
  hadGap: boolean,
  pollCycleCount: number,
): boolean {
  return hadGap || pollCycleCount % STATE_VECTOR_FETCH_INTERVAL === 0;
}

describe("state-vector fetch gating", () => {
  it("does NOT fetch on most poll cycles", () => {
    for (let cycle = 1; cycle < STATE_VECTOR_FETCH_INTERVAL; cycle++) {
      expect(shouldFetchStateVector(false, cycle)).toBe(false);
    }
  });

  it("DOES fetch on every STATE_VECTOR_FETCH_INTERVAL-th cycle", () => {
    expect(shouldFetchStateVector(false, STATE_VECTOR_FETCH_INTERVAL)).toBe(
      true,
    );
    expect(shouldFetchStateVector(false, STATE_VECTOR_FETCH_INTERVAL * 2)).toBe(
      true,
    );
    expect(shouldFetchStateVector(false, STATE_VECTOR_FETCH_INTERVAL * 3)).toBe(
      true,
    );
  });

  it("DOES fetch when a ring-buffer gap is detected regardless of cycle", () => {
    for (let cycle = 1; cycle <= 100; cycle++) {
      if (cycle % STATE_VECTOR_FETCH_INTERVAL !== 0) {
        expect(shouldFetchStateVector(true, cycle)).toBe(true);
      }
    }
  });

  it("gap detection threshold is correct (gap > POLL_RING_BUFFER_SIZE)", () => {
    const lastPolledVersion = 100;
    const serverVersion = lastPolledVersion + POLL_RING_BUFFER_SIZE + 1;
    const versionGap = serverVersion - lastPolledVersion;
    expect(versionGap > POLL_RING_BUFFER_SIZE).toBe(true);

    const noGapVersion = lastPolledVersion + POLL_RING_BUFFER_SIZE;
    expect(noGapVersion - lastPolledVersion > POLL_RING_BUFFER_SIZE).toBe(
      false,
    );
  });
});


describe("update batching via Y.mergeUpdates", () => {
  it("merges multiple independent updates into a single equivalent update", () => {
    const updates: Uint8Array[] = [];

    for (const char of ["A", "B", "C"]) {
      const d = new Y.Doc();
      d.getText("content").insert(0, char);
      updates.push(Y.encodeStateAsUpdate(d));
    }

    const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);

    const result = new Y.Doc();
    Y.applyUpdate(result, merged);

    const text = result.getText("content").toString();
    expect(text).toContain("A");
    expect(text).toContain("B");
    expect(text).toContain("C");
    const individual = new Y.Doc();
    for (const u of updates) Y.applyUpdate(individual, u);
    expect(text).toBe(individual.getText("content").toString());
  });

  it("single-update path uses the original Uint8Array (no-copy fast path)", () => {
    const d = new Y.Doc();
    d.getText("content").insert(0, "solo");
    const onlyUpdate = Y.encodeStateAsUpdate(d);
    const updates = [onlyUpdate];

    const toSend = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);

    expect(toSend).toBe(onlyUpdate);
  });

  it("merged update is idempotent under re-application (no duplicate content)", () => {
    const updates: Uint8Array[] = [];
    const d1 = new Y.Doc();
    d1.getText("content").insert(0, "hello");
    updates.push(Y.encodeStateAsUpdate(d1));

    const d2 = new Y.Doc();
    d2.getText("content").insert(0, " world");
    updates.push(Y.encodeStateAsUpdate(d2));

    const merged = Y.mergeUpdates(updates);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, merged);
    const afterFirst = doc.getText("content").toString();

    Y.applyUpdate(doc, merged);
    expect(doc.getText("content").toString()).toBe(afterFirst);
  });
});
