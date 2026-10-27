import { beforeEach, describe, expect, it, vi } from "vitest";

const { decide, findQueueField, getTask } = vi.hoisted(() => ({
  decide: vi.fn(),
  findQueueField: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock("@agent-native/core/decisions", () => ({ decide }));
vi.mock("../server/task-routing.js", () => ({
  DEFAULT_QUEUES: ["Work", "Personal", "Other"],
  findQueueField,
}));
vi.mock("../server/tasks/store.js", () => ({
  getTask,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import suggestTaskRoute from "./suggest-task-route.js";

const context = { userEmail: "alice@example.com", caller: "cli" as const };

function decision({
  choice = "queue_0",
  queueProbability = 0.95,
  queueConfidence = 0.91,
  urgentProbability = 0.88,
  includeQueueProbability = true,
  includeQueueConfidence = true,
}: {
  choice?: string;
  queueProbability?: number;
  queueConfidence?: number;
  urgentProbability?: number;
  includeQueueProbability?: boolean;
  includeQueueConfidence?: boolean;
} = {}) {
  return {
    status: "ok",
    provider: "openai",
    model: "gpt-6-luna",
    answers: {
      queue: {
        type: "choice",
        name: "queue",
        choice,
        ...(includeQueueProbability
          ? {
              probabilities: [{ value: choice, probability: queueProbability }],
            }
          : {}),
        ...(includeQueueConfidence ? { confidence: queueConfidence } : {}),
      },
      urgent: {
        type: "predicate",
        name: "urgent",
        probability: urgentProbability,
      },
    },
  };
}

describe("suggest-task-route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reports when no decision provider is configured", async () => {
    getTask.mockResolvedValue({ id: "task-1", title: "Follow up" });
    findQueueField.mockResolvedValue(null);
    decide.mockResolvedValue({
      status: "not_configured",
      reason: "missing_credentials",
      providers: ["jev", "openai"],
    });

    await expect(
      suggestTaskRoute.run({ taskId: "task-1" }, context),
    ).rejects.toThrow("No AI decision provider is configured");
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("returns a queue and urgency judgment without updating the task", async () => {
    getTask.mockResolvedValue({ id: "task-1", title: "Fix payment outage" });
    findQueueField.mockResolvedValue({
      id: "field-1",
      type: "single_select",
      config: { options: [{ id: "billing", name: "Billing" }] },
    });
    decide.mockResolvedValue(decision());

    await expect(
      suggestTaskRoute.run({ taskId: "task-1" }, context),
    ).resolves.toEqual({
      taskId: "task-1",
      queue: "Billing",
      queueProbability: 0.95,
      queueConfidence: 0.91,
      urgentProbability: 0.88,
    });
    expect(decide).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      input: [
        {
          type: "json",
          value: { task: { title: "Fix payment outage" }, queues: ["Billing"] },
        },
      ],
      questions: [
        expect.objectContaining({ type: "choice", name: "queue" }),
        expect.objectContaining({ type: "predicate", name: "urgent" }),
      ],
      options: { timeoutMs: 10_000 },
    });
    expect(getTask).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      id: "task-1",
    });
  });

  it("rejects an unknown queue rather than applying a bad result", async () => {
    getTask.mockResolvedValue({ id: "task-1", title: "Follow up" });
    findQueueField.mockResolvedValue({
      id: "field-1",
      type: "single_select",
      config: { options: [{ id: "billing", name: "Billing" }] },
    });
    decide.mockResolvedValue(
      decision({
        choice: "unknown",
        queueProbability: 0.9,
        urgentProbability: 0.2,
      }),
    );

    await expect(
      suggestTaskRoute.run({ taskId: "task-1" }, context),
    ).rejects.toThrow("unknown queue");
  });

  it("omits an unavailable queue probability instead of inventing one", async () => {
    getTask.mockResolvedValue({ id: "task-1", title: "Follow up" });
    findQueueField.mockResolvedValue(null);
    decide.mockResolvedValue(decision({ includeQueueProbability: false }));
    const result = await suggestTaskRoute.run({ taskId: "task-1" }, context);

    expect(result).not.toHaveProperty("queueProbability");
  });

  it("omits unavailable choice confidence instead of inventing it", async () => {
    getTask.mockResolvedValue({ id: "task-1", title: "Follow up" });
    findQueueField.mockResolvedValue(null);
    decide.mockResolvedValue(decision({ includeQueueConfidence: false }));
    const result = await suggestTaskRoute.run({ taskId: "task-1" }, context);

    expect(result).not.toHaveProperty("queueConfidence");
  });
});
