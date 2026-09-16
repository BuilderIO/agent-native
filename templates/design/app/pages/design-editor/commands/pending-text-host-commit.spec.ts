import { describe, expect, it, vi } from "vitest";

import { runPendingTextHostCommit } from "./pending-text-host-commit";

describe("the host-side fallback writer trusts the commit path's answer", () => {
  it("treats an accepted write as written, without re-reading any source", () => {
    // A live-snapshot write lands in liveScreenSnapshotsById, which
    // getScreenContent does not read. The old writer re-read the source and
    // therefore classified this accepted write as lost, retried it, and
    // reported the user's text unrecoverable. There is no readback here to
    // get that wrong — acceptance is the commit path's to report.
    const commitText = vi.fn(() => "accepted" as const);

    expect(
      runPendingTextHostCommit(commitText, "screen-1", "text-1", "Standalone"),
    ).toBe(true);
    expect(commitText).toHaveBeenCalledExactlyOnceWith(
      "screen-1",
      '[data-agent-native-node-id="text-1"]',
      "Standalone",
    );
  });

  it("treats a refused write as not written, so the text stays owed", () => {
    const commitText = vi.fn(() => "refused" as const);

    expect(
      runPendingTextHostCommit(commitText, "screen-1", "text-1", "Standalone"),
    ).toBe(false);
  });
});
