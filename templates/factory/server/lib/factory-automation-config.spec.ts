import { describe, expect, it } from "vitest";

import {
  applyAutomationConfigFrontmatter,
  assertAuthorFilter,
  authorMatchesFilter,
  buildGuardrailsText,
  cronForDaily,
  cronForInterval,
  defaultAutomationConfig,
  parseAuthorIdsField,
  parseScheduleFromCron,
  replaceUserPrompt,
} from "./factory-automation-config.js";

describe("factory-automation-config", () => {
  it("rejects include mode with no author ids", () => {
    expect(() => assertAuthorFilter("slack", "include", [])).toThrow(
      /at least one author id/,
    );
  });

  it("allows exclude mode with no author ids", () => {
    expect(assertAuthorFilter("slack", "exclude", [])).toEqual([]);
  });

  it("rejects Slack display names", () => {
    expect(() => assertAuthorFilter("slack", "include", ["Steve"])).toThrow(
      /U01234567/,
    );
  });

  it("rejects GitHub logins", () => {
    expect(() =>
      assertAuthorFilter("github", "include", ["builder-io[bot]"]),
    ).toThrow(/numeric user ids/);
  });

  it("matches include and exclude author ids", () => {
    expect(authorMatchesFilter("U123", "include", ["U123"])).toBe(true);
    expect(authorMatchesFilter("U999", "include", ["U123"])).toBe(false);
    expect(authorMatchesFilter("U123", "exclude", ["U123"])).toBe(false);
    expect(authorMatchesFilter("U999", "exclude", ["U123"])).toBe(true);
    expect(authorMatchesFilter("U123", "exclude", [])).toBe(true);
  });

  it("parses author id lists", () => {
    expect(parseAuthorIdsField("U1,U2")).toEqual(["U1", "U2"]);
    expect(parseAuthorIdsField('["12","34"]')).toEqual(["12", "34"]);
  });

  it("round-trips interval and daily schedules", () => {
    expect(cronForInterval(5)).toBe("*/5 * * * *");
    expect(cronForInterval(60)).toBe("0 * * * *");
    expect(cronForDaily(9, 30)).toBe("30 9 * * *");
    expect(parseScheduleFromCron("*/15 * * * *").intervalMinutes).toBe(15);
    expect(parseScheduleFromCron("0 9 * * *").scheduleMode).toBe("daily");
  });

  it("rebuilds Slack guardrails from current fields, not stale pasted text", () => {
    const config = defaultAutomationConfig("slack", "slack-feedback");
    const guardrails = buildGuardrailsText("support-triage", config);
    expect(guardrails).toContain("dispatch-factory-item");
    expect(guardrails).toContain("reaction");
    expect(guardrails).not.toContain("limit 20");
    expect(guardrails).not.toContain("👀");

    const stale = `---
factoryId: support-triage
source: slack
template: slack-feedback
inboxLimit: 10
workLimit: 2
---

<!-- factory-guardrails:start -->
Stale skip text and last 20 lookup.
<!-- factory-guardrails:end -->

Classify Slack items.
`;
    const next = replaceUserPrompt(stale, "Classify Slack items.");
    expect(next).toContain("works on at most 2 items");
    expect(next).toContain("Never post Slack messages");
    expect(next).not.toContain("Stale skip text");
    expect(next).toContain("Classify Slack items.");
  });

  it("does not delete a stored Slack channel when the config omits one", () => {
    const content = `---
source: slack
template: slack-feedback
slackChannelId: C0BUK2293SA
slackChannelName: feedback
---

Observe Slack.
`;
    const next = applyAutomationConfigFrontmatter(
      content,
      defaultAutomationConfig("slack", "slack-feedback"),
    );
    expect(next).toContain("slackChannelId: C0BUK2293SA");
    expect(next).toContain("slackChannelName: feedback");
  });

  it("deletes a stored Slack channel when the config clears it", () => {
    const content = `---
source: slack
template: slack-feedback
slackChannelId: C0BUK2293SA
slackChannelName: feedback
---

Observe Slack.
`;
    const next = applyAutomationConfigFrontmatter(content, {
      ...defaultAutomationConfig("slack", "slack-feedback"),
      slackChannelId: "",
      slackChannelName: "",
    });
    expect(next).not.toContain("slackChannelId:");
    expect(next).not.toContain("slackChannelName:");
  });
});
