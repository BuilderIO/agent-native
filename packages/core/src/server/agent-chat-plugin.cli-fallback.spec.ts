import { describe, expect, it, vi } from "vitest";

import { normalizeShellArgs } from "../scripts/parse-args.js";

describe("agent-chat-plugin CLI fallback action runner safety", () => {
  it("rejects invalid action names containing path traversal or shell metacharacters", async () => {
    const bashEntry = { run: vi.fn() };
    const buildFallbackRunner = (name: string) => {
      return async (input: Record<string, string>) => {
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          return "Error: invalid action name";
        }
        const tokens: string[] = [];
        if (typeof input?.args === "string" && input.args.trim()) {
          tokens.push(
            ...normalizeShellArgs(input.args, {
              backslashEscapes: true,
              splitAllWhitespace: true,
            }),
          );
        }

        const BLOCKED_OPERATORS = new Set([
          ";",
          "&&",
          "||",
          "|",
          "&",
          ">",
          ">>",
          "<",
        ]);
        if (tokens.some((token) => BLOCKED_OPERATORS.has(token))) {
          return "Error: shell operators are not permitted in action arguments";
        }

        const escapedArgs = tokens
          .map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'")
          .join(" ");

        return bashEntry.run({
          command: `pnpm action ${name} ${escapedArgs}`.trim(),
        });
      };
    };

    const invalidRunner = buildFallbackRunner("bad;rm -rf");
    expect(await invalidRunner({ args: "" })).toBe(
      "Error: invalid action name",
    );
    expect(bashEntry.run).not.toHaveBeenCalled();

    const validRunner = buildFallbackRunner("my-action");

    expect(await validRunner({ args: "; rm -rf /" })).toBe(
      "Error: shell operators are not permitted in action arguments",
    );
    expect(bashEntry.run).not.toHaveBeenCalled();

    expect(await validRunner({ args: "--flag && whoami" })).toBe(
      "Error: shell operators are not permitted in action arguments",
    );
    expect(bashEntry.run).not.toHaveBeenCalled();

    await validRunner({ args: "--message=\"hello world\" --user='alice'" });
    expect(bashEntry.run).toHaveBeenCalledWith({
      command: "pnpm action my-action '--message=hello world' '--user=alice'",
    });

    const content = "---\nname: spell-check\n---\n# Spell check";
    await validRunner({ args: `--content '${content}' --verbose` });
    expect(bashEntry.run).toHaveBeenLastCalledWith({
      command: `pnpm action my-action '--content=${content}' '--verbose'`,
    });

    await validRunner({ args: "--content --verbose" });
    expect(bashEntry.run).toHaveBeenLastCalledWith({
      command: "pnpm action my-action '--content' '--verbose'",
    });
  });
});
