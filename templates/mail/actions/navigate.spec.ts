import { describe, expect, it, vi } from "vitest";

const writeAppStateForCurrentTab = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab,
}));

import action from "./navigate";

describe("Mail navigate", () => {
  it("writes the command through the requesting tab's ambient state", async () => {
    await action.run({ view: "sent", threadId: "thread-1" });

    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "sent",
      threadId: "thread-1",
    });
  });
});
