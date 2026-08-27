import { describe, expect, it } from "vitest";

import {
  collectMentionIds,
  collectSlackUserIds,
  parseUserLabelsJson,
  serializeUserLabels,
} from "./slack-user-labels";

describe("collectSlackUserIds", () => {
  it("collects authors and in-text mentions without duplicating ids", () => {
    expect(
      collectSlackUserIds([
        {
          user: "U1",
          text: "hey <@U2> and <@U1>",
        },
        {
          bot_id: "B1",
          text: "bot mentioned <@U2>",
        },
      ]),
    ).toEqual(["U1", "U2"]);
  });
});

describe("collectMentionIds", () => {
  it("reads Slack mention markup including pipe labels", () => {
    expect(collectMentionIds("cc <@U096KN3EL2Y|Builder> and <@W12>")).toEqual([
      "U096KN3EL2Y",
      "W12",
    ]);
  });
});

describe("user label serialization", () => {
  it("round-trips a label map", () => {
    const encoded = serializeUserLabels(
      new Map([
        ["U1", "Enzo"],
        ["U2", "@jane"],
      ]),
    );
    expect(parseUserLabelsJson(encoded)).toEqual({
      U1: "Enzo",
      U2: "@jane",
    });
  });

  it("treats missing labels as empty, not unreadably failed", () => {
    expect(parseUserLabelsJson(undefined)).toEqual({});
    expect(parseUserLabelsJson("")).toEqual({});
  });

  it("rejects truncated label payloads", () => {
    expect(() => parseUserLabelsJson("{")).toThrow(
      "Slack user labels are unreadable.",
    );
  });
});
