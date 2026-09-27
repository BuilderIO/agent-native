import { describe, expect, it } from "vitest";

import { managedReviewSkillAlignmentMarkers } from "../triage/review-skill-alignment.js";
import {
  applyAutomationConfigFrontmatter,
  assertAuthorFilter,
  authorMatchesFilter,
  buildGuardrailsText,
  composeFactoryAutomationBody,
  countSkillAlignmentBlocks,
  cronForDaily,
  cronForInterval,
  defaultAutomationConfig,
  inferAutomationSource,
  needsAutomationBodyRepair,
  normalizeUserPrompt,
  parseAuthorIdsField,
  parseScheduleFromCron,
  previewAutomationInstructions,
  readFactoryAutomationConfig,
  replaceAutomationContentWithUserPrompt,
  replaceUserPrompt,
  restoreFactoryAutomationIdentityFields,
  splitAutomationFrontmatter,
  templateIdForSeedName,
} from "./factory-automation-config.js";

describe("factory-automation-config", () => {
  it("infers GitHub for PR babysit copies even when YAML source is missing or Slack", () => {
    const withoutSource = `---
template: pr-babysit
repository: acme/widgets
---
Babysit pull requests.
`;
    expect(inferAutomationSource("factory-pr-babysit-2", withoutSource)).toBe(
      "github",
    );
    expect(
      readFactoryAutomationConfig(
        withoutSource,
        "factories/factorytester/factory-pr-babysit-2",
      ).source,
    ).toBe("github");
    expect(
      inferAutomationSource(
        "factory-pr-babysit-2",
        `---
source: slack
template: pr-babysit
---
Babysit pull requests.
`,
      ),
    ).toBe("github");
    expect(templateIdForSeedName("factory-pr-babysit-2")).toBe("pr-babysit");
  });

  it("infers custom jobs from factory-<source>- leaf prefixes", () => {
    expect(inferAutomationSource("factory-github-my-repo")).toBe("github");
    expect(inferAutomationSource("factory-slack-my-alerts")).toBe("slack");
    expect(inferAutomationSource("factory-sentry-prod")).toBe("sentry");
  });

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
    expect(guardrails).toContain("omit it on skips");
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

  it("restores editor-owned identity fields dropped during metadata repair", () => {
    const original = `---
source: slack
template: slack-feedback
displayName: Product feedback
slackChannelId: C0ATH3CCZT4
slackChannelName: product-feedback
authorMode: exclude
authorIds: U096KN3EL2Y
---

Observe Slack.
`;
    const repaired = `---
source: slack
template: slack-feedback
authorMode: exclude
---

Observe Slack.
`;
    const next = restoreFactoryAutomationIdentityFields(
      original,
      repaired,
      "factory-slack-feedback",
    );
    expect(next).toContain("displayName: Product feedback");
    expect(next).toContain("slackChannelId: C0ATH3CCZT4");
    expect(next).toContain("authorIds: U096KN3EL2Y");
  });

  it("strips duplicate injected blocks from pasted prompt text", () => {
    const { start, end } = managedReviewSkillAlignmentMarkers();
    const pasted = `${start}
first alignment
${end}

${start}
second alignment
${end}

User instructions stay.
`;
    const normalized = normalizeUserPrompt(pasted);
    expect(normalized).toBe("User instructions stay.");
    expect(countSkillAlignmentBlocks(pasted)).toBe(2);
  });

  it("composes body without changing frontmatter identity fields", () => {
    const content = `---
source: slack
template: slack-feedback
displayName: Product feedback
slackChannelId: C0ATH3CCZT4
factoryId: product-an-feedback
inboxLimit: 10
workLimit: 2
---

Stale body.
`;
    const config = readFactoryAutomationConfig(
      content,
      "factory-slack-feedback",
    );
    const { frontmatter: originalFrontmatter } =
      splitAutomationFrontmatter(content);
    const next = replaceAutomationContentWithUserPrompt(
      content,
      "Only triage paying customers.",
      "factory-slack-feedback",
    );
    const { frontmatter: nextFrontmatter, body } =
      splitAutomationFrontmatter(next);
    expect(nextFrontmatter).toBe(originalFrontmatter);
    expect(body).toContain("Only triage paying customers.");
    expect(body).toContain("dispatch-factory-item");
    expect(countSkillAlignmentBlocks(next)).toBeLessThanOrEqual(1);
    expect(
      composeFactoryAutomationBody({
        userPrompt: "Only triage paying customers.",
        automationName: "factory-slack-feedback",
        factoryId: "product-an-feedback",
        config,
      }),
    ).toContain("Only triage paying customers.");
  });

  it("matches preview guardrails and alignment to composed body sections", () => {
    const config = defaultAutomationConfig("slack", "slack-feedback");
    const preview = previewAutomationInstructions({
      factoryId: "product-an-feedback",
      config,
      automationName: "factory-slack-feedback",
    });
    const body = composeFactoryAutomationBody({
      userPrompt: "Classify Slack feedback.",
      automationName: "factory-slack-feedback",
      factoryId: "product-an-feedback",
      config,
    });
    expect(body).toContain(preview.guardrails);
    if (preview.skillAlignment) {
      expect(body).toContain(preview.skillAlignment);
    }
  });

  it("recomposing refreshes guardrails/alignment but intentionally preserves an old (revision-1) user prompt verbatim", () => {
    const config = defaultAutomationConfig("slack", "slack-feedback");
    const retiredUserPrompt = `# Factory Slack feedback triage

For each item, call dispatch-factory-item with clearBug true or false,
productUxImplications false unless it is a pure product or design decision
with no single correct fix, a short reason, and reaction robot_face 🤖.`;
    const body = composeFactoryAutomationBody({
      userPrompt: retiredUserPrompt,
      automationName: "factory-slack-feedback",
      factoryId: "product-an-feedback",
      config,
    });
    expect(body).toContain(
      "Builder is only tagged when clearBug is true, risk is low, and confidence is high",
    );
    expect(body).toContain(retiredUserPrompt);
  });

  it("does not require body repair for prompt-only automations missing alignmentRevision", () => {
    const content = `---
template: slack-feedback
source: slack
---
Only triage paying customers.
`;
    expect(needsAutomationBodyRepair(content)).toBe(false);
  });

  it("requires body repair when duplicate alignment blocks are present", () => {
    const { start, end } = managedReviewSkillAlignmentMarkers();
    const content = `---
template: slack-feedback
source: slack
alignmentRevision: 1
---
${start}
one
${end}

${start}
two
${end}

User text.
`;
    expect(needsAutomationBodyRepair(content)).toBe(true);
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
