import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractA2APersistedMutationReceipts,
  stripA2APersistedArtifactMarkers,
} from "../../../../core/src/a2a/artifact-response.js";

const mocks = vi.hoisted(() => ({
  discoverAgents: vi.fn(),
  getBuiltinAgents: vi.fn(() => []),
  listWorkspaceApps: vi.fn(),
  getUserSetting: vi.fn(),
  getOrgSetting: vi.fn(),
  createEmbedSessionTicket: vi.fn(),
  buildEmbedStartPath: vi.fn((ticket: string) => {
    return `/_agent-native/embed/start?ticket=${encodeURIComponent(ticket)}`;
  }),
  managerStart: vi.fn(),
  managerStop: vi.fn(),
  managerCallTool: vi.fn(),
  managerConstructor: vi.fn(),
  a2aConstructor: vi.fn(),
  a2aSend: vi.fn(),
  a2aGetTask: vi.fn(),
  signA2AToken: vi.fn(),
  canonicalA2AAudience: vi.fn((url: string) => url.replace(/\/+$/, "")),
  getOrgA2ASecret: vi.fn(),
  getOrgDomain: vi.fn(),
  isFeatureFlagEnabled: vi.fn(),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverAgents: mocks.discoverAgents,
  getBuiltinAgents: mocks.getBuiltinAgents,
}));

vi.mock("./app-creation-store.js", () => ({
  listWorkspaceApps: mocks.listWorkspaceApps,
}));

vi.mock("@agent-native/core/feature-flags", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/feature-flags")>();
  return {
    ...actual,
    isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
  };
});

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  getOrgSetting: mocks.getOrgSetting,
  putUserSetting: vi.fn(),
  putOrgSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    createEmbedSessionTicket: mocks.createEmbedSessionTicket,
    buildEmbedStartPath: mocks.buildEmbedStartPath,
  };
});

vi.mock("@agent-native/core/a2a", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/a2a")>();
  return {
    ...actual,
    extractA2APersistedMutationReceipts,
    stripA2APersistedArtifactMarkers,
    A2AClient: class MockA2AClient {
      constructor(...args: unknown[]) {
        mocks.a2aConstructor(...args);
      }

      send(...args: unknown[]) {
        return mocks.a2aSend(...args);
      }

      getTask(...args: unknown[]) {
        return mocks.a2aGetTask(...args);
      }
    },
    signA2AToken: mocks.signA2AToken,
    canonicalA2AAudience: mocks.canonicalA2AAudience,
  };
});

vi.mock("@agent-native/core/org", () => ({
  getOrgA2ASecret: mocks.getOrgA2ASecret,
  getOrgDomain: mocks.getOrgDomain,
}));

vi.mock("@agent-native/core/mcp-client", () => ({
  buildMcpToolName: (serverId: string, toolName: string) =>
    `mcp__${serverId}__${toolName}`,
  McpClientManager: class MockMcpClientManager {
    constructor(config: unknown) {
      mocks.managerConstructor(config);
    }

    start() {
      return mocks.managerStart();
    }

    stop() {
      return mocks.managerStop();
    }

    callTool(name: string, args: unknown) {
      return mocks.managerCallTool(name, args);
    }
  },
}));

import { runWithRequestContext } from "@agent-native/core/server";

import {
  createGrantedDispatchMcpEmbedSession,
  createWorkspaceSsoEmbedSession,
  askGrantedDispatchMcpApp,
  getGrantedDispatchMcpAppTask,
  listGrantedDispatchMcpApps,
  listGrantedDispatchMcpAppOrigins,
  openGrantedDispatchMcpApp,
  resolveGrantedDispatchMcpApp,
} from "./mcp-gateway.js";

const analyticsAgent = {
  id: "analytics",
  name: "Analytics",
  description: "Dashboards and metrics",
  url: "http://localhost:8086",
  color: "#6366F1",
};

