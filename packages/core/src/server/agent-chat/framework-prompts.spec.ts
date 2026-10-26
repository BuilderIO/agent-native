import { describe, expect, it } from "vitest";

import { buildFrameworkPrompts } from "./framework-prompts.js";

function planModeSection(prompt: string): string {
  const start = prompt.indexOf("### Plan Mode");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = prompt.indexOf("\n### ", start + 1);
  return prompt.slice(start, end === -1 ? undefined : end);
}

describe("buildFrameworkPrompts Plan mode guidance", () => {
  it("keeps writes out of a Plan turn and lets the next message carry out the plan", () => {
    const section = planModeSection(
      buildFrameworkPrompts().PROD_FRAMEWORK_PROMPT,
    );

    expect(section).toContain(
      "Do not call `connect-builder`, or any action that creates, updates, deletes, sends, publishes, or persists data in a Plan turn; the user's next message carries out the plan.",
    );
    expect(section).not.toContain("switches back to Act mode");
  });

  it("scopes the compact production prompt's restriction to the Plan turn", () => {
    const section = planModeSection(
      buildFrameworkPrompts().PROD_FRAMEWORK_PROMPT_COMPACT,
    );

    expect(section).toContain(
      "do not call `connect-builder`, or any action that creates, updates, deletes, sends, publishes, or persists data in a Plan turn.",
    );
    expect(section).not.toContain("switches back to Act mode");
  });

  it("names the extension tools a Plan turn must not call when extensions are enabled", () => {
    const { PROD_FRAMEWORK_PROMPT, PROD_FRAMEWORK_PROMPT_COMPACT } =
      buildFrameworkPrompts(undefined, { extensionTools: true });

    for (const prompt of [
      PROD_FRAMEWORK_PROMPT,
      PROD_FRAMEWORK_PROMPT_COMPACT,
    ]) {
      expect(planModeSection(prompt)).toContain(
        "`render-inline-extension`, `create-extension`, `update-extension`, `connect-builder`, or any action that creates, updates, deletes, sends, publishes, or persists data in a Plan turn",
      );
    }
  });
});
