import fs from "fs";
import os from "os";
import path from "path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCodeAgentRunRecord,
  listCodeAgentRunRecords,
  listCodeAgentTranscriptEvents,
} from "./code-agent-runs.js";
import {
  CODE_AGENT_CLI_GOALS,
  codeUsage,
  handleCodeShellLine,
  parseCodeShellArgs,
  resolveCodeCommand,
  runCode,
  type CodeAgentGoalId,
} from "./code.js";

const tmpRoots: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  delete process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE;
  vi.restoreAllMocks();
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveCodeCommand", () => {
  it("opens the shell when no goal is provided", () => {
    expect(resolveCodeCommand([])).toEqual({ kind: "shell" });
  });

  it("shows help when requested", () => {
    expect(resolveCodeCommand(["--help"])).toEqual({ kind: "help" });
  });

  it("lists available goals", () => {
    expect(resolveCodeCommand(["goals"])).toEqual({ kind: "list-goals" });
  });

  it("lists sessions through Codex-style session commands", () => {
    expect(resolveCodeCommand(["list"])).toEqual({
      kind: "control",
      subcommand: "list",
      args: ["list"],
    });
    expect(resolveCodeCommand(["ps"])).toEqual({
      kind: "control",
      subcommand: "ps",
      args: ["ps"],
    });
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

  it("forwards task goals", () => {
    expect(resolveCodeCommand(["/task", "fix", "the", "tests"])).toEqual({
      kind: "run-goal",
      goalId: "task",
      forwardedArgs: ["fix", "the", "tests"],
    });
  });

  it("accepts exec and print aliases for generic tasks", () => {
    expect(resolveCodeCommand(["exec", "fix", "the", "tests"])).toEqual({
      kind: "run-goal",
      goalId: "task",
      forwardedArgs: ["fix", "the", "tests"],
    });
    expect(resolveCodeCommand(["-p", "fix", "the", "tests"])).toEqual({
      kind: "run-goal",
      goalId: "task",
      forwardedArgs: ["fix", "the", "tests"],
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

  it("routes project slash commands from .agents/commands", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-code-command-"));
    tmpRoots.push(root);
    fs.mkdirSync(path.join(root, ".agents", "commands"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".agents", "commands", "review-diff.md"),
      "Review the current diff.",
    );
    process.chdir(root);

    expect(resolveCodeCommand(["/review-diff", "--cached"])).toEqual({
      kind: "run-project-command",
      commandName: "review-diff",
      forwardedArgs: ["--cached"],
    });
  });

  it("accepts bare goal aliases", () => {
    expect(resolveCodeCommand(["migration", "--describe", "old app"])).toEqual({
      kind: "run-goal",
      goalId: "migrate",
      forwardedArgs: ["--describe", "old app"],
    });
  });

  it("handles resume/status/ui/stop at the generic Code Agents layer", () => {
    expect(resolveCodeCommand(["resume", "--last"])).toEqual({
      kind: "control",
      subcommand: "resume",
      args: ["resume", "--last"],
    });
    expect(resolveCodeCommand(["approve", "--last"])).toEqual({
      kind: "control",
      subcommand: "approve",
      args: ["approve", "--last"],
    });
  });

  it("supports continue and resume flag aliases", () => {
    expect(resolveCodeCommand(["--continue"])).toEqual({
      kind: "control",
      subcommand: "resume",
      args: ["resume", "--last"],
    });
    expect(resolveCodeCommand(["-c", "please continue"])).toEqual({
      kind: "record-follow-up",
      prompt: "please continue",
    });
    expect(resolveCodeCommand(["--resume", "task-123"])).toEqual({
      kind: "control",
      subcommand: "resume",
      args: ["resume", "task-123"],
    });
  });

  it("can execute an existing run by id", () => {
    expect(resolveCodeCommand(["run", "task-123"])).toEqual({
      kind: "execute-existing-run",
      runId: "task-123",
    });
  });

  it("records resume follow-up prompts against the last run", () => {
    expect(resolveCodeCommand(["resume", "--last", "please continue"])).toEqual(
      {
        kind: "record-follow-up",
        prompt: "please continue",
      },
    );
    expect(resolveCodeCommand(["resume", "--last", "--", "--fix-it"])).toEqual({
      kind: "record-follow-up",
      prompt: "--fix-it",
    });
    expect(
      resolveCodeCommand([
        "resume",
        "task-20260515t120000z-deadbeef",
        "please continue",
      ]),
    ).toEqual({
      kind: "record-follow-up",
      runId: "task-20260515t120000z-deadbeef",
      prompt: "please continue",
    });
  });

  it("lets built-in slash goals win over project command files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-code-shadow-"));
    tmpRoots.push(root);
    fs.mkdirSync(path.join(root, ".agents", "commands"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".agents", "commands", "task.md"),
      "Shadow the task command.",
    );
    process.chdir(root);

    expect(resolveCodeCommand(["/task", "fix", "the", "tests"])).toEqual({
      kind: "run-goal",
      goalId: "task",
      forwardedArgs: ["fix", "the", "tests"],
    });
  });

  it("treats freeform input as a generic task", () => {
    expect(resolveCodeCommand(["please", "refactor", "the", "app"])).toEqual({
      kind: "run-goal",
      goalId: "task",
      forwardedArgs: ["please", "refactor", "the", "app"],
    });
  });
});

