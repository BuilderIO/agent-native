import { describe, expect, it } from "vitest";

import { parseSlackMrkdwn, resolveSlackMentionLabel } from "./slack-mrkdwn";

describe("parseSlackMrkdwn", () => {
  it("styles inline code, emphasis, and links", () => {
    expect(
      parseSlackMrkdwn(
        "Fix `Analytics` *now* _please_ ~old~ <https://example.com|docs> <@U123>",
      ),
    ).toEqual([
      { type: "text", value: "Fix " },
      { type: "code", value: "Analytics" },
      { type: "text", value: " " },
      { type: "bold", value: "now" },
      { type: "text", value: " " },
      { type: "italic", value: "please" },
      { type: "text", value: " " },
      { type: "strike", value: "old" },
      { type: "text", value: " " },
      { type: "link", href: "https://example.com", label: "docs" },
      { type: "text", value: " " },
      { type: "mention", id: "U123", value: "@U123" },
    ]);
  });

  it("keeps fenced blocks from being parsed as inline markers", () => {
    expect(
      parseSlackMrkdwn("before\n```\n*not bold* `code`\n```\nafter"),
    ).toEqual([
      { type: "text", value: "before\n" },
      { type: "codeblock", value: "*not bold* `code`" },
      { type: "text", value: "\nafter" },
    ]);
  });

  it("resolves standard emoji shortcodes and leaves unknown names", () => {
    expect(parseSlackMrkdwn("ship :rocket: :not_a_real_emoji:")).toEqual([
      { type: "text", value: "ship " },
      { type: "emoji", value: "🚀", shortcode: "rocket" },
      { type: "text", value: " " },
      { type: "text", value: ":not_a_real_emoji:" },
    ]);
  });

  it("uses mention labels, Builder id, then Slack pipe labels", () => {
    expect(
      parseSlackMrkdwn("<@U1> pinged <@U096KN3EL2Y> and <@U2|Ada>", {
        mentionLabels: { U1: "Enzo" },
        builderSlackUserId: "U096KN3EL2Y",
      }),
    ).toEqual([
      { type: "mention", id: "U1", value: "@Enzo" },
      { type: "text", value: " pinged " },
      { type: "mention", id: "U096KN3EL2Y", value: "@Builder.io" },
      { type: "text", value: " and " },
      { type: "mention", id: "U2", value: "@Ada" },
    ]);
  });
});

describe("resolveSlackMentionLabel", () => {
  it("keeps the raw id when nothing else is known", () => {
    expect(resolveSlackMentionLabel("U99", undefined)).toBe("@U99");
  });
});
