import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  codeAgentRunArtifactsDir,
  codeAgentRunTranscriptPath,
  createCodeAgentRunRecord,
  getCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
} from "./code-agent-runs.js";

const tmpRoots: string[] = [];

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

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-runs-"));
  tmpRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = root;
  return root;
}
