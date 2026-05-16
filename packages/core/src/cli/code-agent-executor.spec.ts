import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCodeAgentRunRecord,
  codeAgentRunTranscriptPath,
  getCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
  queueCodeAgentFollowUp,
  updateCodeAgentRunRecord,
} from "./code-agent-runs.js";
import {
  classifyCodeAgentCommandPermission,
  executeCodeAgentRun,
  executePendingCodeAgentApproval,
} from "./code-agent-executor.js";

const tmpRoots: string[] = [];
const providerEnvKeys = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "BUILDER_PRIVATE_KEY",
] as const;
const originalProviderEnv = new Map(
  providerEnvKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  delete process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE;
  for (const key of providerEnvKeys) {
    const original = originalProviderEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("executeCodeAgentRun", () => {
  it("runs a file-backed Agent-Native Code session with a fake engine", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE =
      "I checked the workspace and found the issue.";
    const output = createStringOutput();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Fix auth tests",
      status: "queued",
      cwd: process.cwd(),
    });

    await executeCodeAgentRun({
      runId: run.id,
      prompt: "fix auth tests",
      stdout: output.stream,
    });

    const updated = getCodeAgentRunRecord(run.id);
    expect(updated).toMatchObject({
      status: "completed",
      phase: "complete",
      progress: { completed: 1, total: 1, percent: 100 },
    });
    expect(output.read()).toContain("I checked the workspace");
    expect(
      listCodeAgentTranscriptEvents(run.id).map((event) => event.kind),
    ).toEqual(["user", "status", "system", "status"]);
  });

  it("pauses with a credential hint when no provider key is available", async () => {
    useTempCodeAgentsHome();
    for (const key of providerEnvKeys) delete process.env[key];
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Fix auth tests",
      status: "queued",
      cwd: process.cwd(),
    });

    await executeCodeAgentRun({ runId: run.id, prompt: "fix auth tests" });

    const updated = getCodeAgentRunRecord(run.id);
    expect(updated).toMatchObject({
      status: "paused",
      phase: "missing-credentials",
      needsApproval: false,
    });
    expect(listCodeAgentTranscriptEvents(run.id).at(-1)?.message).toContain(
      "No LLM provider key was found",
    );
  });

  it("can execute a run whose initial prompt was written by Desktop", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Desktop run done.";
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Desktop task",
      status: "queued",
      cwd: process.cwd(),
    });
    fs.mkdirSync(path.dirname(codeAgentRunTranscriptPath(run.id)), {
      recursive: true,
    });
    fs.appendFileSync(
      codeAgentRunTranscriptPath(run.id),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "desktop-event-1",
        runId: run.id,
        type: "user",
        text: "fix desktop-started run",
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    const output = createStringOutput();

    await executeCodeAgentRun({
      runId: run.id,
      appendUserEvent: false,
      stdout: output.stream,
    });

    expect(getCodeAgentRunRecord(run.id)).toMatchObject({
      status: "completed",
      phase: "complete",
    });
    expect(output.read()).toContain("Desktop run done.");
    expect(listCodeAgentTranscriptEvents(run.id)[0]).toMatchObject({
      kind: "user",
      message: "fix desktop-started run",
    });
  });

  it("records the run mode during execution", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Permission noted.";
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Explain repo",
      permissionMode: "read-only",
      status: "queued",
      cwd: process.cwd(),
    });

    await executeCodeAgentRun({
      runId: run.id,
      prompt: "explain repo",
    });

    expect(getCodeAgentRunRecord(run.id)).toMatchObject({
      status: "completed",
      metadata: {
        permissionMode: "read-only",
      },
    });
  });

  it("runs pending follow-ups after the current execution completes", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Turn done.";
    const output = createStringOutput();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Active task",
      status: "running",
      phase: "executing",
      cwd: process.cwd(),
    });
    queueCodeAgentFollowUp({
      runId: run.id,
      prompt: "follow up after completion",
      mode: "queued",
      source: "test",
    });

    await executeCodeAgentRun({
      runId: run.id,
      prompt: "finish current work",
      stdout: output.stream,
    });

    const updated = getCodeAgentRunRecord(run.id);
    const events = listCodeAgentTranscriptEvents(run.id);
    expect(updated).toMatchObject({
      status: "completed",
      phase: "complete",
    });
    expect(updated?.metadata?.pendingFollowUps).toBeUndefined();
    expect(output.read().match(/Turn done\./g)).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "status",
          message: "Agent-Native Code run completed; running queued follow-up.",
        }),
      ]),
    );
  });

  it("executes an explicitly approved pending command and clears the approval", async () => {
    const root = useTempCodeAgentsHome();
    const cwd = path.join(root, "repo");
    const target = path.join(cwd, "approval-target");
    fs.mkdirSync(target, { recursive: true });
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Approved cleanup",
      status: "needs-approval",
      phase: "approval-required",
      needsApproval: true,
      cwd,
    });
    updateCodeAgentRunRecord(run.id, {
      metadata: {
        pendingApproval: {
          id: "approval-test",
          tool: "run_command",
          command: "rm -rf approval-target",
          reason: "destructive recursive delete",
          requestedAt: new Date().toISOString(),
          permissionMode: "ask-before-edit",
        },
      },
    });
    const output = createStringOutput();

    await executePendingCodeAgentApproval(run.id, { stdout: output.stream });

    const updated = getCodeAgentRunRecord(run.id);
    expect(fs.existsSync(target)).toBe(false);
    expect(updated).toMatchObject({
      status: "paused",
      phase: "approval-complete",
      needsApproval: false,
      metadata: {
        lastApproval: {
          id: "approval-test",
          exitCode: 0,
        },
      },
    });
    expect(updated?.metadata?.pendingApproval).toBeUndefined();
    expect(output.read()).toContain("Approved command finished");
  });
});

describe("classifyCodeAgentCommandPermission", () => {
  it("allows read-only inspection commands", () => {
    expect(classifyCodeAgentCommandPermission("git status --short")).toEqual({
      kind: "read",
    });
    expect(classifyCodeAgentCommandPermission("rg button src")).toEqual({
      kind: "read",
    });
  });

  it("classifies file-writing commands as write operations", () => {
    expect(classifyCodeAgentCommandPermission("echo hi > notes.txt")).toEqual({
      kind: "write",
    });
    expect(classifyCodeAgentCommandPermission("pnpm add left-pad")).toEqual({
      kind: "write",
    });
  });

  it("blocks forbidden git commands and requests approval for destructive commands", () => {
    expect(
      classifyCodeAgentCommandPermission("git reset --hard"),
    ).toMatchObject({ kind: "forbidden" });
    expect(classifyCodeAgentCommandPermission("rm -rf dist")).toMatchObject({
      kind: "approval-required",
    });
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-code-exec-"));
  tmpRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = path.join(root, "code-agents");
  return root;
}
