import { describe, expect, it } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { createRunCodeEntry } from "./run-code.js";

const tool = {
  description: "test action",
  parameters: { type: "object", properties: {} },
};

describe("run-code workspaceRead", () => {
  it("auto-pages across the store per-read cap to return the full file", async () => {
    const perReadCap = 100_000;
    const full = "x".repeat(230_000);
    const actions: Record<string, ActionEntry> = {
      "workspace-files": {
        tool,
        readOnly: false,
        agentTool: false,
        run: async (args) => {
          if (args.action !== "read") {
            return JSON.stringify({ ok: false });
          }
          const offset = Number(args.offset) || 0;
          const requested = Number(args.maxChars) || 40_000;
          const maxChars = requested < perReadCap ? requested : perReadCap;
          const content = full.slice(offset, offset + maxChars);
          const end = offset + content.length;
          const out: Record<string, unknown> = {
            ok: true,
            path: args.path,
            content,
          };
          if (end < full.length) {
            out.truncated = true;
            out.nextOffset = end;
          }
          return JSON.stringify(out);
        },
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: "const c = await workspaceRead('scratch/big.html');\nconsole.log(JSON.stringify({ length: c.length }));",
      timeoutMs: 30_000,
    });

    expect(result).toContain('"length":230000');
  });

  it("returns null for a missing file", async () => {
    const actions: Record<string, ActionEntry> = {
      "workspace-files": {
        tool,
        readOnly: false,
        agentTool: false,
        run: async () => JSON.stringify({ ok: false, error: "not found" }),
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: "const c = await workspaceRead('scratch/missing.html');\nconsole.log(JSON.stringify({ isNull: c === null }));",
      timeoutMs: 30_000,
    });

    expect(result).toContain('"isNull":true');
  });
});
