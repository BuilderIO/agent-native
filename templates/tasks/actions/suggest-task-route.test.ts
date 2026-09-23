import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOwnerJevApiKey, findQueueField, getTask } = vi.hoisted(() => ({
  getOwnerJevApiKey: vi.fn(),
  findQueueField: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({ getOwnerJevApiKey }));
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
const fetchMock = vi.fn();

describe("suggest-task-route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("does not contact Jev without a key", async () => {
    getTask.mockResolvedValue({ id: "task-1", title: "Follow up" });
    findQueueField.mockResolvedValue(null);
    getOwnerJevApiKey.mockResolvedValue(undefined);

    await expect(
      suggestTaskRoute.run({ taskId: "task-1" }, context),
    ).rejects.toThrow("Connect a Jev API key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a queue and urgency judgment without updating the task", async () => {
    getTask.mockResolvedValue({ id: "task-1", title: "Fix payment outage" });
    findQueueField.mockResolvedValue({
      id: "field-1",
      type: "single_select",
      config: { options: [{ id: "billing", name: "Billing" }] },
    });
    getOwnerJevApiKey.mockResolvedValue("test-key");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        answers: {
          queue: {
            choice: "queue_0",
            confidence: 0.9,
            probabilities: { queue_0: 0.95, none: 0.05 },
          },
          urgent: { noul: 0.88 },
        },
      }),
    });

    await expect(
      suggestTaskRoute.run({ taskId: "task-1" }, context),
    ).resolves.toEqual({
      taskId: "task-1",
      queue: "Billing",
      queueProbability: 0.95,
      queueConfidence: 0.9,
      urgentProbability: 0.88,
    });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(JSON.parse(request.body)).toMatchObject({
      model: "jev-latest",
      state: { task: { title: "Fix payment outage" } },
      questions: { queue: { type: "choice" }, urgent: { type: "noul" } },
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
    getOwnerJevApiKey.mockResolvedValue("test-key");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        answers: {
          queue: {
            choice: "unknown",
            confidence: 0.9,
            probabilities: { unknown: 0.9 },
          },
          urgent: { noul: 0.2 },
        },
      }),
    });

    await expect(
      suggestTaskRoute.run({ taskId: "task-1" }, context),
    ).rejects.toThrow("unknown queue");
  });
});
