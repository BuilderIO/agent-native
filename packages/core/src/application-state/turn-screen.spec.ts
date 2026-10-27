import { describe, expect, it } from "vitest";

import {
  AGENT_SCREEN_METADATA_KEY,
  buildTurnScreenSnapshot,
  MAX_SCREEN_STATE_VALUE_CHARS,
  readSubmittedTurnScreen,
} from "./turn-screen.js";

const snapshot = (values: Record<string, unknown>) => ({
  v: 1,
  browserTabId: "tab-a",
  capturedAt: 1,
  values,
});

describe("readSubmittedTurnScreen", () => {
  it("accepts a snapshot from the request's tab", () => {
    const submitted = snapshot({ navigation: { view: "inbox" } });

    expect(
      readSubmittedTurnScreen(
        { [AGENT_SCREEN_METADATA_KEY]: submitted },
        "tab-a",
      ),
    ).toEqual({ status: "ok", snapshot: submitted });
  });

  it("tells a missing snapshot apart from one it cannot use", () => {
    expect(readSubmittedTurnScreen({}, "tab-a")).toEqual({ status: "absent" });
    expect(
      readSubmittedTurnScreen(
        { [AGENT_SCREEN_METADATA_KEY]: snapshot({}) },
        "tab-b",
      ),
    ).toEqual({ status: "other-tab" });
    expect(
      readSubmittedTurnScreen(
        { [AGENT_SCREEN_METADATA_KEY]: snapshot({ navigate: { view: "x" } }) },
        "tab-a",
      ).status,
    ).toBe("invalid");
    expect(
      readSubmittedTurnScreen(
        {
          [AGENT_SCREEN_METADATA_KEY]: snapshot({
            navigation: { text: "x".repeat(MAX_SCREEN_STATE_VALUE_CHARS) },
          }),
        },
        "tab-a",
      ).status,
    ).toBe("invalid");
  });
});

describe("buildTurnScreenSnapshot", () => {
  it("moves oversized values to omitted so they are read live", () => {
    const built = buildTurnScreenSnapshot(
      "tab-a",
      {
        navigation: { view: "inbox" },
        selection: { text: "x".repeat(MAX_SCREEN_STATE_VALUE_CHARS) },
      },
      5,
    );

    expect(built).toEqual({
      v: 1,
      browserTabId: "tab-a",
      capturedAt: 5,
      values: { navigation: { view: "inbox" } },
      omitted: ["selection"],
    });
    expect(
      readSubmittedTurnScreen({ [AGENT_SCREEN_METADATA_KEY]: built }, "tab-a")
        .status,
    ).toBe("ok");
  });
});