describe("codeUsage", () => {
  it("documents migrate as a slash goal", () => {
    expect(codeUsage()).toContain("agent-native code\n");
    expect(codeUsage()).toContain('agent-native code "fix the failing');
    expect(codeUsage()).toContain("agent-native code exec");
    expect(codeUsage()).toContain("agent-native code -p");
    expect(codeUsage()).toContain("agent-native code /task");
    expect(codeUsage()).toContain("agent-native code /audit --url");
    expect(codeUsage()).toContain("agent-native code /migrate <source>");
    expect(codeUsage()).toContain("agent-native code attach --last");
    expect(codeUsage()).toContain("/migrate");
  });

  it("lists visible project slash commands without reserved names", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-code-help-"));
    tmpRoots.push(root);
    fs.mkdirSync(path.join(root, ".agents", "commands"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".agents", "commands", "release-check.md"),
      [
        "---",
        'description: "Run release checks"',
        "argument-hint: <version>",
        "---",
        "Check release $ARGUMENTS.",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, ".agents", "commands", "migrate.md"),
      ["---", 'description: "Shadow migrate"', "---", "Do not show this."].join(
        "\n",
      ),
    );
    process.chdir(root);
    const output = createStringOutput();

    await runCode(["goals"], { output: output.stream });

    const text = output.read();
    expect(text).toContain("Project commands:");
    expect(text).toContain("/release-check <version>");
    expect(text).toContain("Run release checks");
    expect(text).not.toContain("Shadow migrate");
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

  it("handles status shortcuts without running a goal", async () => {
    useTempCodeAgentsHome();
    createCodeAgentRunRecord({
      goalId: "task",
      title: "Existing task",
    });
    const output = createStringOutput();
    const calls: Array<{ goalId: CodeAgentGoalId; forwardedArgs: string[] }> =
      [];

    await handleCodeShellLine("status --last", {
      output: output.stream,
      runGoal: async (goalId, forwardedArgs) => {
        calls.push({ goalId, forwardedArgs });
      },
    });

    expect(calls).toEqual([]);
    expect(output.read()).toContain("Code Agents status");
    expect(output.read()).toContain("Existing task");
  });

  it("prints transcript logs without running a goal", async () => {
    useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Existing task",
      status: "completed",
      phase: "complete",
    });
    const output = createStringOutput();
    const calls: Array<{ goalId: CodeAgentGoalId; forwardedArgs: string[] }> =
      [];

    await handleCodeShellLine("logs --last", {
      output: output.stream,
      runGoal: async (goalId, forwardedArgs) => {
        calls.push({ goalId, forwardedArgs });
      },
    });

    expect(calls).toEqual([]);
    expect(output.read()).toContain(`Code Agents logs: ${run.id}`);
    expect(output.read()).toContain("Existing task");
    expect(output.read()).toContain("Events: 0");
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

  it("records bare shell prompts as generic tasks", async () => {
    const output = createStringOutput();
    const calls: Array<{ goalId: CodeAgentGoalId; forwardedArgs: string[] }> =
      [];

    await handleCodeShellLine("please refactor the app", {
      output: output.stream,
      runGoal: async (goalId, forwardedArgs) => {
        calls.push({ goalId, forwardedArgs });
      },
    });

    expect(calls).toEqual([
      {
        goalId: "task",
        forwardedArgs: ["please", "refactor", "the", "app"],
      },
    ]);
    expect(output.read()).toBe("");
  });

  it("records shell resume follow-up prompts without running a goal", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Follow-up done.";
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Existing task",
    });
    const output = createStringOutput();
    const calls: Array<{ goalId: CodeAgentGoalId; forwardedArgs: string[] }> =
      [];

    await handleCodeShellLine('resume --last "add regression tests"', {
      output: output.stream,
      runGoal: async (goalId, forwardedArgs) => {
        calls.push({ goalId, forwardedArgs });
      },
    });

    const events = listCodeAgentTranscriptEvents(run.id);
    expect(calls).toEqual([]);
    expect(output.read()).toContain("Running follow-up prompt");
    expect(output.read()).toContain("Follow-up done.");
    expect(events[0]).toMatchObject({
      kind: "user",
      message: "add regression tests",
      metadata: { source: "resume-follow-up" },
    });
    expect(events.map((event) => event.kind)).toContain("system");
  });
});

