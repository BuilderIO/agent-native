import { describe, expect, it } from "vitest";

import { parseSlackMrkdwn } from "./slack-mrkdwn";

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
      { type: "mention", value: "@U123" },
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
});
