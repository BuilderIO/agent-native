import { beforeEach, describe, expect, it, vi } from "vitest";

const readProviderConnectionsMock = vi.hoisted(() => vi.fn());
const resolveWorkspaceConnectionMock = vi.hoisted(() => vi.fn());
const readAppStateMock = vi.hoisted(() => vi.fn());
const recordTripwireMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", async (importActual) => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  const actual =
    await importActual<typeof import("@agent-native/core/action")>();
  return {
    ...kit.actionModule,
    AgentConnectionRequiredError: actual.AgentConnectionRequiredError,
  };
});
vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: readAppStateMock,
}));
vi.mock("../server/tripwire/index.js", async (importActual) => ({
  ...(await importActual<typeof import("../server/tripwire/index.js")>()),
  recordTripwire: recordTripwireMock,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionForApp: resolveWorkspaceConnectionMock,
}));
vi.mock("../server/lib/require-workspace-member.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.memberModule;
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.factoryDefinitionsModule;
});
vi.mock("../server/lib/provider-api.js", () => ({ FACTORY_APP_ID: "factory" }));
vi.mock(
  "../server/lib/factory-workflow-connections.js",
  async (importActual) => ({
    ...(await importActual<
      typeof import("../server/lib/factory-workflow-connections.js")
    >()),
    readProviderConnections: readProviderConnectionsMock,
  }),
);

import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import requestConnection from "./request-workflow-connection.js";

const run = kit.runOf(requestConnection);

function report(
  provider: string,
  status: "connected" | "not connected" | "unknown",
  connectWith:
    | "workspace-connection"
    | "vault"
    | "settings" = "workspace-connection",
) {
  readProviderConnectionsMock.mockResolvedValue([
    {
      provider,
      status,
      connectWith,
      ...(status === "unknown" ? { detail: "vault down" } : {}),
    },
  ]);
}

async function thrownBy(call: () => Promise<unknown>) {
  try {
    await call();
  } catch (error) {
    return error as Error & Record<string, unknown>;
  }
  throw new Error("Expected the call to throw.");
}

beforeEach(() => {
  readAppStateMock.mockReset();
  recordTripwireMock.mockReset();
  readProviderConnectionsMock.mockReset();
  resolveWorkspaceConnectionMock.mockReset();
  resolveWorkspaceConnectionMock.mockResolvedValue({
    available: false,
    connection: null,
    appAccess: null,
    reason: "none",
  });
});

describe("request-workflow-connection", () => {
  it("raises the chat connect request for a provider in the workspace catalog", async () => {
    report("slack", "not connected");

    const error = await thrownBy(() =>
      run({ provider: "slack" }, kit.agentContext),
    );

    expect(error).toMatchObject({
      agentConnectionRequired: true,
      errorCode: "connection_required",
      provider: "slack",
      reason: "connect",
      appId: "factory",
      source: { id: "slack", kind: "workspace_connection", label: "Slack" },
    });
    expect(error.message).toContain("Slack is not connected");
  });

  it("asks for a grant when the workspace has the connection but Factory cannot use it", async () => {
    report("github", "not connected");
    resolveWorkspaceConnectionMock.mockResolvedValue({
      available: false,
      connection: { status: "connected" },
      appAccess: { available: false },
      reason: "not granted",
    });

    const error = await thrownBy(() =>
      run({ provider: "github" }, kit.agentContext),
    );

    expect(error).toMatchObject({ provider: "github", reason: "grant" });
  });

  it("names where to add a provider the card cannot connect, with its key names", async () => {
    report("gong", "not connected", "vault");

    const result = await run({ provider: "gong" }, kit.agentContext);

    expect(result).toMatchObject({
      provider: "gong",
      connected: false,
      connectWith: "vault",
      where: "Settings, API keys",
      keys: ["GONG_ACCESS_KEY and GONG_ACCESS_SECRET"],
    });
    expect(resolveWorkspaceConnectionMock).not.toHaveBeenCalled();
  });

  it("says a connected provider is connected, and fails loudly for one it cannot check or does not know", async () => {
    report("slack", "connected");
    expect(await run({ provider: "slack" }, kit.agentContext)).toMatchObject({
      provider: "slack",
      connected: true,
    });

    report("slack", "unknown");
    expect(
      await kit.failureOf(() => run({ provider: "slack" }, kit.agentContext)),
    ).toMatchObject({ errorCode: "connection_check_failed", statusCode: 502 });

    expect(
      await kit.failureOf(() => run({ provider: "myspace" }, kit.agentContext)),
    ).toMatchObject({ errorCode: "unknown_provider", statusCode: 404 });
  });
});

describe("request-workflow-connection: a slow check", () => {
  it("the card still raises", async () => {
    report("slack", "not connected");
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000).mockReturnValue(12_000);

    const error = await thrownBy(() =>
      run({ provider: "slack" }, kit.agentContext),
    );
    now.mockRestore();

    expect(error).toMatchObject({
      agentConnectionRequired: true,
      provider: "slack",
    });
  });
});
