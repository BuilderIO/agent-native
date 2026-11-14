import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgentChatPlugin: vi.fn((options: Record<string, unknown>) => options),
  registerAgentContextAgentFilter: vi.fn(),
  hideHostedAppsWhenOff: vi.fn(),
  listGrantedDispatchMcpApps: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  createAgentChatPlugin: mocks.createAgentChatPlugin,
  getBuilderWorkspaceUrl: () => null,
  registerAgentContextAgentFilter: mocks.registerAgentContextAgentFilter,
}));

vi.mock("../lib/hosted-apps-settings.js", () => ({
  hideHostedAppsWhenOff: mocks.hideHostedAppsWhenOff,
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: vi.fn(),
}));

vi.mock("../lib/mcp-gateway.js", () => ({
  listGrantedDispatchMcpApps: mocks.listGrantedDispatchMcpApps,
}));

vi.mock("../lib/workspace-app-action-auth.js", () => ({
  workspaceAppActionRouteAuth: { resolveCaller: vi.fn() },
  WORKSPACE_APP_CLAIM_ACTION_PATH:
    "/_agent-native/actions/claim-workspace-app-organization",
  WORKSPACE_APPS_ACTION_PATH: "/_agent-native/actions/list-workspace-apps",
}));

vi.mock("../../actions/index.js", () => ({
  dispatchActions: {},
}));

describe("Dispatch agent chat plugin", () => {
  it("opts delegated work into the durable background run contract", async () => {
    await import("./agent-chat.js");

    expect(mocks.createAgentChatPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "dispatch",
        durableBackgroundRuns: true,
        initialToolNames: expect.arrayContaining([
          "list-workspace-apps",
          "update-workspace-app-metadata",
          "list-dispatch-usage-metrics",
        ]),
        mcp: {
          appApprovalPage: true,
          readOnlyResources: true,
          taskCandidates: expect.any(Function),
          connectorCatalog: expect.arrayContaining([
            "start-workspace-app-creation",
            "list-dispatch-usage-metrics",
          ]),
        },
        actionRoutePublicPaths: [
          "/_agent-native/actions/list-workspace-apps",
          "/_agent-native/actions/claim-workspace-app-organization",
        ],
        actionRouteAuth: expect.objectContaining({
          resolveCaller: expect.any(Function),
        }),
      }),
    );
  });

  it("hides hosted apps from its own agent context through the setting", async () => {
    await import("./agent-chat.js");

    expect(mocks.registerAgentContextAgentFilter).toHaveBeenCalledWith(
      "dispatch",
      mocks.hideHostedAppsWhenOff,
    );
  });

  it("supplies only currently granted apps when open_app is callable", async () => {
    await import("./agent-chat.js");
    const options = mocks.createAgentChatPlugin.mock.calls[0]?.[0] as {
      mcp: {
        taskCandidates: (input: {
          callableActionNames: string[];
          signal: AbortSignal;
        }) => Promise<any[]>;
      };
    };
    mocks.listGrantedDispatchMcpApps.mockResolvedValue([
      { id: "alpha", name: "Alpha", description: "Research" },
    ]);
    const signal = new AbortController().signal;
    expect(
      await options.mcp.taskCandidates({ callableActionNames: [], signal }),
    ).toEqual([]);
    expect(mocks.listGrantedDispatchMcpApps).not.toHaveBeenCalled();
    const candidates = await options.mcp.taskCandidates({
      callableActionNames: ["open_app"],
      signal,
    });
    expect(candidates).toMatchObject([
      {
        id: "app:alpha",
        kind: "app",
        name: "Alpha",
        use: { type: "open_app", app: "alpha", path: "/" },
        callable: true,
      },
    ]);
    expect(mocks.listGrantedDispatchMcpApps).toHaveBeenCalledOnce();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      options.mcp.taskCandidates({
        callableActionNames: ["open_app"],
        signal: aborted.signal,
      }),
    ).rejects.toThrow();
    mocks.listGrantedDispatchMcpApps.mockRejectedValueOnce(
      new Error("grant unavailable"),
    );
    await expect(
      options.mcp.taskCandidates({ callableActionNames: ["open_app"], signal }),
    ).rejects.toThrow("grant unavailable");
  });

  it("fails explicitly when the app catalog exceeds task ranking bounds", async () => {
    await import("./agent-chat.js");
    const options = mocks.createAgentChatPlugin.mock.calls[0]?.[0] as {
      mcp: {
        taskCandidates: (input: {
          callableActionNames: string[];
          signal: AbortSignal;
        }) => Promise<any[]>;
      };
    };
    mocks.listGrantedDispatchMcpApps.mockResolvedValue(
      Array.from({ length: 129 }, (_, i) => ({
        id: `app-${i}`,
        name: "App",
        description: "",
      })),
    );
    await expect(
      options.mcp.taskCandidates({
        callableActionNames: ["open_app"],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/limit/i);
  });

  it("routes customer credit questions to the owning workspace app", async () => {
    await import("./agent-chat.js");

    const options = mocks.createAgentChatPlugin.mock.calls[0]?.[0] as {
      systemPrompt?: string;
    };
    expect(options.systemPrompt).toContain(
      "External customer, account, or company usage, credits, activity, or product data belongs to the relevant app",
    );
    expect(options.systemPrompt).toContain(
      "Do not use this action for external customer/account/company data.",
    );
  });
});
