import { describe, expect, it } from "vitest";

import {
  reconcileRecordingRecovery,
  shouldShowRecordingRecoveryBanner,
  type PendingDesktopUpload,
  type PendingNativeUpload,
} from "./recording-recovery";
import {
  applyRecordingRecoveryResult,
  isRecordingStartCancellation,
} from "./recording-recovery-failure";

const native: PendingNativeUpload = {
  kind: "native",
  recordingId: "example-native",
  serverUrl: "https://clips.example.test",
  durationMs: 1_000,
  bytes: 1_024,
  hasAudio: true,
  hasCamera: false,
  savedAt: "2026-09-18T12:00:00Z",
  retryCount: 0,
};
const browser: Extract<PendingDesktopUpload, { kind: "browser" }> = {
  ...native,
  kind: "browser",
  recordingId: "example-browser",
  savedAt: "2026-09-18T12:01:00Z",
  chunkCount: 1,
  mimeType: "video/webm",
};

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({
  status: "fulfilled",
  value,
});
const rejected = (reason: unknown): PromiseRejectedResult => ({
  status: "rejected",
  reason,
});

const prior: PendingNativeUpload = {
  kind: "native",
  recordingId: "clip",
  serverUrl: "https://example.test",
  bytes: 1,
  savedAt: "2026-09-18",
  durationMs: 1,
  hasAudio: true,
  hasCamera: false,
  retryCount: 0,
};

describe("recording recovery state", () => {
  it("only shows the recovery banner on the signed-in recorder surface", () => {
    expect(shouldShowRecordingRecoveryBanner("recorder", true)).toBe(true);
    expect(shouldShowRecordingRecoveryBanner("recorder", false)).toBe(false);
    expect(shouldShowRecordingRecoveryBanner("settings", true)).toBe(false);
    expect(shouldShowRecordingRecoveryBanner("recovery", true)).toBe(false);
  });

  it("retains last known entries on rejected lookup and distinguishes failure from empty", () => {
    const cause = new Error("Disk unavailable");
    const result = reconcileRecordingRecovery(
      [prior],
      { status: "rejected", reason: cause },
      { status: "fulfilled", value: [] },
    );
    expect(result.uploads).toEqual([prior]);
    expect(result.errors).toEqual([{ kind: "native", cause }]);
    expect(
      reconcileRecordingRecovery(
        [prior],
        { status: "fulfilled", value: [] },
        { status: "fulfilled", value: [] },
      ),
    ).toEqual({ uploads: [], errors: [] });
  });

  it("retains previous entries for malformed lookup results", () => {
    const result = reconcileRecordingRecovery(
      [prior],
      { status: "fulfilled", value: null as unknown as [] },
      { status: "fulfilled", value: [] },
    );
    expect(result.uploads).toEqual([prior]);
    expect(result.errors[0].kind).toBe("native");
  });

  it("persists async failure without pending metadata and clears only that clip on success", () => {
    const failed = applyRecordingRecoveryResult(
      { unrelated: "other failure" },
      { recordingId: "clip", ok: false, error: "Upload failed" },
      "session",
      "Failed",
    );
    expect(failed).toEqual({
      unrelated: "other failure",
      "failure:clip": "Upload failed",
    });
    expect(
      applyRecordingRecoveryResult(
        failed,
        { recordingId: "clip", ok: true },
        "session",
        "Failed",
      ),
    ).toEqual({ unrelated: "other failure" });
  });

  it("uses a stable session key when stop never returned a recording id", () => {
    expect(
      applyRecordingRecoveryResult(
        {},
        { ok: false, error: "Disk full" },
        "attempt",
        "Failed",
      ),
    ).toEqual({ "failure:attempt": "Disk full" });
  });

  it.each([
    new DOMException("Cancelled", "AbortError"),
    new Error("Window selection was cancelled"),
    new DOMException("Picker dismissed", "NotAllowedError"),
  ])("excludes user cancellation from start failures: %s", (error) => {
    expect(isRecordingStartCancellation(error)).toBe(true);
  });

  it("does not suppress a real startup error", () => {
    expect(isRecordingStartCancellation(new Error("Encoder failed"))).toBe(
      false,
    );
  });
});

