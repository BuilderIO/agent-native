import { describe, expect, it } from "vitest";

import { HEADLINE_MAX_CHARS, slackHeadline } from "./slack-headline.js";

describe("the headline of a Slack message", () => {
  it("is the first line that says something", () => {
    expect(slackHeadline("Pay button does nothing\nIt worked on Monday.")).toBe(
      "Pay button does nothing",
    );
    expect(slackHeadline("\n\n  \nCSV export is empty\nsecond")).toBe(
      "CSV export is empty",
    );
    expect(slackHeadline("line one\r\nline two")).toBe("line one");
  });

  it("drops mentions, broadcasts, links and emoji, and keeps a link's label", () => {
    expect(
      slackHeadline(
        "<@U123ABC> <!here> see <https://example.test/a|the dashboard> :bug: now",
      ),
    ).toBe("see the dashboard now");
    expect(slackHeadline("<https://example.test/only-a-link>")).toBeUndefined();
    expect(slackHeadline("broken again https://example.test/x?y=1 sorry")).toBe(
      "broken again sorry",
    );
    expect(slackHeadline("in <#C0123|checkout> the total is wrong")).toBe(
      "in #checkout the total is wrong",
    );
  });

  it("drops formatting but keeps names that contain underscores", () => {
    expect(slackHeadline("*Bug:* `delete_candidate` is stale")).toBe(
      "Bug: delete_candidate is stale",
    );
    expect(slackHeadline("> - 1. _urgent_ ~maybe~ fix")).toBe(
      "urgent maybe fix",
    );
    expect(slackHeadline("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
  });

  it("skips a line that is only a code fence", () => {
    expect(slackHeadline("```\nstack trace here\n```")).toBe(
      "stack trace here",
    );
  });

  it("cuts a long line at a word, with a mark, within the limit", () => {
    const long =
      "the comment delete dialog works out thread versus single comment from the live thread list so the copy flips";
    const headline = slackHeadline(long) ?? "";
    expect(headline).not.toBe("");
    expect(headline.length).toBeLessThanOrEqual(HEADLINE_MAX_CHARS);
    expect(headline.endsWith("…")).toBe(true);
    expect(long.startsWith(headline.slice(0, -1))).toBe(true);
    expect(headline.slice(0, -1).endsWith(" ")).toBe(false);
  });

  it("cuts a line with no spaces at the limit, never inside a character", () => {
    expect(slackHeadline("x".repeat(250))).toBe(`${"x".repeat(99)}…`);
    const astral = slackHeadline("😀".repeat(80)) ?? "";
    expect(astral).not.toBe("");
    expect(astral.endsWith("…")).toBe(true);
    expect(astral.slice(0, -1)).toMatch(/^(?:😀)+$/u);
  });

  it("keeps a line that fits whole", () => {
    expect(slackHeadline("x".repeat(HEADLINE_MAX_CHARS))).toBe(
      "x".repeat(HEADLINE_MAX_CHARS),
    );
  });

  it("is undefined when no words are left, so the caller keeps the author label", () => {
    expect(slackHeadline("")).toBeUndefined();
    expect(slackHeadline("   \n\t\n")).toBeUndefined();
    expect(slackHeadline("<@U123> :wave:")).toBeUndefined();
  });
});