describe("generic task sessions", () => {
  it("runs a task session with transcript events", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Task complete.";
    const output = createStringOutput();

    await runCode(["/task", "fix", "the", "tests"], {
      output: output.stream,
    });

    const runs = listCodeAgentRunRecords("task");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      goalId: "task",
      title: "fix the tests",
      status: "completed",
      phase: "complete",
      metadata: {
        prompt: "fix the tests",
        source: "agent-native code /task",
      },
    });
    expect(
      listCodeAgentTranscriptEvents(runs[0].id).map((event) => event.kind),
    ).toEqual(["user", "status", "status", "system", "status"]);
    expect(output.read()).toContain("Code Agents /task session started.");
    expect(output.read()).toContain("Task complete.");
  });

  it("stores permission mode on generic task sessions", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Read-only pass.";
    const output = createStringOutput();

    await runCode(["--permission-mode", "read-only", "explain", "repo"], {
      output: output.stream,
    });

    const runs = listCodeAgentRunRecords("task");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      permissionMode: "read-only",
      metadata: {
        prompt: "explain repo",
        permissionMode: "read-only",
      },
    });
    expect(output.read()).toContain("Mode:   read-only");
  });

  it("runs project slash commands as generic task sessions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-code-project-"));
    tmpRoots.push(root);
    process.chdir(root);
    fs.mkdirSync(path.join(root, ".agents", "commands"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".agents", "commands", "review-diff.md"),
      [
        "---",
        'description: "Review repository changes"',
        "argument-hint: [--cached]",
        "---",
        "Review the diff for $ARGUMENTS.",
      ].join("\n"),
    );
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Project command done.";
    const output = createStringOutput();

    await runCode(["/review-diff", "--read-only", "--cached"], {
      output: output.stream,
    });

    const runs = listCodeAgentRunRecords("task");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      subtitle: "Project command /review-diff",
      permissionMode: "read-only",
      metadata: {
        commandName: "review-diff",
        source: "agent-native code project-command",
        permissionMode: "read-only",
      },
    });
    expect(listCodeAgentTranscriptEvents(runs[0].id)[0]?.message).toContain(
      "Review the diff for --cached.",
    );
    expect(output.read()).toContain("Project command done.");
  });

  it("runs direct CLI follow-up prompts on the last run", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Follow-up done.";
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Existing task",
    });
    const output = createStringOutput();

    await runCode(["resume", "--last", "please continue"], {
      output: output.stream,
    });

    const events = listCodeAgentTranscriptEvents(run.id);
    expect(output.read()).toContain("Running follow-up prompt");
    expect(output.read()).toContain("Follow-up done.");
    expect(events[0]).toMatchObject({
      kind: "user",
      message: "please continue",
    });
    expect(events.map((event) => event.kind)).toContain("system");
  });

  it("runs direct CLI follow-up prompts on an explicit run", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Explicit done.";
    const selectedRun = createCodeAgentRunRecord({
      goalId: "task",
      title: "Selected task",
    });
    const latestRun = createCodeAgentRunRecord({
      goalId: "task",
      title: "Latest task",
    });
    const output = createStringOutput();

    await runCode(["resume", selectedRun.id, "continue selected"], {
      output: output.stream,
    });

    expect(output.read()).toContain("Explicit done.");
    expect(listCodeAgentTranscriptEvents(selectedRun.id)[0]).toMatchObject({
      kind: "user",
      message: "continue selected",
    });
    expect(listCodeAgentTranscriptEvents(latestRun.id)).toEqual([]);
  });

  it("shows generic Code Agents status for the last run", async () => {
    useTempCodeAgentsHome();
    createCodeAgentRunRecord({
      goalId: "task",
      title: "Existing task",
      status: "paused",
      phase: "review",
    });
    const output = createStringOutput();

    await runCode(["status", "--last"], { output: output.stream });

    const text = output.read();
    expect(text).toContain("Code Agents status");
    expect(text).toContain("Existing task");
    expect(text).toContain("paused (review)");
  });

  it("does not rewrite completed runs when stop is requested", async () => {
    useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Finished task",
      status: "completed",
      phase: "complete",
      progress: { completed: 1, total: 1, percent: 100 },
    });
    const output = createStringOutput();

    await runCode(["stop", "--last"], { output: output.stream });

    const [updated] = listCodeAgentRunRecords("task");
    expect(output.read()).toContain("already finished");
    expect(updated).toMatchObject({
      id: run.id,
      status: "completed",
      phase: "complete",
      progress: { completed: 1, total: 1, percent: 100 },
    });
  });

  it("approves a pending command and points back to resume", async () => {
    const root = useTempCodeAgentsHome();
    const cwd = path.join(root, "workspace");
    fs.mkdirSync(cwd, { recursive: true });
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Approval task",
      status: "needs-approval",
      phase: "approval-required",
      needsApproval: true,
      cwd,
      permissionMode: "ask-before-edit",
      metadata: {
        pendingApproval: {
          id: "approval-test",
          tool: "run_command",
          command:
            "node -e \"require('fs').writeFileSync('approved.txt', 'ok')\"",
          reason: "destructive recursive delete",
          requestedAt: new Date().toISOString(),
          permissionMode: "ask-before-edit",
        },
      },
    });
    const output = createStringOutput();

    await runCode(["approve", "--last"], { output: output.stream });

    const [updated] = listCodeAgentRunRecords("task");
    expect(fs.readFileSync(path.join(cwd, "approved.txt"), "utf-8")).toBe("ok");
    expect(updated).toMatchObject({
      id: run.id,
      status: "paused",
      phase: "approval-complete",
      needsApproval: false,
    });
    expect(output.read()).toContain("Code Agents approve");
    expect(output.read()).toContain(
      "Approved command finished with exit code 0",
    );
    expect(output.read()).toContain(`agent-native code run ${run.id}`);
  });

  it("lists sessions with inspect commands", async () => {
    useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Existing task",
      permissionMode: "auto-edit",
    });
    const output = createStringOutput();

    await runCode(["list"], { output: output.stream });

    const text = output.read();
    expect(text).toContain("Code Agents sessions");
    expect(text).toContain(run.id);
    expect(text).toContain("auto-edit");
    expect(text).toContain("agent-native code status <runId>");
    expect(text).toContain(
      'agent-native code resume <runId> "follow-up prompt"',
    );
  });

  it("shows resume commands for an explicit session", async () => {
    useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Existing task",
      permissionMode: "read-only",
    });
    const output = createStringOutput();

    await runCode(["resume", run.id], { output: output.stream });

    const text = output.read();
    expect(text).toContain("Code Agents resume");
    expect(text).toContain("Title:   Existing task");
    expect(text).toContain("Mode:    read-only");
    expect(text).toContain(`agent-native code run ${run.id}`);
    expect(text).toContain(
      `agent-native code resume ${run.id} "next instruction"`,
    );
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
        id: "task",
        slashCommand: "/task",
        backingCommand: "task",
      }),
    );
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

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-code-"));
  tmpRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = path.join(root, "code-agents");
  return root;
}
