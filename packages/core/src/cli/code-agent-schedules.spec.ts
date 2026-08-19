import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCodeAgentAgentTools } from "./code-agent-agent-tools.js";
import {
  createCodeAgentThread,
  messageCodeAgentThread,
} from "./code-agent-collaboration.js";
import {
  createCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
} from "./code-agent-runs.js";
import {
  createCodeAgentSchedule,
  deleteCodeAgentSchedule,
  getCodeAgentSchedule,
  isCodeAgentScheduleDue,
  listCodeAgentSchedules,
  nextCodeAgentScheduleRunAt,
  updateCodeAgentSchedule,
} from "./code-agent-schedules.js";

const tempRoots: string[] = [];

afterEach(() => {
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("local code-agent schedules", () => {
  it("persists interval schedules and advances the next occurrence", () => {
    useTempCodeAgentsHome();
    const now = new Date("2026-08-19T00:00:00.000Z");
    const schedule = createCodeAgentSchedule({
      name: "Review updates",
      prompt: "Check the latest changes and report blockers.",
      intervalMinutes: 360,
      now,
    });

    expect(schedule.scope).toBe("global");
    expect(schedule.nextRunAt).toBe("2026-08-19T06:00:00.000Z");
    expect(listCodeAgentSchedules()).toEqual([schedule]);
    expect(
      isCodeAgentScheduleDue(schedule, new Date("2026-08-19T05:59:59Z")),
    ).toBe(false);
    expect(
      isCodeAgentScheduleDue(schedule, new Date("2026-08-19T06:00:00Z")),
    ).toBe(true);
    expect(
      nextCodeAgentScheduleRunAt(schedule, new Date("2026-08-19T06:01:00Z")),
    ).toBe("2026-08-19T12:00:00.000Z");

    const updated = updateCodeAgentSchedule(schedule.id, {
      enabled: false,
      intervalMinutes: 720,
    });
    expect(updated?.enabled).toBe(false);
    expect(updated?.intervalMinutes).toBe(720);
    expect(getCodeAgentSchedule(schedule.id)?.enabled).toBe(false);
    expect(deleteCodeAgentSchedule(schedule.id)).toBe(true);
    expect(getCodeAgentSchedule(schedule.id)).toBeNull();
  });

  it("supports an existing-thread schedule target", () => {
    useTempCodeAgentsHome();
    const target = createCodeAgentRunRecord({
      goalId: "task",
      title: "Dispatch follow-up",
      cwd: "/tmp/dispatch",
    });
    const schedule = createCodeAgentSchedule({
      name: "Wake Dispatch",
      prompt: "Check for new review feedback.",
      scope: "thread",
      targetRunId: target.id,
      intervalMinutes: 60,
    });
    expect(schedule.scope).toBe("thread");
    expect(schedule.targetRunId).toBe(target.id);
  });
});

describe("agent collaboration tools", () => {
  it("creates a peer thread and leaves a source-marked message", async () => {
    useTempCodeAgentsHome();
    const source = createCodeAgentRunRecord({
      goalId: "task",
      title: "Coordinator",
      cwd: "/tmp/coordinator",
    });
    const created = createCodeAgentThread({
      title: "Review worker",
      prompt: "Review the current Dispatch changes.",
      cwd: "/tmp/review",
      sourceRunId: source.id,
      sourceRunTitle: source.title,
    });
    const message = messageCodeAgentThread({
      targetRunId: created.run.id,
      prompt: "Send me a concise status update when you finish.",
      sourceRunId: source.id,
      sourceRunTitle: source.title,
    });
    expect(message.event.metadata).toMatchObject({
      source: "agent",
      sourceRunId: source.id,
      sourceRunTitle: source.title,
    });
    expect(created.run.metadata).toMatchObject({
      createdByAgent: true,
      startRequested: true,
    });
    expect(listCodeAgentTranscriptEvents(created.run.id)).toHaveLength(2);
    expect(
      (listCodeAgentTranscriptEvents(created.run.id)[1].metadata ?? {}).source,
    ).toBe("agent");

    const tools = createCodeAgentAgentTools(
      source.id,
      source.cwd,
      source.title,
    );
    const result = await tools["manage-schedules"].run({
      action: "create",
      name: "Six hour check",
      prompt: "Check the thread.",
      intervalMinutes: 360,
    });
    expect(JSON.parse(result)).toMatchObject({
      ok: true,
      schedule: { intervalMinutes: 360 },
    });
  });
});

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-schedules-"));
  tempRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = root;
  return root;
}
