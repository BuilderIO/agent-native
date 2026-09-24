import { describe, expect, it, vi } from "vitest";

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
          let current = "";
          let inSingle = false;
          let inDouble = false;
          let escape = false;
          for (let i = 0; i < input.args.length; i++) {
            const char = input.args[i];
            if (escape) {
              current += char;
              escape = false;
              continue;
            }
            if (char === "\\") {
              if (inSingle) {
                current += char;
              } else {
                escape = true;
              }
              continue;
            }
            if (char === "'" && !inDouble) {
              inSingle = !inSingle;
              continue;
            }
            if (char === '"' && !inSingle) {
              inDouble = !inDouble;
              continue;
            }
            if (/\s/.test(char) && !inSingle && !inDouble) {
              if (current.length > 0) {
                tokens.push(current);
                current = "";
              }
              continue;
            }
            current += char;
          }
          if (current.length > 0) tokens.push(current);
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

    // Rejects shell operators
    expect(await validRunner({ args: "; rm -rf /" })).toBe(
      "Error: shell operators are not permitted in action arguments",
    );
    expect(bashEntry.run).not.toHaveBeenCalled();

    expect(await validRunner({ args: "--flag && whoami" })).toBe(
      "Error: shell operators are not permitted in action arguments",
    );
    expect(bashEntry.run).not.toHaveBeenCalled();

    // Properly quotes normal and special string args
    await validRunner({ args: "--message=\"hello world\" --user='alice'" });
    expect(bashEntry.run).toHaveBeenCalledWith({
      command: "pnpm action my-action '--message=hello world' '--user=alice'",
    });
  });
});
