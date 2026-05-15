import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import {
  CODE_AGENT_CLI_GOALS,
  codeShellFreeTextMessage,
  codeUsage,
  handleCodeShellLine,
  parseCodeShellArgs,
  resolveCodeCommand,
  runCode,
  type CodeAgentGoalId,
} from "./code.js";

describe("resolveCodeCommand", () => {
  it("opens the shell when no goal is provided", () => {
    expect(resolveCodeCommand([])).toEqual({ kind: "shell" });
  });

  it("shows help when requested", () => {
    expect(resolveCodeCommand(["--help"])).toEqual({ kind: "help" });
  });

  it("lists available goals", () => {
    expect(resolveCodeCommand(["goals"])).toEqual({ kind: "list-goals" });
    expect(resolveCodeCommand(["list"])).toEqual({ kind: "list-goals" });
  });

  it("forwards slash goals to their backing command", () => {
    expect(
      resolveCodeCommand(["/migrate", "./source", "--out", "../migrated"]),
    ).toEqual({
      kind: "run-goal",
      goalId: "migrate",
      forwardedArgs: ["./source", "--out", "../migrated"],
    });
  });

  it("forwards non-migration slash goals", () => {
    expect(
      resolveCodeCommand(["/audit", "--url", "https://example.com"]),
    ).toEqual({
      kind: "run-goal",
      goalId: "audit",
      forwardedArgs: ["--url", "https://example.com"],
    });
  });

  it("accepts bare goal aliases", () => {
    expect(resolveCodeCommand(["migration", "--describe", "old app"])).toEqual({
      kind: "run-goal",
      goalId: "migrate",
      forwardedArgs: ["--describe", "old app"],
    });
  });

  it("keeps resume/status/ui/stop as default-goal conveniences", () => {
    expect(resolveCodeCommand(["resume", "--last"])).toEqual({
      kind: "run-goal",
      goalId: "migrate",
      forwardedArgs: ["resume", "--last"],
    });
  });

  it("treats freeform input as the default goal source", () => {
    expect(resolveCodeCommand(["./legacy-app", "--emit"])).toEqual({
      kind: "run-goal",
      goalId: "migrate",
      forwardedArgs: ["./legacy-app", "--emit"],
    });
  });
});

describe("codeUsage", () => {
  it("documents migrate as a slash goal", () => {
    expect(codeUsage()).toContain("agent-native code\n");
    expect(codeUsage()).toContain("agent-native code /audit --url");
    expect(codeUsage()).toContain("agent-native code /migrate <source>");
    expect(codeUsage()).toContain("/migrate");
  });
});

describe("parseCodeShellArgs", () => {
  it("splits shell input while preserving quoted text", () => {
    expect(parseCodeShellArgs('/migrate --describe "old app"')).toEqual({
      ok: true,
      args: ["/migrate", "--describe", "old app"],
    });
  });

  it("reports unclosed quotes without throwing", () => {
    expect(parseCodeShellArgs('/migrate --describe "old app')).toEqual({
      ok: false,
      error: 'Unclosed " quote.',
    });
  });
});

describe("handleCodeShellLine", () => {
  it("routes slash goals to the injected runner", async () => {
    const output = createStringOutput();
    const calls: Array<{ goalId: CodeAgentGoalId; forwardedArgs: string[] }> =
      [];

    await handleCodeShellLine('/migrate --describe "old app"', {
      output: output.stream,
      runGoal: async (goalId, forwardedArgs) => {
        calls.push({ goalId, forwardedArgs });
      },
    });

    expect(calls).toEqual([
      { goalId: "migrate", forwardedArgs: ["--describe", "old app"] },
    ]);
    expect(output.read()).toBe("");
  });

  it("keeps migration compatibility shortcuts available in the shell", async () => {
    const output = createStringOutput();
    const calls: Array<{ goalId: CodeAgentGoalId; forwardedArgs: string[] }> =
      [];

    await handleCodeShellLine("status --last", {
      output: output.stream,
      runGoal: async (goalId, forwardedArgs) => {
        calls.push({ goalId, forwardedArgs });
      },
    });

    expect(calls).toEqual([
      { goalId: "migrate", forwardedArgs: ["status", "--last"] },
    ]);
  });

  it("answers shell-only slash commands without running a goal", async () => {
    const output = createStringOutput();
    const calls: Array<{ goalId: CodeAgentGoalId; forwardedArgs: string[] }> =
      [];

    await expect(
      handleCodeShellLine("/goals", {
        output: output.stream,
        runGoal: async (goalId, forwardedArgs) => {
          calls.push({ goalId, forwardedArgs });
        },
      }),
    ).resolves.toBe("continue");

    expect(calls).toEqual([]);
    expect(output.read()).toContain("Available Code Agents goals:");
  });

  it("exits for /exit and /quit", async () => {
    const output = createStringOutput();

    await expect(
      handleCodeShellLine("/exit", {
        output: output.stream,
        runGoal: async () => {},
      }),
    ).resolves.toBe("exit");

    await expect(
      handleCodeShellLine("/quit", {
        output: output.stream,
        runGoal: async () => {},
      }),
    ).resolves.toBe("exit");
  });

  it("explains that arbitrary coding chat is not wired yet", async () => {
    const output = createStringOutput();
    const calls: Array<{ goalId: CodeAgentGoalId; forwardedArgs: string[] }> =
      [];

    await handleCodeShellLine("please refactor the app", {
      output: output.stream,
      runGoal: async (goalId, forwardedArgs) => {
        calls.push({ goalId, forwardedArgs });
      },
    });

    expect(calls).toEqual([]);
    expect(output.read()).toContain(codeShellFreeTextMessage());
  });
});

describe("runCode shell", () => {
  it("can run with scripted stdin for tests", async () => {
    const output = createStringOutput();

    await runCode([], {
      input: Readable.from(["/goals\n", "/exit\n"]),
      output: output.stream,
      runGoal: async () => {
        throw new Error("No goal should run");
      },
    });

    expect(output.read()).toContain("Agent-Native Code Agents");
    expect(output.read()).toContain("Available Code Agents goals:");
    expect(output.read()).toContain("code> ");
  });
});

describe("CODE_AGENT_CLI_GOALS", () => {
  it("keeps slash goals mapped through an explicit backing command", () => {
    expect(CODE_AGENT_CLI_GOALS).toContainEqual(
      expect.objectContaining({
        id: "migrate",
        slashCommand: "/migrate",
        backingCommand: "migrate",
      }),
    );
    expect(CODE_AGENT_CLI_GOALS).toContainEqual(
      expect.objectContaining({
        id: "audit",
        slashCommand: "/audit",
        backingCommand: "audit-agent-web",
      }),
    );
  });
});

function createStringOutput(): {
  stream: Writable;
  read: () => string;
} {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return {
    stream,
    read: () => text,
  };
}
