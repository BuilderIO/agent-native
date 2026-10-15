import { describe, expect, it } from "vitest";

import {
  takePendingLookbackContext,
  takePendingLookbackContextAfterStop,
  type PendingLookbackContext,
} from "./pending-lookback-context";

function pending(recordingId: string): PendingLookbackContext {
  return {
    recordingId,
    target: { serverUrl: "https://clips.example.test", authToken: "" },
    item: Promise.resolve(null),
  };
}

describe("takePendingLookbackContext", () => {
  it("removes only the failed recording's cleanup handle", () => {
    const failed = pending("recording-a");
    const newer = pending("recording-b");
    const contexts = new Map([
      [failed.recordingId, failed],
      [newer.recordingId, newer],
    ]);

    expect(takePendingLookbackContext(contexts, failed.recordingId)).toBe(
      failed,
    );
    expect(contexts.get(newer.recordingId)).toBe(newer);
    expect(takePendingLookbackContext(contexts, failed.recordingId)).toBeNull();
  });
});

describe("takePendingLookbackContextAfterStop", () => {
  it("releases only the retained recording's handle after its stop settles", () => {
    const retained = pending("recording-a");
    const newer = pending("recording-b");
    const contexts = new Map([
      [retained.recordingId, retained],
      [newer.recordingId, newer],
    ]);

    expect(
      takePendingLookbackContextAfterStop(
        contexts,
        retained.recordingId,
        newer.recordingId,
      ),
    ).toBeNull();
    expect(contexts.get(retained.recordingId)).toBe(retained);
    expect(
      takePendingLookbackContextAfterStop(
        contexts,
        retained.recordingId,
        retained.recordingId,
      ),
    ).toBe(retained);
    expect(contexts.get(newer.recordingId)).toBe(newer);
  });
});
