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
