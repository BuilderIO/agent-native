import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLocalCodeBackgroundAgentController,
  getBackgroundAgentRun,
  listBackgroundAgentRuns,
  listBackgroundAgentTranscriptEvents,
  toBackgroundAgentRun,
  toBackgroundAgentTranscriptEvent,
} from "../code-agents/index.js";
import {
  appendCodeAgentTranscriptEvent,
  addCodeAgentCommandToAllowlist,
  codeAgentRunArtifactsDir,
  codeAgentRunTranscriptPath,
  createCodeAgentRunRecord,
  getCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
  readCodeAgentCommandAllowlist,
  updateCodeAgentRunRecord,
} from "./code-agent-runs.js";
import {
  activateStoredMultiFrontierDriver,
  createMultiFrontierRun,
  listMultiFrontierParticipantEvents,
} from "./multi-frontier-runs.js";

const tmpRoots: string[] = [];
const cliDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(cliDirectory, "../../../..");
const concurrencyWorker = path.join(
  cliDirectory,
  "code-agent-runs.concurrent-worker.ts",
);

afterEach(() => {
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  delete process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE;
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("background agent run adapter", () => {
  it("maps Code run records to the shared background run shape", () => {
    useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Fix auth tests",
      subtitle: "packages/core",
      status: "needs-approval",
      phase: "approval-required",
      needsApproval: true,
      progress: {
        label: "Checks",
        completed: 1,
        total: 2,
        percent: 50,
      },
      permissionMode: "ask-before-edit",
      details: [{ label: "Branch", value: "current" }],
      artifactRoot: "/tmp/artifacts",
      surfaceUrl: "agent-native://code/runs/run-1",
      cwd: "/workspace/app",
      metadata: { source: "desktop" },
    });

    expect(toBackgroundAgentRun(run)).toMatchObject({
      schemaVersion: 1,
      id: run.id,
      kind: "code",
      source: "local-code",
      sourceRecord: {
        type: "code-agent-run",
        id: run.id,
      },
      title: "Fix auth tests",
      subtitle: "packages/core",
      status: "needs-approval",
      phase: "approval-required",
      cwd: "/workspace/app",
      goalId: "task",
      permissionMode: "ask-before-edit",
      needsInput: true,
      needsApproval: true,
      transcriptPath: codeAgentRunTranscriptPath(run.id),
      artifactRoot: "/tmp/artifacts",
      surfaceUrl: "agent-native://code/runs/run-1",
      metadata: { source: "desktop" },
    });
  });

  it("lists and gets background runs without changing Code storage", () => {
    useTempCodeAgentsHome();
    const first = createCodeAgentRunRecord({
      goalId: "task",
      title: "Older task",
      status: "completed",
      cwd: "/repo",
    });
    const second = createCodeAgentRunRecord({
      goalId: "migrate",
      title: "Latest migration",
      status: "paused",
      cwd: "/repo",
    });

    const runs = listBackgroundAgentRuns();

    expect(runs.map((run) => run.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(listBackgroundAgentRuns({ goalId: "task" })).toEqual([
      expect.objectContaining({
        id: first.id,
        kind: "code",
        source: "local-code",
        needsInput: false,
        artifactRoot: codeAgentRunArtifactsDir(first.id),
      }),
    ]);
    expect(getBackgroundAgentRun(second.id)).toMatchObject({
      id: second.id,
      goalId: "migrate",
      needsInput: true,
      needsApproval: false,
    });
    expect(getBackgroundAgentRun("missing")).toBeNull();
  });

  it("maps transcript events to the shared transcript event shape", () => {
    useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Explain adapter",
      status: "running",
      cwd: "/repo",
    });
    const event = appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "system",
      message: "Adapter ready.",
      createdAt: "2026-05-16T10:00:00.000Z",
      metadata: { tokenCount: 3 },
    });

    expect(toBackgroundAgentTranscriptEvent(event)).toEqual({
      schemaVersion: 1,
      id: event.id,
      runId: run.id,
      kind: "system",
      source: "local-code",
      sourceRecord: {
        type: "code-agent-transcript-event",
        id: event.id,
      },
      message: "Adapter ready.",
      createdAt: "2026-05-16T10:00:00.000Z",
      metadata: { tokenCount: 3 },
    });
    expect(listBackgroundAgentTranscriptEvents(run.id)).toEqual([
      toBackgroundAgentTranscriptEvent(event),
    ]);
  });
});

