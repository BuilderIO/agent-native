import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const mailRoot = fileURLToPath(new URL("../../", import.meta.url));
const skill = readFileSync(
  `${mailRoot}.agents/skills/email-drafts/SKILL.md`,
  "utf8",
);
const agentGuide = readFileSync(`${mailRoot}AGENTS.md`, "utf8");
const inboxAutomationSkill = readFileSync(
  `${mailRoot}.agents/skills/inbox-automations/SKILL.md`,
  "utf8",
);
const emailRulesAction = readFileSync(
  `${mailRoot}actions/manage-email-rules.ts`,
  "utf8",
);
const legacyAutomationAction = readFileSync(
  `${mailRoot}actions/manage-automations.ts`,
  "utf8",
);
const refineAiFilterAction = readFileSync(
  `${mailRoot}actions/refine-ai-filter.ts`,
  "utf8",
);
const priorityFeedbackAction = readFileSync(
  `${mailRoot}actions/record-ai-priority-feedback.ts`,
  "utf8",
);
const agentChat = readFileSync(
  `${mailRoot}server/plugins/agent-chat.ts`,
  "utf8",
);

describe("Mail agent guidance", () => {
  it("loads automation management before confirming creation", () => {
    expect(agentChat).toMatch(
      /const INITIAL_TOOL_NAMES = \[[\s\S]*"manage-automations",/,
    );
    expect(agentChat).toContain('"manage-email-rules",');
    expect(agentChat).toContain('"apply-ai-filter",');
  });

  it("keeps recurring automations separate from inbox rules", () => {
    expect(emailRulesAction).toContain(
      'import { createManageEmailRulesAction } from "./manage-automations.js";',
    );
    expect(emailRulesAction).toContain(
      "export default createManageEmailRulesAction(true);",
    );
    expect(legacyAutomationAction).toContain(
      "export default createManageEmailRulesAction(false);",
    );
    expect(agentChat).toContain(
      "Use manage-automations for recurring or event-triggered automations",
    );
    expect(agentChat).toContain(
      "Use manage-email-rules for natural-language rules",
    );
    expect(agentGuide).toContain(
      "`manage-email-rules` / `trigger-automations`",
    );
    expect(inboxAutomationSkill).toContain("`manage-email-rules`");
  });

  it("exposes Mail AI rule refinement and priority feedback in chat", () => {
    expect(agentChat).toContain('"refine-ai-filter",');
    expect(agentChat).toContain('"record-ai-priority-feedback",');
    expect(refineAiFilterAction).toContain("agentTool: true");
    expect(priorityFeedbackAction).toContain("agentTool: true");
    expect(agentChat).toContain(
      "automatically apply to up to 200 recent Inbox threads",
    );
    expect(agentChat).toMatch(/report a queued run as queued/i);
    expect(agentChat).toContain('mode "important"');
    expect(agentChat).toContain('mode "filter"');
    expect(inboxAutomationSkill).toContain("`kind=ai-filter`");
    expect(inboxAutomationSkill).toContain('`mode: "tag" | "important"');
    expect(agentChat).toContain(
      'mode "tag", "important", "filter", or "archive"',
    );
    expect(agentChat).toContain('"filter out messages like this"');
    expect(inboxAutomationSkill).toContain("`agent-native-important`");
    expect(inboxAutomationSkill).toContain("`agent-native-filtered`");
    expect(inboxAutomationSkill).toContain("`appliedCounts: null`");
    expect(inboxAutomationSkill).toContain("`refine-ai-filter`");
    expect(agentGuide).toContain("`record-ai-priority-feedback`");
  });

  it("routes durable writing-style changes through settings, not drafts", () => {
    const guidance = `${skill}\n${agentGuide}`;

    expect(agentChat).toMatch(/"get-mail-settings",\s*"update-mail-settings",/);
    expect(agentChat).toContain("Durable Drafting Preferences");
    expect(guidance).toContain("update-mail-settings");
    expect(guidance).toContain("get-mail-settings");
    expect(guidance).toContain("merge");
    expect(guidance).toContain("ask the user to confirm");
    expect(guidance).toMatch(/re-read/i);
    expect(guidance).toContain("Do not call `manage-draft`");
    expect(guidance).toContain("unless the user separately asks");
  });
});