function withSignedMutationReceipts(
  text: string,
  receipts: unknown[],
  secret: string,
  delegatedTaskId: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      identities: [],
      mutationReceipts: receipts,
      delegatedTaskId,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${text}\n\n<!-- agent-native:persisted-artifacts=${payload}.${signature} -->`;
}

beforeEach(() => {
  mocks.a2aConstructor.mockReset();
  mocks.a2aSend.mockReset();
  mocks.a2aGetTask.mockReset();
  mocks.signA2AToken.mockReset();
  mocks.discoverAgents.mockResolvedValue([analyticsAgent]);
  mocks.getBuiltinAgents.mockReturnValue([]);
  mocks.listWorkspaceApps.mockResolvedValue([]);
  mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });
  mocks.getOrgSetting.mockResolvedValue({ mode: "all-apps" });
  mocks.createEmbedSessionTicket.mockResolvedValue({
    ticket: "ticket-123",
    ticketHash: "hash-123",
    expiresAt: 12345,
  });
  mocks.managerStart.mockResolvedValue(undefined);
  mocks.managerStop.mockResolvedValue(undefined);
  mocks.managerCallTool.mockResolvedValue({
    structuredContent: {
      startUrl: "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    },
  });
  mocks.a2aSend.mockResolvedValue({
    id: "task-1",
    status: {
      state: "completed",
      message: {
        role: "agent",
        parts: [{ type: "text", text: "Created the requested dashboard." }],
      },
    },
  });
  mocks.signA2AToken.mockResolvedValue("signed-token");
  mocks.getOrgA2ASecret.mockResolvedValue(null);
  mocks.getOrgDomain.mockResolvedValue(null);
  mocks.isFeatureFlagEnabled.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Dispatch MCP gateway app discovery", () => {
  it("defaults to exposing every discovered app", async () => {
    mocks.getUserSetting.mockResolvedValue(null);
    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "analytics"]);
  });

  it("includes Dispatch itself so agents can target extension routes", async () => {
    mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });
    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "analytics"]);
    expect(apps[0]).toMatchObject({
      id: "dispatch",
      name: "Dispatch",
      url: "http://localhost:8092",
      granted: true,
    });
  });

  it("honors selected app grants for the Dispatch self target", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });

    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch"]);
  });

  it("returns deduped origins for granted Dispatch MCP apps only", async () => {
    mocks.discoverAgents.mockResolvedValue([
      analyticsAgent,
      {
        ...analyticsAgent,
        id: "analytics-copy",
        name: "Analytics Copy",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Mail",
        url: "https://mail.agent-native.com/inbox",
        color: "#2563EB",
      },
      {
        id: "bad-url",
        name: "Bad URL",
        description: "Invalid manifest URL",
        url: "mail.agent-native.com",
        color: "#111827",
      },
      {
        id: "file-url",
        name: "File URL",
        description: "Unsupported manifest URL scheme",
        url: "file:///tmp/app",
        color: "#111827",
      },
    ]);
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch", "analytics", "mail", "bad-url", "file-url"],
    });

    const origins = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpAppOrigins(),
    );
    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(origins).toEqual([
      "http://localhost:8092",
      "http://localhost:8086",
      "https://mail.agent-native.com",
    ]);
    expect(apps.map((app) => app.id)).toEqual([
      "dispatch",
      "analytics",
      "mail",
    ]);
  });

  it("rejects malformed granted app URLs before routing MCP actions", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "bad-url",
        name: "Bad URL",
        description: "Invalid manifest URL",
        url: "mail.agent-native.com",
        color: "#111827",
      },
    ]);
    mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () => resolveGrantedDispatchMcpApp("bad-url"),
      ),
    ).rejects.toThrow(/invalid URL/);
  });
});

describe("askGrantedDispatchMcpApp", () => {
  it("routes the authenticated user and active org identity to the granted app", async () => {
    mocks.getOrgSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["analytics"],
    });
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp(
          "analytics",
          "Build a weekly active users dashboard.",
        ),
    );

    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      "http://localhost:8086",
      "signed-token",
      { requestTimeoutMs: 10_000 },
    );
    expect(mocks.a2aSend).toHaveBeenCalledWith(
      {
        role: "user",
        parts: [
          { type: "text", text: "Build a weekly active users dashboard." },
        ],
      },
      {
        async: true,
        metadata: {
          userEmail: "owner@example.test",
          orgDomain: "builder.io",
          requestOrigin: "http://localhost:8092",
        },
      },
    );
    expect(result).toMatchObject({
      app: "analytics",
      routedVia: "a2a",
      response: "Created the requested dashboard.",
      taskId: "task-1",
      status: "completed",
    });
  });

  it("preserves authenticated structured mutation receipts from the target app", async () => {
    const orgSecret = "org-receipt-secret";
    mocks.getOrgA2ASecret.mockResolvedValueOnce(orgSecret);
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    const receipt = {
      receiptId: "receipt-row-1",
      sourceAction: "upsert-database-item-by-key",
      operation: "upsert",
      outcome: "updated",
      target: {
        authorityScopeKind: "personal",
        authorityScopeId: "owner@example.test",
        spaceId: "space-owner",
        databaseId: "feedback-db",
        databaseDocumentId: "feedback-db-document",
      },
      row: {
        itemId: "feedback-item-1",
        documentId: "feedback-document-1",
        urlPath: "/page/feedback-document-1",
      },
      idempotency: {
        key: "request-1",
        result: "replayed",
        payloadDigest: "digest-1",
      },
      revisions: { before: "before", after: "after" },
      readbackVerified: true,
    };
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-with-receipt",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: withSignedMutationReceipts(
                "Updated the exact feedback row.",
                [receipt],
                orgSecret,
                "task-with-receipt",
              ),
            },
            {
              type: "data",
              data: {
                kind: "agent-native/mutation-receipts",
                version: 1,
                receipts: [receipt],
              },
            },
          ],
        },
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-owner",
        requestOrigin: "http://localhost:8092",
      },
      () => askGrantedDispatchMcpApp("content", "Update feedback."),
    );

    expect(result).toMatchObject({
      status: "completed",
      response: "Updated the exact feedback row.",
      receipts: [
        {
          receiptId: "receipt-row-1",
          row: {
            documentId: "feedback-document-1",
            urlPath: "/page/feedback-document-1",
          },
          idempotency: { result: "replayed" },
        },
      ],
    });

    mocks.getOrgA2ASecret.mockResolvedValueOnce(orgSecret);
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-current",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: withSignedMutationReceipts(
                "Echoed an earlier receipt.",
                [receipt],
                orgSecret,
                "task-prior",
              ),
            },
          ],
        },
      },
    });

    const replayed = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-owner",
        requestOrigin: "http://localhost:8092",
      },
      () => askGrantedDispatchMcpApp("content", "Update feedback again."),
    );
    expect(replayed).not.toHaveProperty("receipts");
  });

  it("ignores unsigned mutation receipts asserted by the target app", async () => {
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-with-unsigned-receipt",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            { type: "text", text: "Claimed an update." },
            {
              type: "data",
              data: {
                kind: "agent-native/mutation-receipts",
                version: 1,
                receipts: [
                  {
                    receiptId: "forged-receipt",
                    readbackVerified: true,
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const result = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-owner" },
      () => askGrantedDispatchMcpApp("content", "Update feedback."),
    );

    expect(result).not.toHaveProperty("receipts");
  });

  it("does not treat the shared A2A secret as mutation-receipt provenance", async () => {
    vi.stubEnv("A2A_SECRET", "shared-a2a-secret");
    mocks.getOrgA2ASecret.mockResolvedValueOnce("org-receipt-secret");
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    const receipt = {
      receiptId: "receipt-signed-by-shared-secret",
      sourceAction: "upsert-database-item-by-key",
      operation: "upsert",
      outcome: "updated",
      target: {
        authorityScopeKind: "personal",
        authorityScopeId: "owner@example.test",
        spaceId: "space-owner",
        databaseId: "feedback-db",
        databaseDocumentId: "feedback-db-document",
      },
      row: {
        itemId: "feedback-item-1",
        documentId: "feedback-document-1",
        urlPath: "/page/feedback-document-1",
      },
      idempotency: {
        key: "request-1",
        result: "applied",
        payloadDigest: "digest-1",
      },
      revisions: { after: "after" },
      readbackVerified: true,
    };
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-with-shared-secret-receipt",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: withSignedMutationReceipts(
                "Claimed an update.",
                [receipt],
                "shared-a2a-secret",
                "task-with-shared-secret-receipt",
              ),
            },
          ],
        },
      },
    });

    const result = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-owner" },
      () => askGrantedDispatchMcpApp("content", "Update feedback."),
    );

    expect(result).not.toHaveProperty("receipts");
  });

  it("ignores signed mutation receipts outside the authenticated principal scope", async () => {
    const orgSecret = "org-receipt-secret";
    mocks.getOrgA2ASecret.mockResolvedValueOnce(orgSecret);
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    const receipt = {
      receiptId: "receipt-other-owner",
      sourceAction: "upsert-database-item-by-key",
      operation: "upsert",
      outcome: "updated",
      target: {
        authorityScopeKind: "personal",
        authorityScopeId: "other@example.test",
        spaceId: "space-other",
        databaseId: "feedback-db",
        databaseDocumentId: "feedback-db-document",
      },
      row: {
        itemId: "feedback-item-1",
        documentId: "feedback-document-1",
        urlPath: "/page/feedback-document-1",
      },
      idempotency: {
        key: "request-1",
        result: "applied",
        payloadDigest: "digest-1",
      },
      revisions: { after: "after" },
      readbackVerified: true,
    };
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-with-wrong-scope-receipt",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: withSignedMutationReceipts(
                "Claimed an update.",
                [receipt],
                orgSecret,
                "task-with-wrong-scope-receipt",
              ),
            },
          ],
        },
      },
    });

    const result = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-owner" },
      () => askGrantedDispatchMcpApp("content", "Update feedback."),
    );

    expect(result.response).toBe("Claimed an update.");
    expect(result).not.toHaveProperty("receipts");
  });

  it("returns a durable polling handle when the downstream task is still working", async () => {
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-working",
      status: { state: "working" },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Build the report.", {
          async: true,
        }),
    );

    expect(result).toEqual({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-working",
      status: "working",
      pollAfterMs: 1_500,
      poll: {
        tool: "ask_app_status",
        arguments: { app: "analytics", taskId: "task-working" },
      },
      message:
        'ask_app is still working. Call ask_app_status with taskId "task-working" to retrieve the final response.',
    });
  });

  it("counts submission and every poll against one inline deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.a2aSend.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                id: "task-deadline",
                status: { state: "working" },
              }),
            3_000,
          );
        }),
    );
    mocks.a2aGetTask.mockImplementationOnce(() => new Promise(() => undefined));

    const resultPromise = runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Build the report.", {
          maxWaitMs: 5_000,
        }),
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(resultPromise).resolves.toMatchObject({
      taskId: "task-deadline",
      status: "working",
      pollAfterMs: 1_500,
    });
    expect(Date.now()).toBe(5_000);
    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      "http://localhost:8086",
      undefined,
      { requestTimeoutMs: 5_000 },
    );
    expect(mocks.a2aGetTask).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])(
    "surfaces permanent %s status errors without waiting until the deadline",
    async (statusCode) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      mocks.a2aSend.mockResolvedValueOnce({
        id: "task-missing",
        status: { state: "working" },
      });
      mocks.a2aGetTask.mockRejectedValueOnce(
        new Error(`A2A request failed (${statusCode}): Task not found`),
      );

      const resultPromise = runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          askGrantedDispatchMcpApp("analytics", "Build the report.", {
            maxWaitMs: 20_000,
          }),
      );
      const rejection = resultPromise.catch((err) => err);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_500);

      await expect(rejection).resolves.toEqual(
        expect.objectContaining({
          message: expect.stringMatching(
            new RegExp(`${statusCode}.*not found`, "i"),
          ),
        }),
      );
      expect(Date.now()).toBe(1_500);
      expect(mocks.a2aGetTask).toHaveBeenCalledTimes(1);
    },
  );

  it("retries transient status failures within the same deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-transient",
      status: { state: "working" },
    });
    mocks.a2aGetTask
      .mockRejectedValueOnce(new Error("A2A request failed (503): retry"))
      .mockResolvedValueOnce({
        id: "task-transient",
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: [{ type: "text", text: "The report is ready." }],
          },
        },
      });

    const resultPromise = runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Build the report.", {
          maxWaitMs: 20_000,
        }),
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(resultPromise).resolves.toMatchObject({
      taskId: "task-transient",
      status: "completed",
      response: "The report is ready.",
    });
    expect(mocks.a2aGetTask).toHaveBeenCalledTimes(2);
  });

  it("returns input-required as a terminal handoff instead of a poll loop", async () => {
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-input",
      status: {
        state: "input-required",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "Which date range should I use?" }],
        },
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => askGrantedDispatchMcpApp("analytics", "Build the report."),
    );

    expect(result).toEqual({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-input",
      status: "input-required",
      response: "Which date range should I use?",
      inputRequired: "Which date range should I use?",
      message: "Which date range should I use?",
    });
    expect(mocks.a2aGetTask).not.toHaveBeenCalled();
  });

  it("polls a granted app task through the same authenticated A2A route", async () => {
    mocks.a2aGetTask.mockResolvedValueOnce({
      id: "task-working",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "The report is ready." }],
        },
      },
    });
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["analytics"],
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => getGrantedDispatchMcpAppTask("analytics", "task-working"),
    );

    expect(mocks.a2aGetTask).toHaveBeenCalledWith("task-working");
    expect(result).toEqual({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-working",
      status: "completed",
      response: "The report is ready.",
    });
  });

  it("returns a recoverable envelope when transient task status reads exhaust retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.a2aGetTask.mockRejectedValue(new TypeError("fetch failed"));

    const resultPromise = runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => getGrantedDispatchMcpAppTask("analytics", "task-unavailable"),
    );

    await vi.advanceTimersByTimeAsync(2_500);

    await expect(resultPromise).resolves.toMatchObject({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-unavailable",
      status: "unknown",
      statusRead: "unavailable",
      retryable: true,
      errorCategory: "transport",
      attempts: 4,
      pollAfterMs: 1_500,
      poll: {
        tool: "ask_app_status",
        arguments: { app: "analytics", taskId: "task-unavailable" },
      },
      message: expect.stringMatching(
        /status could not be read.*may still be running or completed.*retry.*ask_app_status.*do not resubmit ask_app/i,
      ),
    });
    expect(mocks.a2aGetTask).toHaveBeenCalledTimes(4);
    expect(mocks.a2aSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(4);
    expect(warnSpy).toHaveBeenLastCalledWith(
      "[ask_app_status] tasks/get attempt failed",
      expect.objectContaining({
        app: "analytics",
        routedVia: "a2a",
        taskId: "task-unavailable",
        originHost: "localhost:8086",
        attempt: 4,
        maxAttempts: 4,
        errorCategory: "transport",
        errorName: "TypeError",
        willRetry: false,
      }),
    );
  });

  it("does not retry permanent task status read errors", async () => {
    mocks.a2aGetTask.mockRejectedValueOnce(
      new Error("A2A request failed (404): Task not found"),
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () => getGrantedDispatchMcpAppTask("analytics", "task-missing"),
      ),
    ).rejects.toThrow(/404.*task not found/i);
    expect(mocks.a2aGetTask).toHaveBeenCalledTimes(1);
    expect(mocks.a2aSend).not.toHaveBeenCalled();
  });

  it("rejects delegation to an app outside the grant", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () => askGrantedDispatchMcpApp("analytics", "Show signups."),
      ),
    ).rejects.toThrow(/not granted/);
    expect(mocks.a2aSend).not.toHaveBeenCalled();
  });

  it("rejects polling a task for an app outside the grant", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () => getGrantedDispatchMcpAppTask("analytics", "task-working"),
      ),
    ).rejects.toThrow(/not granted/);
    expect(mocks.a2aGetTask).not.toHaveBeenCalled();
  });
});

describe("openGrantedDispatchMcpApp", () => {
  it("opens Dispatch extension routes through the Dispatch app id", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "dispatch",
          path: "/extensions/ext-1/github-stars-over-time",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(result).toEqual({
      app: "dispatch",
      path: "/extensions/ext-1/github-stars-over-time",
      url: "http://localhost:8092/extensions/ext-1/github-stars-over-time",
      embed: true,
      chrome: "minimal",
      embedStartUrl:
        "http://localhost:8092/_agent-native/embed/start?ticket=ticket-123",
      embedTargetPath: "/extensions/ext-1/github-stars-over-time",
      embedExpiresAt: 12345,
    });
  });

  it("pre-mints cross-app embed sessions for MCP app hosts", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards?range=30d",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "http://localhost:8086/dashboards?range=30d",
        chrome: "minimal",
      },
    );
    expect(result).toEqual({
      app: "analytics",
      path: "/dashboards?range=30d",
      url: "http://localhost:8086/dashboards?range=30d",
      embed: true,
      chrome: "minimal",
      embedStartUrl:
        "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    });
  });

  it("retries transient target MCP connection failures while pre-minting embeds", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.managerCallTool
      .mockRejectedValueOnce(
        new Error(
          'MCP server "target" is not connected: The server did not complete the Streamable HTTP MCP handshake.',
        ),
      )
      .mockResolvedValueOnce({
        structuredContent: {
          startUrl:
            "http://localhost:8086/_agent-native/embed/start?ticket=remote",
        },
      });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards",
          embed: true,
        }),
    );

    expect(mocks.managerConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.managerStart).toHaveBeenCalledTimes(2);
    expect(mocks.managerStop).toHaveBeenCalledTimes(2);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      app: "analytics",
      embedStartUrl:
        "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    });
    randomSpy.mockRestore();
  });

  it("returns the normal open URL when embed preminting fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.managerCallTool.mockRejectedValueOnce(
      new Error("Target app did not return an embed session."),
    );

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(result).toEqual({
      app: "analytics",
      path: "/dashboards",
      url: "http://localhost:8086/dashboards",
      embed: true,
      chrome: "minimal",
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rejects Dispatch-owned extension routes on sibling apps", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          openGrantedDispatchMcpApp({
            app: "analytics",
            path: "/extensions/ext-1/github-stars-over-time",
          }),
      ),
    ).rejects.toThrow(/belongs to Dispatch/);
  });

  it("rejects traversal that normalizes into Dispatch-owned routes on sibling apps", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          openGrantedDispatchMcpApp({
            app: "analytics",
            path: "/../dispatch/extensions/ext-1",
          }),
      ),
    ).rejects.toThrow(/safe app-relative route/);
  });
});

describe("createGrantedDispatchMcpEmbedSession", () => {
  it("mints Dispatch self embeds locally instead of recursively calling Dispatch MCP", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "dispatch",
          path: "/extensions/ext-1/github-stars-over-time",
          chrome: "minimal",
        }),
    );

    expect(mocks.createEmbedSessionTicket).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: undefined,
      targetPath: "/extensions/ext-1/github-stars-over-time",
      scope: "minimal",
    });
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
    expect(result).toEqual({
      app: "dispatch",
      startUrl:
        "http://localhost:8092/_agent-native/embed/start?ticket=ticket-123",
      targetPath: "/extensions/ext-1/github-stars-over-time",
      expiresAt: 12345,
    });
  });

  it("keeps workspace sign-in behind the rollout flag", async () => {
    mocks.isFeatureFlagEnabled.mockResolvedValueOnce(false);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "analytics",
            path: "/overview",
          }),
      ),
    ).rejects.toThrow(/not enabled/);
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });

  it("allows an exact canonical app without requiring an MCP app grant", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: [],
    });
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        url: "https://analytics.agent-native.com",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "analytics",
          path: "/overview",
          chrome: "minimal",
        }),
    );

    expect(result).toMatchObject({
      app: "analytics",
      startUrl:
        "https://analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
    });
    expect(mocks.managerConstructor).toHaveBeenCalled();
  });

  it("uses a built-in home URL when discovery returns a deep agent link", async () => {
    mocks.getBuiltinAgents.mockReturnValue([
      {
        id: "clips",
        name: "Clips",
        description: "Record and share",
        url: "https://clips.agent-native.com",
        color: "#000000",
      },
    ]);
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "clips",
        name: "Clips",
        description: "Record and share",
        url: "https://clips.agent-native.com/share/deep-link",
        color: "#000000",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://clips.agent-native.com/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "clips",
          path: "/inbox",
        }),
    );

    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "https://clips.agent-native.com/inbox",
        chrome: "full",
      },
    );
    expect(result).toMatchObject({
      app: "clips",
      startUrl:
        "https://clips.agent-native.com/_agent-native/embed/start?ticket=remote",
    });
  });

  it("uses an external agent origin as the home fallback for deep registrations", async () => {
    vi.stubEnv(
      "IDENTITY_SSO_APP_REGISTRY_JSON",
      JSON.stringify([
        {
          appId: "custom-agent",
          clientId: "custom-agent-client",
          origin: "https://custom.example.com",
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    );
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "custom-agent",
        name: "Custom agent",
        description: "Deep endpoint",
        url: "https://custom.example.com/agent/deep-link",
        color: "#000000",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://custom.example.com/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "custom-agent",
          path: "/home",
        }),
    );

    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "https://custom.example.com/home",
        chrome: "full",
      },
    );
    expect(result.app).toBe("custom-agent");
  });

  it("excludes path-mounted apps from SSO while retaining canonical apps", async () => {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://agent-workspace.builder.io");
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        url: "https://analytics.agent-native.com",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
      },
    });
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "atlas",
        name: "Atlas",
        description: "Workspace app",
        path: "/atlas",
        url: "https://agent-workspace.builder.io/atlas",
        isDispatch: false,
        audience: "internal",
        publicPaths: [],
        protectedPaths: [],
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://dispatch.agent-native.com",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "atlas",
            path: "/",
          }),
      ),
    ).rejects.toThrow(/not registered/);

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "analytics",
          path: "/overview",
        }),
    );

    expect(result.app).toBe("analytics");
    expect(mocks.managerConstructor).toHaveBeenCalled();
  });

  it("allows an exact custom registry entry and rejects an unregistered external app", async () => {
    vi.stubEnv(
      "IDENTITY_SSO_APP_REGISTRY_JSON",
      JSON.stringify([
        {
          appId: "workspace",
          clientId: "workspace-client",
          origin: "https://workspace.example.com",
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    );
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "workspace",
        name: "Workspace",
        description: "Custom workspace app",
        url: "https://workspace.example.com",
        color: "#111827",
      },
      {
        id: "unregistered",
        name: "Unregistered",
        description: "External app without registration",
        url: "https://unregistered.example.com",
        color: "#111827",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://workspace.example.com/_agent-native/embed/start?ticket=remote",
      },
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://dispatch.agent-native.com",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "workspace",
            path: "/home",
          }),
      ),
    ).resolves.toMatchObject({ app: "workspace" });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://dispatch.agent-native.com",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "unregistered",
            path: "/home",
          }),
      ),
    ).rejects.toThrow(/not registered/);
  });

  it("rejects traversal into Dispatch-owned embed routes on sibling apps", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/../dispatch/extensions/ext-1",
          }),
      ),
    ).rejects.toThrow(/safe app-relative route/);
  });

  it("resolves target-relative embed start URLs against the granted app", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl: "/_agent-native/embed/start?ticket=relative",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/overview",
          chrome: "minimal",
        }),
    );

    expect(result.startUrl).toBe(
      "http://localhost:8086/_agent-native/embed/start?ticket=relative",
    );
  });

  it("rejects cross-origin embed start URLs from a granted app", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl: "https://attacker.example/steal?ticket=remote",
      },
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/overview",
            chrome: "minimal",
          }),
      ),
    ).rejects.toThrow(/invalid embed start URL/);
  });

  it("rejects a URL that does not belong to the explicitly named app", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            url: "https://mail.example.com/inbox",
          }),
      ),
    ).rejects.toThrow(
      /Embed URL must belong to an app granted through Dispatch/,
    );
  });

  it("routes same-origin mounted app embed URLs to the mounted app", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        url: "http://localhost:8092/analytics",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "http://localhost:8092/analytics/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          url: "http://localhost:8092/analytics/dashboards?range=30d",
        }),
    );

    expect(mocks.createEmbedSessionTicket).not.toHaveBeenCalled();
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          url: "http://localhost:8092/analytics/mcp",
        }),
      },
    });
    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "http://localhost:8092/analytics/dashboards?range=30d",
        chrome: "full",
      },
    );
    expect(result).toEqual({
      app: "analytics",
      startUrl:
        "http://localhost:8092/analytics/_agent-native/embed/start?ticket=remote",
    });
  });

  it("skips malformed granted app URLs when matching embed URLs", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "bad-url",
        name: "Bad URL",
        description: "Invalid manifest URL",
        url: "mail.agent-native.com",
        color: "#111827",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Mail",
        url: "https://mail.agent-native.com",
        color: "#2563EB",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://mail.agent-native.com/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          url: "https://mail.agent-native.com/inbox",
        }),
    );

    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          url: "https://mail.agent-native.com/mcp",
        }),
      },
    });
    expect(result).toEqual({
      app: "mail",
      startUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=remote",
    });
  });

  it("uses the org A2A secret when minting cross-app MCP embed tokens", async () => {
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");

    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      "builder.io",
      "org-specific-secret",
      {
        expiresIn: "5m",
        audience: "http://localhost:8086",
        preferGlobalSecret: false,
      },
    );
  });

  it("falls back to the shared A2A secret when the target rejects org signing", async () => {
    vi.stubEnv("A2A_SECRET", "shared-secret");
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");
    mocks.signA2AToken
      .mockResolvedValueOnce("org-signed-token")
      .mockResolvedValueOnce("global-signed-token");
    mocks.managerCallTool
      .mockRejectedValueOnce(
        new Error(
          'MCP server "target" is not connected: HTTP 401 Unauthorized',
        ),
      )
      .mockResolvedValueOnce({
        structuredContent: {
          startUrl:
            "http://localhost:8086/_agent-native/embed/start?ticket=remote",
        },
      });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(result).toMatchObject({ app: "analytics" });
    expect(mocks.managerConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.managerConstructor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        servers: {
          target: expect.objectContaining({
            headers: { Authorization: "Bearer org-signed-token" },
          }),
        },
      }),
    );
    expect(mocks.managerConstructor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        servers: {
          target: expect.objectContaining({
            headers: { Authorization: "Bearer global-signed-token" },
          }),
        },
      }),
    );
    expect(mocks.signA2AToken).toHaveBeenNthCalledWith(
      2,
      "owner@example.test",
      "builder.io",
      undefined,
      {
        expiresIn: "5m",
        audience: "http://localhost:8086",
        preferGlobalSecret: true,
      },
    );
  });

  it("falls back to the shared A2A secret when no org secret is available", async () => {
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue(null);

    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      "builder.io",
      undefined,
      {
        expiresIn: "5m",
        audience: "http://localhost:8086",
        preferGlobalSecret: true,
      },
    );
  });

  it("falls back to the shared A2A secret when org signing inputs are incomplete", async () => {
    mocks.getOrgDomain.mockResolvedValue(null);
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");

    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      undefined,
      undefined,
      {
        expiresIn: "5m",
        audience: "http://localhost:8086",
        preferGlobalSecret: true,
      },
    );
  });

  it("does not retry permanent target MCP errors", async () => {
    mocks.managerCallTool.mockRejectedValueOnce(
      new Error(
        'MCP server "target" is not connected: The MCP server rejected the request.',
      ),
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/rejected the request/);
    expect(mocks.managerConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
  });

  it("does not let stop failures mask target MCP errors", async () => {
    mocks.managerCallTool.mockRejectedValueOnce(
      new Error("Target app returned a permanent auth error."),
    );
    mocks.managerStop.mockRejectedValueOnce(new Error("stop failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/permanent auth error/);
    expect(warnSpy).toHaveBeenCalledWith(
      "[dispatch] Failed to stop target MCP client:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("surfaces target MCP embed-session errors", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      isError: true,
      content: [
        {
          type: "text",
          text: "Error: create_embed_session requires an authenticated MCP caller.",
        },
      ],
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/authenticated MCP caller/);
  });
});