describe("local code background agent controller", () => {
  it("exposes list/get/transcript through the shared controller interface", async () => {
    useTempCodeAgentsHome();
    const controller = createLocalCodeBackgroundAgentController();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Controller task",
      status: "paused",
      cwd: "/repo",
    });
    const event = appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "user",
      message: "check controller",
    });

    await expect(
      Promise.resolve(controller.list({ goalId: "task" })),
    ).resolves.toEqual([
      expect.objectContaining({ id: run.id, source: "local-code" }),
    ]);
    await expect(
      Promise.resolve(controller.get(run.id)),
    ).resolves.toMatchObject({
      id: run.id,
      title: "Controller task",
    });
    await expect(
      Promise.resolve(controller.transcript(run.id)),
    ).resolves.toEqual([
      expect.objectContaining({ id: event.id, message: "check controller" }),
    ]);
  });

  it("queues follow-ups for active runs without starting another executor", async () => {
    useTempCodeAgentsHome();
    const controller = createLocalCodeBackgroundAgentController();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Active controller task",
      status: "running",
      phase: "executing",
      cwd: "/repo",
    });

    const result = await controller.sendFollowUp({
      runId: run.id,
      prompt: "focus the failing test",
      mode: "queued",
      permissionMode: "ask-before-edit",
    });

    expect(result).toMatchObject({
      ok: true,
      runId: run.id,
      queued: true,
      run: {
        status: "running",
        permissionMode: "ask-before-edit",
      },
    });
    expect(getCodeAgentRunRecord(run.id)?.metadata?.pendingFollowUps).toEqual([
      expect.objectContaining({
        prompt: "focus the failing test",
        mode: "queued",
        permissionMode: "ask-before-edit",
        source: "background-agent-controller",
      }),
    ]);
    expect(listCodeAgentTranscriptEvents(run.id).at(-1)).toMatchObject({
      kind: "user",
      message: "focus the failing test",
      metadata: { delivery: "queued" },
    });
  });

  it("executes follow-ups immediately for inactive runs", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE =
      "Controller follow-up done.";
    const controller = createLocalCodeBackgroundAgentController();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Paused controller task",
      status: "paused",
      phase: "paused",
      cwd: process.cwd(),
    });

    const result = await controller.sendFollowUp({
      runId: run.id,
      prompt: "finish the paused task",
    });

    expect(result).toMatchObject({
      ok: true,
      queued: false,
      run: {
        id: run.id,
        status: "completed",
        phase: "complete",
      },
    });
    expect(
      listCodeAgentTranscriptEvents(run.id).map((event) => event.message),
    ).toEqual(
      expect.arrayContaining([
        "finish the paused task",
        "Controller follow-up done.",
      ]),
    );
  });

  it("marks stop locally without signaling a runner process", async () => {
    useTempCodeAgentsHome();
    const controller = createLocalCodeBackgroundAgentController();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Stop controller task",
      status: "running",
      phase: "executing",
      cwd: "/repo",
      metadata: { runnerPid: 999_999 },
    });

    const result = await controller.control({ runId: run.id, command: "stop" });

    expect(result).toMatchObject({
      ok: true,
      run: {
        status: "paused",
        phase: "stopped",
      },
      message:
        "Agent-Native Code run marked stopped without signaling a process.",
    });
    expect(getCodeAgentRunRecord(run.id)).toMatchObject({
      status: "paused",
      phase: "stopped",
      metadata: {
        runnerPid: 999_999,
        runnerState: "stopped",
        stopSignalSent: false,
      },
    });
    expect(listCodeAgentTranscriptEvents(run.id).at(-1)).toMatchObject({
      message:
        "Stop requested for Agent-Native Code run. No process signal was sent.",
    });
  });

  it("resumes and retries runs through the local Code executor", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE =
      "Controller execution done.";
    const controller = createLocalCodeBackgroundAgentController();
    const resumeRun = createCodeAgentRunRecord({
      goalId: "task",
      title: "Resume controller task",
      status: "paused",
      cwd: process.cwd(),
    });
    appendCodeAgentTranscriptEvent({
      runId: resumeRun.id,
      kind: "user",
      message: "resume this",
    });
    const retryRun = createCodeAgentRunRecord({
      goalId: "task",
      title: "Retry controller task",
      status: "errored",
      cwd: process.cwd(),
    });
    appendCodeAgentTranscriptEvent({
      runId: retryRun.id,
      kind: "user",
      message: "retry this",
    });

    // resume/retry are non-blocking control actions: they kick the run off
    // in the background and return immediately with the current run state
    // (a control action must not await the full session, which would time
    // out the HTTP/IPC caller).
    await expect(
      controller.control({ runId: resumeRun.id, command: "resume" }),
    ).resolves.toMatchObject({
      ok: true,
      run: { id: resumeRun.id },
      message: "Agent-Native Code run resuming in the background.",
    });
    await expect(
      controller.control({ runId: retryRun.id, command: "retry" }),
    ).resolves.toMatchObject({
      ok: true,
      run: { id: retryRun.id },
      message: "Agent-Native Code run retrying in the background.",
    });

    // The background executions still complete (fake response) — wait for
    // them so the run records settle before the test tears down its temp home.
    await vi.waitFor(() => {
      expect(getCodeAgentRunRecord(resumeRun.id)?.status).toBe("completed");
      expect(getCodeAgentRunRecord(retryRun.id)?.status).toBe("completed");
    });
  });
});

