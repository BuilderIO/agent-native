import { beforeEach, describe, expect, it, vi } from "vitest";

const durableBackgroundEnabledMock = vi.hoisted(() => vi.fn());
const backgroundPathMock = vi.hoisted(() => vi.fn());
const fireInternalDispatchMock = vi.hoisted(() => vi.fn());

vi.mock("../agent/durable-background.js", () => ({
  AGENT_BACKGROUND_PROCESSOR_AGENT_TEAM: "agent-team",
  AGENT_BACKGROUND_PROCESSOR_FIELD: "__agentNativeProcessor",
  AGENT_TEAM_PROCESS_RUN_PATH: "/_agent-native/agent-teams/_process-run",
  dispatchPathTargetsNetlifyBackgroundFunction: (path: string) =>
    path.startsWith("/.netlify/functions/"),
  isAgentChatDurableBackgroundEnabled: durableBackgroundEnabledMock,
  resolveDurableBackgroundDispatchPath: backgroundPathMock,
}));

vi.mock("./self-dispatch.js", () => ({
  fireInternalDispatch: fireInternalDispatchMock,
}));

const { dispatchAgentTeamRun } = await import("./agent-teams-dispatch.js");

describe("dispatchAgentTeamRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    durableBackgroundEnabledMock.mockReturnValue(true);
    backgroundPathMock.mockReturnValue(
      "/.netlify/functions/server-agent-background",
    );
    fireInternalDispatchMock.mockResolvedValue(undefined);
  });

  it("waits for the Netlify background function to accept the team processor", async () => {
    const event = { request: "event" };

    await dispatchAgentTeamRun({
      event,
      taskId: "task-1",
      body: { mode: "continue", noProgressCount: 1 },
    });

    expect(fireInternalDispatchMock).toHaveBeenCalledWith({
      event,
      taskId: "task-1",
      path: "/.netlify/functions/server-agent-background",
      body: {
        mode: "continue",
        noProgressCount: 1,
        __agentNativeProcessor: "agent-team",
      },
      awaitResponse: true,
    });
  });

  it("falls back without waiting for the portable processor to finish", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fireInternalDispatchMock
      .mockRejectedValueOnce(new Error("background unavailable"))
      .mockResolvedValueOnce(undefined);

    await dispatchAgentTeamRun({ taskId: "task-2", body: { mode: "start" } });

    const fallbackCall = fireInternalDispatchMock.mock.calls[1]?.[0];
    expect(fallbackCall).toMatchObject({
      taskId: "task-2",
      path: "/_agent-native/agent-teams/_process-run",
      body: { mode: "start" },
    });
    expect(fallbackCall).not.toHaveProperty("awaitResponse");
    expect(fallbackCall).not.toHaveProperty("responseTimeoutMs");
    log.mockRestore();
  });

  it("keeps portable dispatch when durable background processing is disabled", async () => {
    durableBackgroundEnabledMock.mockReturnValue(false);

    await dispatchAgentTeamRun({ taskId: "task-3", body: { mode: "start" } });

    expect(fireInternalDispatchMock).toHaveBeenCalledWith({
      taskId: "task-3",
      path: "/_agent-native/agent-teams/_process-run",
      body: { mode: "start" },
    });
  });
});
