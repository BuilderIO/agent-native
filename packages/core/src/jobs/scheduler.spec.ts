import { beforeEach, describe, expect, it, vi } from "vitest";
import { processRecurringJobs } from "./scheduler.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  resourceListAllOwners: resourceListAllOwnersMock,
  resourcePut: resourcePutMock,
  resourceGet: vi.fn(),
}));

vi.mock("../resources/emitter.js", () => ({
  getResourcesEmitter: () => ({ on: vi.fn() }),
}));

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
}));

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: vi.fn(() => []),
  getOwnerActiveApiKey: vi.fn(async () => "test-api-key"),
  runAgentLoop: runAgentLoopMock,
}));

describe("processRecurringJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-1",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/daily-report.md",
        content: `---
schedule: "* * * * *"
enabled: true
createdBy: alice+jobs@agent-native.test
---

Summarize the inbox.`,
      },
    ]);
    resourcePutMock.mockResolvedValue(undefined);
    createThreadMock.mockResolvedValue({ id: "thread-1" });
    runAgentLoopMock.mockResolvedValue(undefined);
  });

  it("creates run history threads owned by the job user", async () => {
    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: {} as any,
      model: "test-model",
    });

    expect(createThreadMock).toHaveBeenCalledWith(
      "alice+jobs@agent-native.test",
      expect.objectContaining({
        title: expect.stringContaining("Job: daily-report"),
      }),
    );
  });
});
