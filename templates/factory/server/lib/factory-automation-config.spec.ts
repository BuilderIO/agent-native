import { describe, expect, it } from "vitest";

import { managedReviewSkillAlignmentMarkers } from "../triage/review-skill-alignment.js";
import {
  applyAutomationConfigFrontmatter,
  assertAuthorFilter,
  authorMatchesFilter,
  buildGuardrailsText,
  buildSkillAlignmentBlock,
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
  restoreFactoryAutomationIdentityFields,
  splitAutomationFrontmatter,
  stampAutomationTriggerType,
  templateIdForSeedName,
} from "./factory-automation-config.js";

describe("factory-automation-config", () => {
  it("infers GitHub for PR governance copies even when YAML source is missing or Slack", () => {
    const withoutSource = `---
template: pr-governance
repository: acme/widgets
---
Review pull requests.
`;
    expect(
      inferAutomationSource("factory-pr-governance-2", withoutSource),
    ).toBe("github");
    expect(
      readFactoryAutomationConfig(
        withoutSource,
        "factories/factorytester/factory-pr-governance-2",
      ).source,
    ).toBe("github");
    expect(
      inferAutomationSource(
        "factory-pr-governance-2",
        `---
source: slack
template: pr-governance
---
Review pull requests.
`,
      ),
    ).toBe("github");
    expect(templateIdForSeedName("factory-pr-governance-2")).toBe(
      "pr-governance",
    );
  });

  it("still reads a job saved from a template that no longer exists, by its stored fields", () => {
    for (const [leaf, template, extra] of [
      ["factory-slack-feedback", "slack-feedback", ""],
      ["factory-sentry-errors", "sentry-errors", ""],
      ["factory-github-issues", "github-issues", ""],
      ["factory-pr-babysit", "pr-babysit", "repository: acme/widgets\n"],
    ] as const) {
      const config = readFactoryAutomationConfig(
        `---\ntemplate: ${template}\n${extra}---\nBody.\n`,
        `factories/f1/${leaf}`,
      );
      expect(config.template).toBe("blank");
      expect(config.source).toBe(
        leaf.includes("slack")
          ? "slack"
          : leaf.includes("sentry")
            ? "sentry"
            : "github",
      );
    }
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
    const config = defaultAutomationConfig("slack");
    const guardrails = buildGuardrailsText("support-triage", config);
    expect(guardrails).toContain("poll-slack-channel");
    expect(guardrails).toContain("Never post Slack messages");
    expect(guardrails).not.toContain("limit 20");
    expect(guardrails).not.toContain("👀");

    const stale = `---
factoryId: support-triage
source: slack
template: blank
inboxLimit: 10
workLimit: 2
---

<!-- factory-guardrails:start -->
Stale skip text and last 20 lookup.
<!-- factory-guardrails:end -->

Classify Slack items.
`;
    const next = replaceAutomationContentWithUserPrompt(
      stale,
      "Classify Slack items.",
      "factory-slack-custom",
    );
    expect(next).toContain("works on at most 2 items");
    expect(next).toContain("Never post Slack messages");
    expect(next).not.toContain("Stale skip text");
    expect(next).toContain("Classify Slack items.");
  });

  it("adds a managed review contract only to the PR governance job", () => {
    expect(buildSkillAlignmentBlock("factory-pr-governance-2")).toContain(
      "Current review-prs contract",
    );
    for (const retired of [
      "factory-slack-feedback",
      "factory-sentry-errors",
      "factory-github-issues",
      "factory-pr-babysit",
    ]) {
      expect(buildSkillAlignmentBlock(retired)).toBe("");
    }
  });

  it("never tells a job to call an action that no longer exists", () => {
    for (const source of ["slack", "github", "sentry"] as const) {
      const guardrails = buildGuardrailsText(
        "support-triage",
        defaultAutomationConfig(source),
      );
      for (const retired of [
        "dispatch-factory-item",
        "report-factory-findings",
        "get-slack-feedback-context",
        "babysit-factory-pull-request",
        "propose-pr-babysit-status",
        "#qa-agent-native",
      ]) {
        expect(guardrails).not.toContain(retired);
      }
    }
  });

  it("does not delete a stored Slack channel when the config omits one", () => {
    const content = `---
source: slack
template: blank
slackChannelId: C0BUK2293SA
slackChannelName: feedback
---

Observe Slack.
`;
    const next = applyAutomationConfigFrontmatter(
      content,
      defaultAutomationConfig("slack"),
    );
    expect(next).toContain("slackChannelId: C0BUK2293SA");
    expect(next).toContain("slackChannelName: feedback");
  });

  it("restores editor-owned identity fields dropped during metadata repair", () => {
    const original = `---
source: slack
template: blank
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
template: blank
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
template: blank
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
    expect(body).toContain("poll-slack-channel");
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
    const config = defaultAutomationConfig("slack");
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
    const config = defaultAutomationConfig("slack");
    const retiredUserPrompt = `# Factory Slack feedback triage

For each item, write a one-line summary and a short reason.`;
    const body = composeFactoryAutomationBody({
      userPrompt: retiredUserPrompt,
      automationName: "factory-slack-feedback",
      factoryId: "product-an-feedback",
      config,
    });
    expect(body).toContain("works on at most");
    expect(body).toContain(retiredUserPrompt);
  });

  it("does not require body repair for prompt-only automations missing alignmentRevision", () => {
    const content = `---
template: blank
source: slack
---
Only triage paying customers.
`;
    expect(needsAutomationBodyRepair(content)).toBe(false);
  });

  it("requires body repair when duplicate alignment blocks are present", () => {
    const { start, end } = managedReviewSkillAlignmentMarkers();
    const content = `---
template: blank
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
template: blank
slackChannelId: C0BUK2293SA
slackChannelName: feedback
---

Observe Slack.
`;
    const next = applyAutomationConfigFrontmatter(content, {
      ...defaultAutomationConfig("slack"),
      slackChannelId: "",
      slackChannelName: "",
    });
    expect(next).not.toContain("slackChannelId:");
    expect(next).not.toContain("slackChannelName:");
  });
});

describe("stampAutomationTriggerType", () => {
  const job = (frontmatter: string[]) =>
    ["---", 'schedule: "*/5 * * * *"', ...frontmatter, "---", "", "Body."].join(
      "\n",
    );
  const identified = job([
    "createdBy: alice@example.com",
    "runAs: creator",
    "orgId: org-1",
  ]);

  it("tags a file that can pass the strict identity check, leaving its identity alone", () => {
    const { content, skipped } = stampAutomationTriggerType(identified, {
      orgId: "org-1",
    });

    expect(skipped).toBeUndefined();
    expect(content).toContain("triggerType: schedule");
    expect(content).toContain("createdBy: alice@example.com");
    expect(content.match(/^runAs:/gm)).toHaveLength(1);
    expect(content.match(/^orgId:/gm)).toHaveLength(1);
  });

  it("writes down the runAs and orgId the legacy path already assumes", () => {
    const { content, skipped } = stampAutomationTriggerType(
      job(["createdBy: alice@example.com"]),
      { orgId: "org-1" },
    );

    expect(skipped).toBeUndefined();
    expect(content).toContain("runAs: creator");
    expect(content).toContain("orgId: org-1");
    expect(content).toContain("triggerType: schedule");
  });

  it("reads quoted identity values", () => {
    const { skipped } = stampAutomationTriggerType(
      job([
        'createdBy: "alice@example.com"',
        "runAs: creator",
        'orgId: "org-1"',
      ]),
      { orgId: "org-1" },
    );

    expect(skipped).toBeUndefined();
  });

  it("never invents a creator", () => {
    const legacy = job(["runAs: creator", "orgId: org-1"]);
    const { content, skipped } = stampAutomationTriggerType(legacy, {
      orgId: "org-1",
    });

    expect(content).toBe(legacy);
    expect(skipped).toBe("it has no createdBy");
  });

  it("leaves a file that runs as a shared identity untagged", () => {
    const shared = job(["createdBy: alice@example.com", "runAs: shared"]);
    const { content, skipped } = stampAutomationTriggerType(shared, {
      orgId: "org-1",
    });

    expect(content).toBe(shared);
    expect(skipped).toBe('it runs as "shared"');
  });

  it("leaves a file owned by another org untagged", () => {
    const other = job(["createdBy: alice@example.com", "orgId: org-2"]);
    const { content, skipped } = stampAutomationTriggerType(other, {
      orgId: "org-1",
    });

    expect(content).toBe(other);
    expect(skipped).toBe('its orgId is "org-2", not "org-1"');
  });

  it("keeps whatever trigger type a file already has", () => {
    for (const existing of ["schedule", "webhook"]) {
      const tagged = job([`triggerType: ${existing}`]);
      expect(stampAutomationTriggerType(tagged, { orgId: "org-1" })).toEqual({
        content: tagged,
      });
    }
  });

  it("takes missing identity from the file it replaces and the trigger type it was given", () => {
    const { content, skipped } = stampAutomationTriggerType(job([]), {
      orgId: "org-1",
      triggerType: "webhook",
      identityFrom: identified,
    });

    expect(skipped).toBeUndefined();
    expect(content).toContain("createdBy: alice@example.com");
    expect(content).toContain("triggerType: webhook");
  });
});
