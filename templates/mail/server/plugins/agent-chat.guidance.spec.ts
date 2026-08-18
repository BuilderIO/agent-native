import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const mailRoot = fileURLToPath(new URL("../../", import.meta.url));
const skill = readFileSync(
  `${mailRoot}.agents/skills/email-drafts/SKILL.md`,
  "utf8",
);
const agentGuide = readFileSync(`${mailRoot}AGENTS.md`, "utf8");
const agentChat = readFileSync(
  `${mailRoot}server/plugins/agent-chat.ts`,
  "utf8",
);

describe("Mail agent guidance", () => {
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
