import { beforeEach, describe, expect, it, vi } from "vitest";

const callAgentMock = vi.hoisted(() => vi.fn());
const insertA2AContinuationMock = vi.hoisted(() => vi.fn());
const dispatchA2AContinuationMock = vi.hoisted(() => vi.fn());

vi.mock("../server/agent-discovery.js", () => ({
  findAgent: vi.fn(async () => ({
    name: "Slides",
    url: "https://slides.agent-native.test",
  })),
  discoverAgents: vi.fn(async () => []),
}));

vi.mock("../a2a/client.js", () => ({
  A2ATaskTimeoutError: class A2ATaskTimeoutError extends Error {
    taskId: string;
    constructor(taskId: string) {
      super(`A2A task ${taskId} did not complete within 18000ms`);
      this.name = "A2ATaskTimeoutError";
      this.taskId = taskId;
    }
  },
  A2AClient: class A2AClient {},
  callAgent: callAgentMock,
  signA2AToken: vi.fn(async () => "signed-token"),
}));

vi.mock("../org/context.js", () => ({
  getOrgDomain: vi.fn(async () => "builder.io"),
  getOrgA2ASecret: vi.fn(async () => "org-secret"),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestUserEmail: () => "alice+qa@agent-native.test",
  getRequestOrgId: () => "org-qa",
  isIntegrationCallerRequest: () => true,
  getIntegrationRequestContext: () => ({
    taskId: "integration-task-1",
    attempts: 1,
    incoming: {
      platform: "slack",
      externalThreadId: "C123:123.456",
      text: "make a deck",
      platformContext: {},
      timestamp: 123,
    },
    placeholderRef: "placeholder-1",
  }),
}));

vi.mock("../integrations/a2a-continuations-store.js", () => ({
  insertA2AContinuation: insertA2AContinuationMock,
  getA2AContinuationsForIntegrationTaskAgent: vi.fn(async () => []),
}));

vi.mock("../integrations/a2a-continuation-processor.js", () => ({
  dispatchA2AContinuation: dispatchA2AContinuationMock,
}));

describe("call-agent action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NETLIFY;
    insertA2AContinuationMock.mockResolvedValue({ id: "cont-1" });
    dispatchA2AContinuationMock.mockResolvedValue(undefined);
  });

  it("queues an integration continuation for structurally equivalent timeout errors", async () => {
    process.env.NETLIFY = "true";
    const timeout = Object.assign(
      new Error(
        "A2A task remote-task-1 did not complete within 18000ms (last state: processing)",
      ),
      {
        name: "A2ATaskTimeoutError",
        taskId: "remote-task-1",
      },
    );
    callAgentMock.mockRejectedValueOnce(timeout);
    const { run } = await import("./call-agent.js");

    const result = await run(
      { agent: "slides", message: "create the QA deck" },
      { send: vi.fn() } as any,
    );

    expect(result).toContain("[agent-native:a2a-continuation-queued]");
    expect(insertA2AContinuationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationTaskId: "integration-task-1",
        agentName: "Slides",
        agentUrl: "https://slides.agent-native.test",
        a2aTaskId: "remote-task-1",
        dedupeKey: expect.any(String),
      }),
    );
    expect(dispatchA2AContinuationMock).toHaveBeenCalledWith("cont-1");
  });
});
