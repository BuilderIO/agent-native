import { describe, expect, it } from "vitest";

import { resolveInboxSourceUrl, slackThreadUrl } from "./inbox-source-url";

describe("resolveInboxSourceUrl", () => {
  it("prefers a stored http URL", () => {
    expect(
      resolveInboxSourceUrl({
        sourceUrl: "https://builder.slack.com/archives/C123/p456",
        channelId: "C999",
        threadTs: "1.2",
      }),
    ).toBe("https://builder.slack.com/archives/C123/p456");
  });

  it("rebuilds a Slack archives URL when sourceUrl is missing", () => {
    expect(
      resolveInboxSourceUrl({
        sourceUrl: null,
        channelId: "C456",
        threadTs: "1700000000.000200",
      }),
    ).toBe(slackThreadUrl("C456", "1700000000.000200"));
  });

  it("ignores non-http stored URLs and falls back to the thread", () => {
    expect(
      resolveInboxSourceUrl({
        sourceUrl: "javascript:alert(1)",
        channelId: "C456",
        threadTs: "1.2",
      }),
    ).toBe(slackThreadUrl("C456", "1.2"));
  });

  it("returns null without a stored URL or thread identity", () => {
    expect(
      resolveInboxSourceUrl({
        sourceUrl: null,
        channelId: "C456",
        threadTs: null,
      }),
    ).toBeNull();
  });
});