describe("Code Agent run store durability", () => {
  it("keeps the previous run record when atomic replacement fails", () => {
    useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Original title",
      cwd: "/repo",
    });
    const original = getCodeAgentRunRecord(run.id);
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("rename failed");
    });

    expect(() =>
      updateCodeAgentRunRecord(run.id, { title: "Replacement title" }),
    ).toThrow("rename failed");

    expect(getCodeAgentRunRecord(run.id)).toEqual(original);
    expect(
      fs
        .readdirSync(
          path.join(process.env.AGENT_NATIVE_CODE_AGENTS_HOME!, "runs"),
        )
        .filter((file) => file.includes(".tmp-")),
    ).toEqual([]);
    rename.mockRestore();
  });

  it("returns the original event when a stable event id is retried", () => {
    useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Idempotent transcript",
      cwd: "/repo",
    });
    const first = appendCodeAgentTranscriptEvent({
      id: "participant-a-event-1",
      runId: run.id,
      kind: "status",
      message: "First delivery",
      createdAt: "2026-07-19T12:00:00.000Z",
    });
    const retried = appendCodeAgentTranscriptEvent({
      id: "participant-a-event-1",
      runId: run.id,
      kind: "status",
      message: "Conflicting retry payload is ignored",
      createdAt: "2026-07-19T12:01:00.000Z",
    });

    expect(retried).toEqual(first);
    expect(listCodeAgentTranscriptEvents(run.id)).toEqual([first]);
  });
  it("arbitrates concurrent processes for run updates and transcript journals", async () => {
    const root = useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Cross-process run",
      cwd: "/repo",
    });
    const frontier = createMultiFrontierRun({
      collaborationId: "cross-process-frontier",
      phase: "implementing",
      participants: [
        {
          participantId: "codex",
          provider: "openai",
          runtime: "codex",
          role: "driver",
          permission: "workspace_write",
          status: "running",
        },
      ],
    });
    activateStoredMultiFrontierDriver(frontier.collaborationId, "codex");

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runConcurrencyWorker(root, "code-update", run.id, `worker-${index}`),
      ),
    );
    expect(getCodeAgentRunRecord(run.id)?.metadata).toMatchObject(
      Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [`worker-${index}`, true]),
      ),
    );

    await Promise.all([
      runConcurrencyWorker(root, "code-event", run.id, "same-code-event"),
      runConcurrencyWorker(root, "code-event", run.id, "same-code-event"),
      runConcurrencyWorker(
        root,
        "multi-event",
        frontier.collaborationId,
        "same-frontier-event",
      ),
      runConcurrencyWorker(
        root,
        "multi-event",
        frontier.collaborationId,
        "same-frontier-event",
      ),
    ]);

    expect(listCodeAgentTranscriptEvents(run.id)).toHaveLength(1);
    expect(
      listMultiFrontierParticipantEvents(frontier.collaborationId),
    ).toHaveLength(1);

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runConcurrencyWorker(root, "allowlist", run.id, `command-${index}`),
      ),
    );
    addCodeAgentCommandToAllowlist("command-0");
    expect(readCodeAgentCommandAllowlist().sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `command-${index}`).sort(),
    );
  });
});

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-runs-"));
  tmpRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = root;
  return root;
}

function runConcurrencyWorker(
  root: string,
  operation: string,
  runId: string,
  value: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", concurrencyWorker, operation, runId, value],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AGENT_NATIVE_CODE_AGENTS_HOME: root,
        },
        stdio: "pipe",
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(stderr || `Concurrency worker exited with ${code}.`));
    });
  });
}
