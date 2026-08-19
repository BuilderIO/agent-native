import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCodeAgentRunRecord,
  listCodeAgentRunRecords,
  listCodeAgentTranscriptEvents,
} from "../../../core/src/cli/code-agent-runs.js";
import { DesktopCodeAgentScheduler } from "./code-agent-scheduler";

const tempRoots: string[] = [];

afterEach(() => {
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("DesktopCodeAgentScheduler", () => {
  it("queues an existing-thread schedule as a marked follow-up", async () => {
    useTempCodeAgentsHome();
    const target = createCodeAgentRunRecord({
      goalId: "task",
      title: "Review worker",
      status: "completed",
      cwd: "/tmp/review",
    });
    const starts: string[] = [];
    const scheduler = new DesktopCodeAgentScheduler({
      defaultCwd: () => "/tmp/default",
      isRunActive: () => false,
      startRun: (runId) => starts.push(runId),
    });
    const created = scheduler.create({
      name: "Review every six hours",
      prompt: "Check the latest review comments.",
      scope: "thread",
      targetRunId: target.id,
      intervalMinutes: 360,
    });
    expect(created.ok).toBe(true);

    const result = await scheduler.runNow({ scheduleId: created.schedule?.id });
    expect(result.ok).toBe(true);
    expect(starts).toEqual([target.id]);
    expect(listCodeAgentTranscriptEvents(target.id)[0].metadata).toMatchObject({
      source: "scheduled-task",
      scheduleName: "Review every six hours",
    });
    expect(
      listCodeAgentRunRecords()[0].metadata?.pendingFollowUps,
    ).toHaveLength(1);
  });

  it("starts a new thread for a global schedule", async () => {
    useTempCodeAgentsHome();
    const starts: string[] = [];
    const scheduler = new DesktopCodeAgentScheduler({
      defaultCwd: () => "/tmp/default",
      isRunActive: () => false,
      startRun: (runId) => starts.push(runId),
    });
    const created = scheduler.create({
      name: "Daily brief",
      prompt: "Summarize the repository state.",
      intervalMinutes: 1_440,
    });
    const result = await scheduler.runNow({ scheduleId: created.schedule?.id });
    expect(result.ok).toBe(true);
    const run = listCodeAgentRunRecords()[0];
    expect(starts).toEqual([run.id]);
    expect(run.metadata).toMatchObject({
      source: "scheduled-task",
      scheduleName: "Daily brief",
      startRequested: false,
    });
  });
});

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "desktop-code-agent-scheduler-"),
  );
  tempRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = root;
  return root;
}
