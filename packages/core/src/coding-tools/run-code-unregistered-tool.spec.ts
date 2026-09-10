import { describe, expect, it } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { createRunCodeEntry } from "./run-code.js";

const tool = {
  description: "test action",
  parameters: { type: "object", properties: {} },
};

describe("run-code bridge unregistered tools", () => {
  it("returns a distinct not-registered error for unknown tools", async () => {
    const actions: Record<string, ActionEntry> = {
      "read-users": { tool, readOnly: true, run: async () => ({ ok: true }) },
    };
    const entry = createRunCodeEntry(() => actions);

    const code = [
      "try {",
      '  await appAction("does-not-exist", {});',
      "} catch (err) {",
      '  console.log("caught: " + err.message);',
      "}",
    ].join("\n");

    const result = await entry.run({ code, timeoutMs: 30_000 });

    // Unknown tool must report "not registered" (404), not the misleading
    // "not an agent-exposed read-only action" access error (403) that an
    // undefined entry used to fall into.
    expect(result).toContain(
      'caught: Tool "does-not-exist" is not registered.',
    );
    expect(result).not.toContain("not an agent-exposed read-only action");
  });
});