describe("reconcileRecordingRecovery", () => {
  it("retains native recovery on a failed lookup while replacing browser results", () => {
    const cause = new Error("Example native lookup failure");
    const replacement = { ...browser, recordingId: "example-browser-new" };
    const previous = [native, browser];

    const result = reconcileRecordingRecovery(
      previous,
      rejected(cause),
      fulfilled([replacement]),
    );

    expect(result.uploads).toEqual([replacement, native]);
    expect(result.errors).toEqual([{ kind: "native", cause }]);
    expect(previous).toEqual([native, browser]);
  });

  it("retains browser recovery on a failed lookup while replacing native results", () => {
    const cause = new Error("Example browser lookup failure");
    const replacement = {
      ...native,
      recordingId: "example-native-new",
      savedAt: "2026-09-18T12:02:00Z",
    };

    const result = reconcileRecordingRecovery(
      [native, browser],
      fulfilled([replacement]),
      rejected(cause),
    );

    expect(result.uploads).toEqual([replacement, browser]);
    expect(result.errors).toEqual([{ kind: "browser", cause }]);
  });

  it("distinguishes an empty successful lookup from an unreadable lookup", () => {
    const cause = new Error("Example native lookup failure");
    const result = reconcileRecordingRecovery(
      [native, browser],
      rejected(cause),
      fulfilled([]),
    );
    expect(result.uploads).toEqual([native]);
    expect(result.errors).toEqual([{ kind: "native", cause }]);
    expect(
      reconcileRecordingRecovery(result.uploads, fulfilled([]), fulfilled([])),
    ).toEqual({ uploads: [], errors: [] });
  });

  it("preserves both kinds and reports both failures when neither lookup succeeds", () => {
    const nativeCause = new Error("Example native failure");
    const browserCause = new Error("Example browser failure");
    expect(
      reconcileRecordingRecovery(
        [native, browser],
        rejected(nativeCause),
        rejected(browserCause),
      ),
    ).toEqual({
      uploads: [browser, native],
      errors: [
        { kind: "native", cause: nativeCause },
        { kind: "browser", cause: browserCause },
      ],
    });
  });

  it.each([null, undefined, {}, "invalid-response"])(
    "reports a typed native lookup error for invalid top-level data: %j",
    (value) => {
      const invalid = fulfilled(value) as unknown as Parameters<
        typeof reconcileRecordingRecovery
      >[1];
      const result = reconcileRecordingRecovery(
        [native, browser],
        invalid,
        fulfilled([]),
      );
      expect(result.uploads).toEqual([native]);
      expect(result.errors).toEqual([
        { kind: "native", cause: expect.any(Error) },
      ]);
    },
  );

  it("reports a typed browser lookup error for invalid top-level data", () => {
    const invalid = fulfilled({}) as unknown as Parameters<
      typeof reconcileRecordingRecovery
    >[2];
    const result = reconcileRecordingRecovery(
      [native, browser],
      fulfilled([]),
      invalid,
    );
    expect(result.uploads).toEqual([browser]);
    expect(result.errors).toEqual([
      { kind: "browser", cause: expect.any(Error) },
    ]);
  });

  it("does not replace previous recovery with malformed backend rows", () => {
    const invalid = fulfilled([{}]) as unknown as Parameters<
      typeof reconcileRecordingRecovery
    >[1];
    const result = reconcileRecordingRecovery([native], invalid, fulfilled([]));
    expect(result.errors).toEqual([
      { kind: "native", cause: expect.any(Error) },
    ]);
    expect(result.uploads).toEqual([native]);
  });
});

describe("applyRecordingRecoveryResult", () => {
  it("clears prior action errors for the completed clip so an empty pending list has no orphan", () => {
    const errors = {
      "native:clip": "Opening recovery folder failed",
      "browser:clip": "Export failed",
      "failure:clip": "Upload failed",
      "native:other": "Unrelated error",
    };
    const resolved = applyRecordingRecoveryResult(
      errors,
      { recordingId: "clip", ok: true },
      "session",
      "Failed",
    );
    expect(resolved).toEqual({ "native:other": "Unrelated error" });
    expect(errors["native:clip"]).toBe("Opening recovery folder failed");
  });

  it("clears the failed clip after a successful later retry without clearing other errors", () => {
    const previous = {
      "failure:other-clip": "Other failure",
      "browser:other-clip": "Other action failure",
    };
    const failed = applyRecordingRecoveryResult(
      previous,
      {
        recordingId: "example-clip",
        ok: false,
        error: "Example upload failure",
      },
      "example-session",
      "Example fallback",
    );
    expect(failed).toEqual({
      ...previous,
      "failure:example-clip": "Example upload failure",
    });
    const retried = applyRecordingRecoveryResult(
      failed,
      { recordingId: "example-clip", ok: true },
      "example-session",
      "Example fallback",
    );
    expect(retried).toEqual(previous);
    expect(failed["failure:example-clip"]).toBe("Example upload failure");
  });

  it("uses the session key and fallback message when no clip or error is available", () => {
    const failed = applyRecordingRecoveryResult(
      {},
      { ok: false },
      "example-session",
      "Example fallback",
    );
    expect(failed).toEqual({ "failure:example-session": "Example fallback" });
    expect(
      applyRecordingRecoveryResult(
        failed,
        { ok: true },
        "example-session",
        "Example fallback",
      ),
    ).toEqual({});
  });
});

describe("isRecordingStartCancellation", () => {
  it("recognizes explicit AbortError", () => {
    expect(
      isRecordingStartCancellation(
        new DOMException("Selection ended", "AbortError"),
      ),
    ).toBe(true);
  });

  it.each([
    "Window selection was cancelled",
    "Window selection was canceled",
    "Region selection cancelled",
    "Picker dismissed",
  ])("recognizes selection cancellation: %s", (message) => {
    expect(isRecordingStartCancellation(new Error(message))).toBe(true);
  });

  it("treats an ordinary NotAllowedError from the picker as cancellation", () => {
    expect(
      isRecordingStartCancellation(
        new DOMException("User denied selection", "NotAllowedError"),
      ),
    ).toBe(true);
  });

  it.each([
    "Permission denied by system",
    "Capture blocked by system",
    "Enable Screen Recording in System Settings",
  ])("does not suppress a hard permission error: %s", (message) => {
    expect(
      isRecordingStartCancellation(
        new DOMException(message, "NotAllowedError"),
      ),
    ).toBe(false);
  });

  it("does not suppress an unrelated recording failure", () => {
    expect(
      isRecordingStartCancellation(
        new Error("Example capture initialization failed"),
      ),
    ).toBe(false);
  });
});
