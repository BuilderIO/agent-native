import { describe, expect, it, vi } from "vitest";

import { runPendingTextHostCommit } from "./pending-text-host-commit";

describe("the host-side fallback writer trusts the commit path's answer", () => {
  it("treats an accepted write as written, without re-reading any source", () => {
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
