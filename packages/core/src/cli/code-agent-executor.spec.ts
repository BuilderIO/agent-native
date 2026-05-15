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
} from "./code-agent-runs.js";
import { executeCodeAgentRun } from "./code-agent-executor.js";

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
  it("runs a file-backed Code Agent session with a fake engine", async () => {
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
      needsApproval: true,
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
