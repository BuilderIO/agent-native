import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  MAX_AGENT_INSTRUCTION_CHARS,
  MAX_DECLARED_STARTER_TOOLS,
  analyzeAgentChatContextPolicy,
  checkAgentInstructionSizes,
} from "./guard-agent-chat-context";

describe("agent chat context policy guard", () => {
  it("requires an explicit compact first-request policy", () => {
    const policy = analyzeAgentChatContextPolicy({
      file: "templates/example/server/plugins/agent-chat.ts",
      source: "export default createAgentChatPlugin({ actions });",
    });

    assert.equal(policy?.errors.length, 1);
    assert.match(policy?.errors[0] ?? "", /initialToolNames or leanPrompt/);
  });

  it("accepts lean prompts without a starter array", () => {
    const policy = analyzeAgentChatContextPolicy({
      file: "templates/example/server/plugins/agent-chat.ts",
      source: "export default createAgentChatPlugin({ leanPrompt: true });",
    });

    assert.deepEqual(policy?.errors, []);
    assert.equal(policy?.leanPrompt, true);
  });

  it("counts a local static starter array", () => {
    const policy = analyzeAgentChatContextPolicy({
      file: "templates/example/server/plugins/agent-chat.ts",
      source: `
        const INITIAL_TOOL_NAMES = ["view-screen", "navigate"];
        export default createAgentChatPlugin({ initialToolNames: INITIAL_TOOL_NAMES });
      `,
    });

    assert.deepEqual(policy?.errors, []);
    assert.equal(policy?.starterToolCount, 2);
  });

  it("rejects dynamic or oversized starter catalogs", () => {
    const dynamic = analyzeAgentChatContextPolicy({
      file: "templates/dynamic/server/plugins/agent-chat.ts",
      source: `
        const INITIAL_TOOL_NAMES = ["view-screen", ...extraTools];
        export default createAgentChatPlugin({ initialToolNames: INITIAL_TOOL_NAMES });
      `,
    });
    assert.match(dynamic?.errors[0] ?? "", /static array/);

    const names = Array.from(
      { length: MAX_DECLARED_STARTER_TOOLS + 1 },
      (_, index) => `"tool-${index}"`,
    ).join(",");
    const oversized = analyzeAgentChatContextPolicy({
      file: "templates/large/server/plugins/agent-chat.ts",
      source: `
        const INITIAL_TOOL_NAMES = [${names}];
        export default createAgentChatPlugin({ initialToolNames: INITIAL_TOOL_NAMES });
      `,
    });
    assert.equal(oversized?.starterToolCount, MAX_DECLARED_STARTER_TOOLS + 1);
    assert.match(oversized?.errors[0] ?? "", /first-request ceiling/);
  });

  it("ignores re-export-only agent chat plugin files", () => {
    const policy = analyzeAgentChatContextPolicy({
      file: "templates/dispatch/server/plugins/agent-chat.ts",
      source:
        'export { dispatchAgentChatPlugin as default } from "@agent-native/dispatch/server";',
    });

    assert.equal(policy, null);
  });
});

describe("agent instruction size guard", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");

  it("keeps the analytics guide inside the compact-prompt cap", () => {
    const { sizes } = checkAgentInstructionSizes(repoRoot);
    const analytics = sizes.find(
      (entry) => entry.file === "templates/analytics/AGENTS.md",
    );

    assert.ok(
      analytics,
      "expected templates/analytics/AGENTS.md to be checked",
    );
    assert.equal(
      analytics.overCap,
      false,
      `templates/analytics/AGENTS.md is ${analytics.chars} chars; anything past ${MAX_AGENT_INSTRUCTION_CHARS} is silently dropped before the model sees it`,
    );
  });

  it("reports known over-cap templates as warnings, not failures", () => {
    const { errors, warnings } = checkAgentInstructionSizes(repoRoot);

    assert.equal(
      errors.length,
      0,
      `unexpected instruction-size failures:\n${errors.join("\n")}`,
    );
    assert.ok(
      warnings.length > 0,
      "expected the baselined over-cap templates to still be reported",
    );
  });
});
