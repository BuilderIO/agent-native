import { describe, expect, it } from "vitest";

import { shouldOfferAgentKitDevCheckpointRestore } from "./history.js";

const base = {
  isDevMode: true,
  isComplete: true,
  isLastMessage: false,
  isBusy: false,
  runId: "run-1",
  checkpointRunIds: new Set(["run-1"]),
  hostname: "localhost",
};

describe("shouldOfferAgentKitDevCheckpointRestore", () => {
  it("offers a checkpoint restore only for a completed non-latest local Code turn", () => {
    expect(shouldOfferAgentKitDevCheckpointRestore(base)).toBe(true);
  });

  it("hides restore when its checkpoint or required state is missing", () => {
    for (const patch of [
      { isDevMode: false },
      { isComplete: false },
      { isLastMessage: true },
      { isBusy: true },
      { runId: undefined },
      { checkpointRunIds: new Set<string>() },
      { hostname: "app.agent-native.com" },
    ]) {
      expect(
        shouldOfferAgentKitDevCheckpointRestore({ ...base, ...patch }),
      ).toBe(false);
    }
  });
});
