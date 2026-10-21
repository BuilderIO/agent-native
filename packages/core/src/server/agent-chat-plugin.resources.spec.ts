import { createApp, H3Event } from "h3";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDbExec } from "../db/client.js";
import { AGENT_CHAT_THREAD_ABSENCE_HEADER } from "../shared/agent-chat.js";

const mocks = vi.hoisted(() => ({
  ensurePersonalDefaults: vi.fn(async () => undefined),
  resourceGetByPath: vi.fn(),
  resourceList: vi.fn(),
  resourceListAllOwners: vi.fn(async () => []),
  resourceListAccessible: vi.fn(),
  resourceGet: vi.fn(),
  resourcePut: vi.fn(async () => undefined),
  discoverAgents: vi.fn(async () => []),
  loadAgentsBundle: vi.fn(async () => ({
    workspaceAgentsMd: "",
    agentsMd: "",
    skills: {},
  })),
  generateSkillsPromptBlock: vi.fn(() => ""),
  getRuntimeSkillsForUser: vi.fn(),
  getEnabledSkillLabsForUser: vi.fn(),
  getSession: vi.fn(),
}));

const routeHarness = vi.hoisted(() => ({
  initPromises: [] as Promise<void>[],
}));

const threadStoreMocks = vi.hoisted(() => ({
  forkThread: vi.fn(),
  listThreads: vi.fn(),
  searchThreads: vi.fn(),
  mutateThreadQueuedMessages: vi.fn(),
  resolveThreadAccess: vi.fn(),
  updateThreadData: vi.fn(),
}));

const runStoreMocks = vi.hoisted(() => ({
  listRunsForThread: vi.fn(),
}));

const setupGateMocks = vi.hoisted(() => ({
  requireAgentChatAiSetup: vi.fn(async (..._args: unknown[]) => undefined),
}));

const handlerHarness = vi.hoisted(() => ({
  options: [] as Array<{
    actions: Record<string, unknown>;
    systemPrompt: (event: unknown) => Promise<string>;
  }>,
}));

vi.mock("../agent/production-agent.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agent/production-agent.js")>();
  return {
    ...actual,
    createProductionAgentHandler: (
      options: Parameters<typeof actual.createProductionAgentHandler>[0],
    ) => {
      handlerHarness.options.push(options as never);
      return actual.createProductionAgentHandler(options);
    },
  };
});

function runtimeSkillsFromBundle(bundle: { skills?: Record<string, any> }) {
  return Object.values(bundle.skills ?? {}).filter(
    (skill: any) => skill?.meta?.scope !== "dev",
  );
}

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? decodeURIComponent(owner.slice("__organization__:".length))
      : null,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${encodeURIComponent(orgId)}` : "__shared__",
  workspaceResourceOwner: (orgId?: string | null) =>
    orgId
      ? `__workspace__:__organization__:${encodeURIComponent(orgId)}`
      : "__workspace__",
  isWorkspaceResourceOwner: (owner: string) =>
    owner === "__workspace__" || owner.startsWith("__workspace__:"),
  ensurePersonalDefaults: (...args: any[]) =>
    mocks.ensurePersonalDefaults(...args),
  resourceGetByPath: (...args: any[]) => mocks.resourceGetByPath(...args),
  resourceList: (...args: any[]) => mocks.resourceList(...args),
  resourceListAllOwners: (...args: any[]) =>
    mocks.resourceListAllOwners(...args),
  resourceListAccessible: (...args: any[]) =>
    mocks.resourceListAccessible(...args),
  resourceGet: (...args: any[]) => mocks.resourceGet(...args),
  resourcePut: (...args: any[]) => mocks.resourcePut(...args),
}));

vi.mock("./agent-discovery.js", () => ({
  discoverAgents: (...args: any[]) => mocks.discoverAgents(...args),
}));

vi.mock("./agents-bundle.js", () => ({
  loadAgentsBundle: (...args: any[]) => mocks.loadAgentsBundle(...args),
  generateSkillsPromptBlock: (...args: any[]) =>
    mocks.generateSkillsPromptBlock(...args),
  getRuntimeSkillsForUser: (...args: any[]) =>
    mocks.getRuntimeSkillsForUser(...args),
  getEnabledSkillLabsForUser: (...args: any[]) =>
    mocks.getEnabledSkillLabsForUser(...args),
  getRuntimeSkills: (bundle: any) => runtimeSkillsFromBundle(bundle),
}));

vi.mock("./framework-request-handler.js", () => ({
  awaitBootstrap: () => Promise.resolve(),
  getH3App: (nitroApp: { h3App: ReturnType<typeof createApp> }) =>
    nitroApp.h3App,
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: (_nitroApp: unknown, initPromise: Promise<void>) => {
    routeHarness.initPromises.push(initPromise);
  },
}));

vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getSession: (...args: any[]) => mocks.getSession(...args),
}));

vi.mock("../chat-threads/store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../chat-threads/store.js")>();
  return {
    ...actual,
    forkThread: (...args: any[]) => threadStoreMocks.forkThread(...args),
    listThreads: (...args: any[]) => threadStoreMocks.listThreads(...args),
    searchThreads: (...args: any[]) => threadStoreMocks.searchThreads(...args),
    mutateThreadQueuedMessages: (...args: any[]) =>
      threadStoreMocks.mutateThreadQueuedMessages(...args),
    resolveThreadAccess: (...args: any[]) =>
      threadStoreMocks.resolveThreadAccess(...args),
    updateThreadData: (...args: any[]) =>
      threadStoreMocks.updateThreadData(...args),
  };
});

vi.mock("../agent/run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/run-store.js")>();
  return {
    ...actual,
    listRunsForThread: (...args: any[]) =>
      runStoreMocks.listRunsForThread(...args),
  };
});

vi.mock("./agent-chat-ai-setup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-chat-ai-setup.js")>()),
  requireAgentChatAiSetup: (...args: unknown[]) =>
    setupGateMocks.requireAgentChatAiSetup(...args),
}));

import {
  createAgentChatPlugin,
  loadResourcesForPrompt,
  type AgentChatPluginOptions,
} from "./agent-chat-plugin.js";
import {
  promptResourceManifestSections,
  registerPromptContextProvider,
} from "./agent-chat/prompt-resources.js";
import {
  getRequestContext,
  getRequestOrgId,
  runWithRequestContext,
} from "./request-context.js";

const resourcesById = new Map([
  [
    "instructions_guardrails",
    {
      id: "instructions_guardrails",
      path: "instructions/guardrails.md",
      owner: "__workspace__",
      mimeType: "text/markdown",
      content: "# Workspace Guardrails\n\nProtect customer data.",
    },
  ],
  [
    "shared_instructions_guardrails",
    {
      id: "shared_instructions_guardrails",
      path: "instructions/guardrails.md",
      owner: "__shared__",
      mimeType: "text/markdown",
      content: "# Organization Guardrails\n\nNarrow workspace guardrails.",
    },
  ],
  [
    "personal_instructions_guardrails",
    {
      id: "personal_instructions_guardrails",
      path: "instructions/guardrails.md",
      owner: "user@example.test",
      mimeType: "text/markdown",
      content: "# Personal Guardrails\n\nPrefer concise local overrides.",
    },
  ],
  [
    "context_brand",
    {
      id: "context_brand",
      path: "context/brand.md",
      owner: "__workspace__",
      mimeType: "text/markdown",
      content:
        "# Brand Guidelines\n\nUse direct language and keep claims grounded.",
    },
  ],
  [
    "context_messaging",
    {
      id: "context_messaging",
      path: "context/messaging.md",
      owner: "__workspace__",
      mimeType: "text/markdown",
      content:
        "---\ntitle: Messaging\ndescription: Core value props and proof points.\n---\n\n# Messaging",
    },
  ],
  [
    "skills_company_voice",
    {
      id: "skills_company_voice",
      path: "skills/company-voice/SKILL.md",
      owner: "__workspace__",
      mimeType: "text/markdown",
      content:
        "---\nname: company-voice\ndescription: Workspace voice default.\n---\n\n# Company Voice",
    },
  ],
  [
    "skills_dev_only",
    {
      id: "skills_dev_only",
      path: "skills/dev-only/SKILL.md",
      owner: "__workspace__",
      mimeType: "text/markdown",
      content:
        "---\nname: dev-only\ndescription: Development-only workflow.\nscope: dev\n---\n\n# Dev Only",
    },
  ],
  [
    "shared_skills_company_voice",
    {
      id: "shared_skills_company_voice",
      path: "skills/company-voice/SKILL.md",
      owner: "__shared__",
      mimeType: "text/markdown",
      content:
        "---\nname: company-voice\ndescription: Organization voice override.\n---\n\n# Company Voice",
    },
  ],
  [
    "personal_skills_company_voice",
    {
      id: "personal_skills_company_voice",
      path: "skills/company-voice/SKILL.md",
      owner: "user@example.test",
      mimeType: "text/markdown",
      content:
        "---\nname: company-voice\ndescription: Personal voice override.\n---\n\n# Company Voice",
    },
  ],
  [
    "lab_required_skill",
    {
      id: "lab_required_skill",
      path: "skills/lab-required/SKILL.md",
      owner: "__shared__",
      mimeType: "text/markdown",
      content:
        "---\nname: lab-required\ndescription: Requires an enabled Lab.\nrequires-lab: reports.preview\n---\n\n# Lab Required",
    },
  ],
]);

function meta(id: string) {
  const resource = resourcesById.get(id);
  if (!resource) throw new Error(`Missing test resource ${id}`);
  const { content, ...rest } = resource;
  return rest;
}

beforeEach(() => {
  vi.clearAllMocks();
  routeHarness.initPromises.length = 0;
  handlerHarness.options.length = 0;
  threadStoreMocks.mutateThreadQueuedMessages.mockReset();
  threadStoreMocks.resolveThreadAccess.mockReset();
  threadStoreMocks.updateThreadData.mockReset();
  threadStoreMocks.updateThreadData.mockResolvedValue(true);
  runStoreMocks.listRunsForThread.mockReset();
  runStoreMocks.listRunsForThread.mockResolvedValue([]);
  mocks.getSession.mockResolvedValue(null);
  mocks.loadAgentsBundle.mockResolvedValue({
    workspaceAgentsMd: "",
    agentsMd: "",
    skills: {},
  });
  mocks.generateSkillsPromptBlock.mockReturnValue("");
  mocks.getRuntimeSkillsForUser.mockImplementation(
    (bundle: { skills?: Record<string, any> }, userEmail?: string) =>
      runtimeSkillsFromBundle(bundle).filter(
        (skill: any) =>
          !skill.meta.requiresLab || userEmail === "enabled@example.test",
      ),
  );
  mocks.getEnabledSkillLabsForUser.mockResolvedValue(new Set());
  mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
    if (owner === "__workspace__" && path === "AGENTS.md") {
      return { content: "# Workspace Instructions\n\nUse global context." };
    }
    if (owner === "__shared__" && path === "AGENTS.md") {
      return {
        content: "# Organization Instructions\n\nOverride workspace defaults.",
      };
    }
    if (owner === "user@example.test" && path === "AGENTS.md") {
      return {
        content: "# Personal Instructions\n\nOverride organization defaults.",
      };
    }
    if (owner === "__shared__" && path === "LEARNINGS.md") {
      return { content: "# Learnings\n\n- Prefer concise updates." };
    }
    if (owner === "user@example.test" && path === "memory/MEMORY.md") {
      return { content: "# Memory Index\n\n" };
    }
    return null;
  });
  mocks.resourceList.mockImplementation(async (owner, prefix) => {
    if (owner === "__workspace__") {
      if (prefix === "instructions/") {
        return [meta("instructions_guardrails")];
      }
      if (prefix === "skills/") {
        return [meta("skills_company_voice"), meta("skills_dev_only")];
      }
      return [
        {
          id: "workspace_agents",
          path: "AGENTS.md",
          mimeType: "text/markdown",
          owner,
        },
        meta("instructions_guardrails"),
        meta("skills_company_voice"),
        meta("skills_dev_only"),
        meta("context_brand"),
        meta("context_messaging"),
      ];
    }
    if (owner === "user@example.test") {
      if (prefix === "instructions/") {
        return [meta("personal_instructions_guardrails")];
      }
      if (prefix === "skills/") {
        return [meta("personal_skills_company_voice")];
      }
      return [
        { id: "personal_agents", path: "AGENTS.md", mimeType: "text/markdown" },
        meta("personal_instructions_guardrails"),
        meta("personal_skills_company_voice"),
      ];
    }
    if (owner !== "__shared__") return [];
    if (prefix === "instructions/") {
      return [meta("shared_instructions_guardrails")];
    }
    if (prefix === "skills/") {
      return [meta("shared_skills_company_voice")];
    }
    return [
      { id: "shared_agents", path: "AGENTS.md", mimeType: "text/markdown" },
      meta("shared_instructions_guardrails"),
      meta("shared_skills_company_voice"),
    ];
  });
  mocks.resourceListAccessible.mockResolvedValue([
    meta("skills_company_voice"),
    meta("skills_dev_only"),
    meta("shared_skills_company_voice"),
    meta("personal_skills_company_voice"),
  ]);
  mocks.resourceGet.mockImplementation(async (id) => resourcesById.get(id));
});

describe("agent chat thread read route", () => {
  it("returns SQL lifecycle rows only after thread access and scopes them to stored run IDs", async () => {
    const h3App = await mountResourceRoutes();
    const threadId = "thread-run-lifecycle-projection";
    const thread = {
      id: threadId,
      scope: null,
      threadData: JSON.stringify({
        agentKit: {
          runs: [
            { id: "run-projected" },
            { id: "run-missing-from-sql" },
            { id: "run-projected" },
          ],
        },
      }),
      messageCount: 0,
      title: "Thread",
      preview: "",
    };
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(thread);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });
    runStoreMocks.listRunsForThread.mockResolvedValue([
      {
        id: "run-projected",
        status: "errored",
        startedAt: 1000,
        completedAt: 2000,
        errorCode: "run_timeout",
        abortReason: null,
        terminalReason: "run_timeout",
      },
    ]);

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${threadId}`,
      { userEmail: "user@example.test", orgId: "org-lifecycle" },
    );

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(threadStoreMocks.resolveThreadAccess).toHaveBeenCalledWith(
      "user@example.test",
      threadId,
      "viewer",
      expect.objectContaining({ orgId: expect.any(String) }),
    );
    expect(runStoreMocks.listRunsForThread).toHaveBeenCalledWith(threadId, {
      runIds: ["run-projected", "run-missing-from-sql"],
    });
    expect(result.runLifecycles).toEqual({
      queriedRunIds: ["run-projected", "run-missing-from-sql"],
      runs: [
        {
          id: "run-projected",
          status: "errored",
          startedAt: 1000,
          completedAt: 2000,
          errorCode: "run_timeout",
          abortReason: null,
          terminalReason: "run_timeout",
        },
      ],
    });
  });

  it("does not query lifecycle rows when the requester cannot read the thread", async () => {
    const h3App = await mountResourceRoutes();
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(null);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/threads/thread-not-readable",
      { userEmail: "user@example.test" },
    );

    expect(response.status).toBe(404);
    expect(runStoreMocks.listRunsForThread).not.toHaveBeenCalled();
  });
});

async function mountResourceRoutes(options?: {
  resolveOrgId?: (
    event: unknown,
  ) => string | null | undefined | Promise<string | null | undefined>;
}) {
  const h3App = createApp();
  createAgentChatPlugin({
    actions: () => ({}),
    a2aAgentDelegation: false,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: false },
    ...options,
  })({
    h3App,
    hooks: { hook: vi.fn() },
  });
  const initPromise = routeHarness.initPromises.at(-1);
  if (!initPromise) throw new Error("Agent chat routes did not initialize");
  await initPromise;
  return h3App;
}

// The first mount runs the plugin's one-time store migrations against the
// worker's PGlite database. That cold start costs ~25 s on a slow machine, so
// left inside the first test it uses up that test's 30 s budget. When it runs
// out, the abandoned mount keeps consuming the next tests' one-shot mocks.
beforeAll(async () => {
  await mountResourceRoutes();
}, 120_000);

async function fetchWithRequestContext(
  h3App: ReturnType<typeof createApp>,
  path: string,
  context: { userEmail?: string; orgId?: string; orgScope?: "personal" },
  init?: RequestInit,
) {
  return runWithRequestContext(context, () =>
    h3App.fetch(new Request(`http://example.test${path}`, init)),
  );
}

describe("agent chat queued-message route", () => {
  it("rejects data URL attachment references before durable queue mutation", async () => {
    const h3App = await mountResourceRoutes();
    const threadId = "thread-queued-data-url";
    threadStoreMocks.resolveThreadAccess.mockResolvedValue({
      id: threadId,
      scope: null,
    });
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${threadId}/queued`,
      { userEmail: "user@example.test" },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutation: {
            type: "append",
            message: {
              id: "queued-data-url",
              threadId,
              text: "Inspect this image",
              createdAt: new Date().toISOString(),
              requestAttachments: [
                {
                  type: "image",
                  name: "screen.png",
                  url: "data:image/png;base64,iVBORw==",
                },
              ],
            },
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid queue mutation" });
    expect(threadStoreMocks.mutateThreadQueuedMessages).not.toHaveBeenCalled();
  });

  it("accepts queued metadata when its submission receipt matches", async () => {
    const h3App = await mountResourceRoutes();
    const threadId = "thread-queued-metadata";
    const message = {
      id: "queued-metadata",
      threadId,
      text: "Continue with this context",
      createdAt: new Date().toISOString(),
      metadata: {
        "x-agent-native": {
          context: { browserTabId: "tab-queue-metadata", surface: "app" },
          smartObjects: [{ id: "object-queue-metadata", kind: "document" }],
        },
      },
    };
    const submissionPayload = {
      threadId,
      id: message.id,
      text: message.text,
      metadata: message.metadata,
    };
    threadStoreMocks.resolveThreadAccess.mockResolvedValue({
      id: threadId,
      scope: null,
    });
    threadStoreMocks.mutateThreadQueuedMessages.mockResolvedValue({
      queuedMessages: [message],
      message,
    });
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${threadId}/queued`,
      { userEmail: "user@example.test" },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutation: { type: "append", message, submissionPayload },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(threadStoreMocks.mutateThreadQueuedMessages).toHaveBeenCalledWith(
      threadId,
      expect.objectContaining({
        type: "append",
        message,
        hashInput: submissionPayload,
      }),
      expect.any(Object),
    );
  });

  it("requires AI setup before claiming a queued prompt for dispatch", async () => {
    const h3App = await mountResourceRoutes();
    const setupRequired = Object.assign(new Error("Connect AI first"), {
      statusCode: 403,
      data: { code: "AGENT_CHAT_AI_SETUP_REQUIRED" },
    });
    setupGateMocks.requireAgentChatAiSetup.mockRejectedValueOnce(setupRequired);
    threadStoreMocks.resolveThreadAccess.mockResolvedValue({
      id: "thread-claim-gate",
      scope: null,
    });
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/threads/thread-claim-gate/queued",
      { userEmail: "user@example.test" },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutation: {
            type: "claim",
            messageId: "queued-claim-gate",
            claimId: "claim-gate",
          },
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(setupGateMocks.requireAgentChatAiSetup).toHaveBeenCalledOnce();
    expect(threadStoreMocks.mutateThreadQueuedMessages).not.toHaveBeenCalled();
  });

  it("preserves confirmed personal scope for queued-message readiness", async () => {
    const h3App = await mountResourceRoutes();
    const setupRequired = Object.assign(new Error("Connect AI first"), {
      statusCode: 403,
      data: { code: "AGENT_CHAT_AI_SETUP_REQUIRED" },
    });
    let setupScope: string | undefined;
    setupGateMocks.requireAgentChatAiSetup.mockImplementationOnce(async () => {
      setupScope = getRequestContext()?.orgScope;
      throw setupRequired;
    });
    threadStoreMocks.resolveThreadAccess.mockResolvedValue({
      id: "thread-personal-queue-gate",
      scope: null,
    });
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/threads/thread-personal-queue-gate/queued",
      { userEmail: "user@example.test", orgScope: "personal" },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutation: {
            type: "claim",
            messageId: "queued-personal-claim",
            claimId: "personal-claim",
          },
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(setupScope).toBe("personal");
    expect(threadStoreMocks.mutateThreadQueuedMessages).not.toHaveBeenCalled();
  });

  it("returns a typed conflict when a claimed queue item was removed", async () => {
    const h3App = await mountResourceRoutes();
    const threadId = "thread-claim-race";
    const messageId = "queued-claim-race";
    const mutation = {
      type: "claim",
      messageId,
      claimId: "claim-race",
    };
    threadStoreMocks.resolveThreadAccess.mockResolvedValue({
      id: threadId,
      scope: null,
    });
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });
    threadStoreMocks.mutateThreadQueuedMessages.mockRejectedValueOnce(
      new Error(`Unknown queued message: ${messageId}`),
    );

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${threadId}/queued`,
      { userEmail: "user@example.test" },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mutation }),
      },
    );

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(409);
    expect(threadStoreMocks.resolveThreadAccess).toHaveBeenCalled();
    expect(responseBody).toEqual({
      error: `Unknown queued message: ${messageId}`,
      code: "queued_message_missing",
      retryable: false,
    });
    expect(threadStoreMocks.mutateThreadQueuedMessages).toHaveBeenCalledWith(
      threadId,
      mutation,
      expect.objectContaining({
        actor: expect.objectContaining({
          email: "user@example.test",
          anonymous: false,
        }),
      }),
    );
  });
});

describe("agent chat thread list route", () => {
  const summary = (id: string) => ({ id, title: id });

  async function getThreads(search: string) {
    const h3App = await mountResourceRoutes();
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });
    return fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads${search}`,
      { userEmail: "user@example.test" },
    );
  }

  beforeEach(() => {
    threadStoreMocks.listThreads.mockReset();
    threadStoreMocks.searchThreads.mockReset();
  });

  it("pages authorized rows and computes hasMore with the real store after membership removal", async () => {
    const store = await vi.importActual<
      typeof import("../chat-threads/store.js")
    >("../chat-threads/store.js");
    const { orgStore } = await import("../org/schema-store.js");
    await orgStore.ready();
    await store.ensureChatThreadTables();
    const exec = getDbExec();
    const orgId = "synthetic-chat-membership-org";
    const email = "synthetic-chat-viewer@example.test";
    const threadIds = [
      "membership-org-visible",
      "membership-org-grant",
      "membership-direct-a",
      "membership-direct-b",
    ];
    const h3App = await mountResourceRoutes({ resolveOrgId: () => orgId });
    mocks.getSession.mockResolvedValue({ email, orgId });
    threadStoreMocks.listThreads.mockImplementation(store.listThreads);
    threadStoreMocks.searchThreads.mockImplementation(store.searchThreads);
    try {
      await exec.execute({
        sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, 'Synthetic', ?, 0)",
        args: [orgId, email],
      });
      await exec.execute({
        sql: "INSERT INTO org_members (id, org_id, email, role, joined_at, federation_removal_pending_at) VALUES (?, ?, ?, 'admin', 0, 1)",
        args: [orgId, orgId, email],
      });
      for (const [index, id] of threadIds.entries()) {
        await exec.execute({
          sql: "INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, org_id, visibility) VALUES (?, ?, 'Synthetic membership plan', '', ?, 1, 0, ?, ?, ?)",
          args: [
            id,
            "synthetic-chat-owner@example.test",
            '{"content":"body-only-membership-secret"}',
            100 - index,
            orgId,
            index === 0 ? "org" : "private",
          ],
        });
        if (index > 0) {
          await exec.execute({
            sql: "INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by) VALUES (?, ?, ?, ?, 'viewer', ?)",
            args: [
              id,
              id,
              index === 1 ? "org" : "user",
              index === 1 ? orgId : email,
              email,
            ],
          });
        }
      }
      await exec.execute({
        sql: "UPDATE chat_threads SET thread_data = '{}' WHERE id IN (?, ?)",
        args: threadIds.slice(2),
      });
      const getPage = async (query: string) => {
        const response = await fetchWithRequestContext(
          h3App,
          `/_agent-native/agent-chat/threads?ownership=shared&limit=1${query}`,
          { userEmail: email, orgId },
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        return {
          ids: body.threads.map((thread: { id: string }) => thread.id),
          hasMore: body.hasMore,
        };
      };
      for (const state of ["pending", "deleted"]) {
        if (state === "deleted") {
          await exec.execute({
            sql: "DELETE FROM org_members WHERE id = ?",
            args: [orgId],
          });
        }
        expect(await getPage("")).toEqual({
          ids: [threadIds[2]],
          hasMore: true,
        });
        expect(await getPage("&offset=1")).toEqual({
          ids: [threadIds[3]],
          hasMore: false,
        });
        expect(await getPage("&q=Synthetic&offset=1")).toEqual({
          ids: [threadIds[3]],
          hasMore: false,
        });
        expect(await getPage("&q=body-only-membership-secret")).toEqual({
          ids: [],
          hasMore: false,
        });
      }
    } finally {
      for (const id of threadIds) {
        await exec.execute({
          sql: "DELETE FROM chat_thread_shares WHERE resource_id = ?",
          args: [id],
        });
        await exec.execute({
          sql: "DELETE FROM chat_threads WHERE id = ?",
          args: [id],
        });
      }
      await exec.execute({
        sql: "DELETE FROM org_members WHERE id = ?",
        args: [orgId],
      });
      await exec.execute({
        sql: "DELETE FROM organizations WHERE id = ?",
        args: [orgId],
      });
    }
  });

  it("passes ownership and offset to the store and reports hasMore from the extra row", async () => {
    threadStoreMocks.listThreads.mockResolvedValue([
      summary("a"),
      summary("b"),
      summary("c"),
    ]);

    const response = await getThreads("?ownership=shared&limit=2&offset=4");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      threads: [summary("a"), summary("b")],
      hasMore: true,
    });
    expect(threadStoreMocks.listThreads).toHaveBeenCalledWith(
      "user@example.test",
      expect.objectContaining({
        ownership: "shared",
        limit: 3,
        offset: 4,
      }),
    );
  });

  it("reports no more rows when the page is not over-full", async () => {
    threadStoreMocks.listThreads.mockResolvedValue([summary("a")]);
    const response = await getThreads("?ownership=mine&limit=2");
    expect(await response.json()).toEqual({
      threads: [summary("a")],
      hasMore: false,
    });
  });

  it("defaults to all and applies the same filter and paging to search", async () => {
    threadStoreMocks.searchThreads.mockResolvedValue([
      summary("a"),
      summary("b"),
    ]);

    const response = await getThreads(
      "?q=plan&ownership=mine&limit=1&offset=3",
    );

    expect(await response.json()).toEqual({
      threads: [summary("a")],
      hasMore: true,
    });
    expect(threadStoreMocks.searchThreads).toHaveBeenCalledWith(
      "user@example.test",
      "plan",
      2,
      expect.objectContaining({ ownership: "mine", offset: 3 }),
    );

    threadStoreMocks.listThreads.mockResolvedValue([]);
    await getThreads("");
    expect(threadStoreMocks.listThreads).toHaveBeenCalledWith(
      "user@example.test",
      expect.objectContaining({ ownership: "all", limit: 51, offset: 0 }),
    );
  });

  describe.each(["list", "search"] as const)("%s query validation", (mode) => {
    const suffix = mode === "search" ? "&q=plan" : "";

    it.each([
      ["an unknown ownership", "?ownership=everyone"],
      ["an empty ownership", "?ownership="],
      ["a whitespace ownership", "?ownership=%20"],
      ["duplicate ownership values", "?ownership=all&ownership=all"],
      ["an empty limit", "?limit="],
      ["a whitespace limit", "?limit=%20"],
      ["a negative limit", "?limit=-5"],
      ["a zero limit", "?limit=0"],
      ["a fractional limit", "?limit=1.5"],
      ["a non-numeric limit", "?limit=lots"],
      ["duplicate limit values", "?limit=1&limit=1"],
      ["an unsafe limit", "?limit=9007199254740992"],
      ["an imprecise limit", "?limit=9007199254740993"],
      ["an overflowing limit", `?limit=${"9".repeat(400)}`],
      ["an empty offset", "?offset="],
      ["a whitespace offset", "?offset=%20"],
      ["a negative offset", "?offset=-1"],
      ["a fractional offset", "?offset=1.5"],
      ["a non-numeric offset", "?offset=next"],
      ["duplicate offset values", "?offset=1&offset=1"],
      ["an unsafe offset", "?offset=9007199254740992"],
      ["an imprecise offset", "?offset=9007199254740993"],
      ["an overflowing offset", `?offset=${"9".repeat(400)}`],
    ])(
      "answers 400 for %s before calling either store",
      async (_name, search) => {
        const response = await getThreads(`${search}${suffix}`);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: search.startsWith("?ownership")
            ? "Invalid ownership filter"
            : "Invalid limit or offset",
        });
        expect(threadStoreMocks.listThreads).not.toHaveBeenCalled();
        expect(threadStoreMocks.searchThreads).not.toHaveBeenCalled();
      },
    );

    it.each(["all", "mine", "shared"] as const)(
      "preserves valid %s ownership",
      async (ownership) => {
        threadStoreMocks.listThreads.mockResolvedValue([]);
        threadStoreMocks.searchThreads.mockResolvedValue([]);
        const response = await getThreads(
          `?ownership=${ownership}&limit=2&offset=0${suffix}`,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ threads: [], hasMore: false });
        if (mode === "list") {
          expect(threadStoreMocks.listThreads).toHaveBeenCalledWith(
            "user@example.test",
            expect.objectContaining({ ownership, limit: 3, offset: 0 }),
          );
          expect(threadStoreMocks.searchThreads).not.toHaveBeenCalled();
        } else {
          expect(threadStoreMocks.searchThreads).toHaveBeenCalledWith(
            "user@example.test",
            "plan",
            3,
            expect.objectContaining({ ownership, offset: 0 }),
          );
          expect(threadStoreMocks.listThreads).not.toHaveBeenCalled();
        }
      },
    );

    it("defaults only absent parameters", async () => {
      threadStoreMocks.listThreads.mockResolvedValue([]);
      threadStoreMocks.searchThreads.mockResolvedValue([]);
      const response = await getThreads(mode === "list" ? "" : "?q=plan");
      expect(response.status).toBe(200);
      if (mode === "list") {
        expect(threadStoreMocks.listThreads).toHaveBeenCalledWith(
          "user@example.test",
          expect.objectContaining({ ownership: "all", limit: 51, offset: 0 }),
        );
      } else {
        expect(threadStoreMocks.searchThreads).toHaveBeenCalledWith(
          "user@example.test",
          "plan",
          51,
          expect.objectContaining({ ownership: "all", offset: 0 }),
        );
      }
    });

    it("accepts the largest safe offset and caps a valid safe limit above 200", async () => {
      threadStoreMocks.listThreads.mockResolvedValue([]);
      threadStoreMocks.searchThreads.mockResolvedValue([]);
      const response = await getThreads(
        `?limit=${Number.MAX_SAFE_INTEGER}&offset=${Number.MAX_SAFE_INTEGER}${suffix}`,
      );
      expect(response.status).toBe(200);
      if (mode === "list") {
        expect(threadStoreMocks.listThreads).toHaveBeenCalledWith(
          "user@example.test",
          expect.objectContaining({
            limit: 201,
            offset: Number.MAX_SAFE_INTEGER,
          }),
        );
      } else {
        expect(threadStoreMocks.searchThreads).toHaveBeenCalledWith(
          "user@example.test",
          "plan",
          201,
          expect.objectContaining({ offset: Number.MAX_SAFE_INTEGER }),
        );
      }
    });
  });

  it("caps an oversized limit at the page maximum", async () => {
    threadStoreMocks.listThreads.mockResolvedValue([]);
    await getThreads("?limit=5000");
    expect(threadStoreMocks.listThreads).toHaveBeenCalledWith(
      "user@example.test",
      expect.objectContaining({ limit: 201 }),
    );
  });
});

describe("agent chat thread save route", () => {
  const thread = {
    id: "thread-save",
    scope: null,
    threadData: JSON.stringify({ messages: [] }),
    messageCount: 0,
    title: "Thread",
    preview: "",
  };

  it("rejects invalid inner threadData JSON before saving", async () => {
    const h3App = await mountResourceRoutes();
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(thread);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${thread.id}`,
      { userEmail: "user@example.test" },
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadData: "{invalid" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid threadData JSON",
    });
    expect(threadStoreMocks.updateThreadData).not.toHaveBeenCalled();
  });

  it("rejects inline image bytes in a client snapshot before saving", async () => {
    const h3App = await mountResourceRoutes();
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(thread);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });
    const threadData = JSON.stringify({
      messages: [
        {
          message: {
            id: "inline-image-message",
            role: "user",
            content: [{ type: "text", text: "Inspect this" }],
            attachments: [
              {
                type: "image",
                name: "reference.png",
                data: "data:image/png;base64,INLINE_THREAD_SNAPSHOT_BYTES",
              },
            ],
          },
          parentId: null,
        },
      ],
    });

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${thread.id}`,
      { userEmail: "user@example.test" },
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadData, messageCount: 1 }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid threadData JSON",
      code: "inline_attachment_data_not_persistable",
      retryable: false,
    });
    expect(threadStoreMocks.updateThreadData).not.toHaveBeenCalled();
  });

  it("returns a typed error for an invalid fork snapshot", async () => {
    const h3App = await mountResourceRoutes();
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(thread);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${thread.id}/fork`,
      { userEmail: "user@example.test" },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: { threadData: "{invalid", messageCount: 1 },
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid threadData JSON",
      code: "invalid_thread_data",
      retryable: false,
    });
    expect(threadStoreMocks.forkThread).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["a JSON string", '"invalid"'],
    ["an empty body", ""],
  ])("rejects %s before reading thread fields", async (_label, body) => {
    const h3App = await mountResourceRoutes();
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(thread);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${thread.id}`,
      { userEmail: "user@example.test" },
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body,
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request body" });
    expect(threadStoreMocks.resolveThreadAccess).not.toHaveBeenCalled();
    expect(threadStoreMocks.updateThreadData).not.toHaveBeenCalled();
  });

  it.each([
    ["nonnumeric", "2"],
    ["null", null],
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ])(
    "rejects a %s message count before saving",
    async (_label, messageCount) => {
      const h3App = await mountResourceRoutes();
      threadStoreMocks.resolveThreadAccess.mockResolvedValue(thread);
      mocks.getSession.mockResolvedValue({ email: "user@example.test" });

      const response = await fetchWithRequestContext(
        h3App,
        `/_agent-native/agent-chat/threads/${thread.id}`,
        { userEmail: "user@example.test" },
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageCount }),
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request body" });
      expect(threadStoreMocks.updateThreadData).not.toHaveBeenCalled();
    },
  );

  it("preserves threadData for the metadata-only empty-string save sentinel", async () => {
    const h3App = await mountResourceRoutes();
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(thread);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${thread.id}`,
      { userEmail: "user@example.test" },
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadData: "",
          title: "New title",
          preview: "New preview",
          messageCount: 2,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(threadStoreMocks.updateThreadData).toHaveBeenCalledWith(
      thread.id,
      thread.threadData,
      "New title",
      "New preview",
      2,
      expect.objectContaining({
        preserveCurrentTitleAndPreview: false,
      }),
    );
  });

  it("preserves server metadata when saving a snapshot delta", async () => {
    const h3App = await mountResourceRoutes();
    const threadData = JSON.stringify({
      messages: [],
      agentKit: { _snapshotDelta: true, messages: [] },
    });
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(thread);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${thread.id}`,
      { userEmail: "user@example.test" },
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadData, messageCount: 0 }),
      },
    );

    expect(response.status).toBe(200);
    expect(threadStoreMocks.updateThreadData).toHaveBeenCalledWith(
      thread.id,
      threadData,
      thread.title,
      thread.preview,
      0,
      expect.objectContaining({ preserveCurrentTitleAndPreview: true }),
    );
  });

  it("returns 404 when the thread disappears before the save reaches storage", async () => {
    const h3App = await mountResourceRoutes();
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(thread);
    threadStoreMocks.updateThreadData.mockResolvedValue(false);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const response = await fetchWithRequestContext(
      h3App,
      `/_agent-native/agent-chat/threads/${thread.id}`,
      { userEmail: "user@example.test" },
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadData: JSON.stringify({ messages: [] }) }),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Thread not found" });
    expect(threadStoreMocks.updateThreadData).toHaveBeenCalledOnce();
    expect(threadStoreMocks.resolveThreadAccess).toHaveBeenCalledOnce();
  });
});

describe("agent chat unsaved thread reads", () => {
  it("answers a thread nobody has saved yet as typed absent only when the client asks", async () => {
    const h3App = await mountResourceRoutes();
    threadStoreMocks.resolveThreadAccess.mockResolvedValue(null);
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });

    const typed = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/threads/unsaved-thread",
      { userEmail: "user@example.test" },
      { headers: { [AGENT_CHAT_THREAD_ABSENCE_HEADER]: "typed" } },
    );
    expect(typed.status).toBe(200);
    expect(await typed.json()).toEqual({ absent: true });

    const plain = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/threads/unsaved-thread",
      { userEmail: "user@example.test" },
    );
    expect(plain.status).toBe(404);
  });
});

describe("agent chat resource route organization scopes", () => {
  it("prefers the most recently updated resource skill when names repeat", async () => {
    const h3App = await mountResourceRoutes();
    const candidates = [
      {
        id: "repeat_slash_skill_canonical",
        path: "skills/repeat-skill/SKILL.md",
        owner: "user@example.test",
        mimeType: "text/markdown",
        updatedAt: 1000,
        content: "---\nname: repeat-skill\ndescription: Older\n---\n# Older",
      },
      {
        id: "repeat_slash_skill_suffixed",
        path: "skills/repeat-skill-2/SKILL.md",
        owner: "user@example.test",
        mimeType: "text/markdown",
        updatedAt: 2000,
        content: "---\nname: repeat-skill\ndescription: Newest\n---\n# Newest",
      },
    ];
    for (const candidate of candidates) {
      resourcesById.set(candidate.id, candidate);
    }
    mocks.getSession.mockResolvedValue({ email: "user@example.test" } as any);
    mocks.resourceListAccessible.mockResolvedValue(
      candidates.map(({ content: _content, ...resource }) => resource),
    );

    const response = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/skills",
      { userEmail: "user@example.test" },
    );
    const result = (await response.json()) as {
      skills: Array<{
        name: string;
        description?: string;
        path: string;
        source: string;
      }>;
    };

    expect(
      result.skills.filter((skill) => skill.name === "repeat-skill"),
    ).toEqual([
      {
        name: "repeat-skill",
        description: "Newest",
        path: "skills/repeat-skill-2/SKILL.md",
        source: "resource",
      },
    ]);
  });

  it("uses the same owner and recency order as the prompt skill catalog", async () => {
    const candidates = [
      {
        id: "catalog-priority-canonical",
        path: "skills/catalog-priority/SKILL.md",
        owner: "user@example.test",
        mimeType: "text/markdown",
        updatedAt: 1000,
        content:
          "---\nname: catalog-priority\ndescription: Older canonical version.\n---\n# Older",
      },
      {
        id: "catalog-priority-suffixed",
        path: "skills/catalog-priority-2/SKILL.md",
        owner: "user@example.test",
        mimeType: "text/markdown",
        updatedAt: 2000,
        content:
          "---\nname: catalog-priority\ndescription: Newer personal version.\n---\n# Newer personal",
      },
      {
        id: "catalog-priority-organization",
        path: "skills/organization-copy/SKILL.md",
        owner: "__organization__:org-1",
        mimeType: "text/markdown",
        updatedAt: 3000,
        content:
          "---\nname: catalog-priority\ndescription: Newer organization version.\n---\n# Organization",
      },
      {
        id: "catalog-priority-shared",
        path: "skills/shared-copy/SKILL.md",
        owner: "__shared__",
        mimeType: "text/markdown",
        updatedAt: 4000,
        content:
          "---\nname: catalog-priority\ndescription: Newer shared version.\n---\n# Shared",
      },
      {
        id: "organization-priority-organization",
        path: "skills/organization-priority/SKILL.md",
        owner: "__organization__:org-1",
        mimeType: "text/markdown",
        updatedAt: 1000,
        content:
          "---\nname: organization-priority\ndescription: Organization version.\n---\n# Organization",
      },
      {
        id: "organization-priority-shared",
        path: "skills/organization-priority-shared/SKILL.md",
        owner: "__shared__",
        mimeType: "text/markdown",
        updatedAt: 4000,
        content:
          "---\nname: organization-priority\ndescription: Newer shared version.\n---\n# Shared",
      },
    ];
    for (const candidate of candidates) {
      resourcesById.set(candidate.id, candidate);
    }
    mocks.getSession.mockResolvedValue({ email: "user@example.test" } as any);
    mocks.resourceListAccessible.mockResolvedValue(
      candidates.map(({ content: _content, ...resource }) => resource),
    );
    const h3App = await mountResourceRoutes({
      resolveOrgId: () => "org-1",
    });

    const response = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/skills",
      { userEmail: "user@example.test", orgId: "org-1" },
    );
    const result = (await response.json()) as {
      skills: Array<{
        name: string;
        description?: string;
        path: string;
        source: string;
      }>;
    };

    expect(
      result.skills.filter((skill) => skill.name === "catalog-priority"),
    ).toEqual([
      {
        name: "catalog-priority",
        description: "Newer personal version.",
        path: "skills/catalog-priority-2/SKILL.md",
        source: "resource",
      },
    ]);
    expect(
      result.skills.filter((skill) => skill.name === "organization-priority"),
    ).toEqual([
      {
        name: "organization-priority",
        description: "Organization version.",
        path: "skills/organization-priority/SKILL.md",
        source: "resource",
      },
    ]);
  });

  it("keeps Lab-gated bundled skills out of the slash picker for disabled users", async () => {
    const h3App = await mountResourceRoutes();
    const creativeSkill = {
      meta: {
        name: "creative-context",
        description: "Use Creative Context packs.",
        scope: "both",
        requiresLab: "content.creative-context",
      },
      content: "# Creative Context",
      dir: ".agents/skills/creative-context",
      extraFiles: [],
      files: {},
    };
    mocks.loadAgentsBundle.mockResolvedValue({
      workspaceAgentsMd: "",
      agentsMd: "",
      skills: { "creative-context": creativeSkill },
    });
    mocks.resourceList.mockResolvedValue([]);
    mocks.resourceListAccessible.mockResolvedValue([]);

    const disabledResponse = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/skills",
      { userEmail: "disabled@example.test" },
    );
    const enabledResponse = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/skills",
      { userEmail: "enabled@example.test" },
    );
    const disabled = (await disabledResponse.json()) as {
      skills: Array<{ name: string }>;
    };
    const enabled = (await enabledResponse.json()) as {
      skills: Array<{ name: string }>;
    };

    expect(disabled.skills.map((skill) => skill.name)).not.toContain(
      "creative-context",
    );
    expect(enabled.skills.map((skill) => skill.name)).toContain(
      "creative-context",
    );
  });

  it("fails closed when Lab state for a resource skill cannot be read", async () => {
    const h3App = await mountResourceRoutes();
    mocks.getSession.mockResolvedValue({
      email: "disabled@example.test",
    } as any);
    mocks.resourceList.mockResolvedValue([meta("lab_required_skill")]);
    mocks.resourceListAccessible.mockResolvedValue([
      meta("lab_required_skill"),
    ]);

    const disabledResponse = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/skills",
      { userEmail: "disabled@example.test" },
    );
    const disabled = (await disabledResponse.json()) as {
      skills: Array<{ name: string }>;
    };
    expect(disabled.skills.map((skill) => skill.name)).not.toContain(
      "lab-required",
    );

    mocks.getEnabledSkillLabsForUser.mockRejectedValue(
      new Error("Labs settings unavailable"),
    );
    const unavailableResponse = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/skills",
      { userEmail: "disabled@example.test" },
    );

    expect(unavailableResponse.status).toBe(500);
    expect(await unavailableResponse.text()).not.toContain("Lab Required");
    expect(mocks.resourceGet).toHaveBeenCalledWith("lab_required_skill", {
      userEmail: "disabled@example.test",
      orgId: undefined,
    });
    expect(mocks.getEnabledSkillLabsForUser).toHaveBeenCalledWith(
      ["reports.preview"],
      "disabled@example.test",
    );
  });

  it("inherits the active request organization when no resolver is configured", async () => {
    const h3App = await mountResourceRoutes();
    expect(mocks.resourceListAllOwners).not.toHaveBeenCalledWith("jobs/");
    const resourceList = mocks.resourceList.getMockImplementation()!;
    const resourceListContexts: Array<{
      orgId: string | undefined;
      orgScope: "personal" | undefined;
    }> = [];
    mocks.resourceList.mockImplementation(async (...args) => {
      resourceListContexts.push({
        orgId: getRequestOrgId(),
        orgScope: getRequestContext()?.orgScope,
      });
      return resourceList(...args);
    });

    await fetchWithRequestContext(h3App, "/_agent-native/agent-chat/files", {
      userEmail: "user@example.test",
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", undefined, {
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      undefined,
      { orgId: "org-active" },
    );

    mocks.resourceList.mockClear();
    await fetchWithRequestContext(h3App, "/_agent-native/agent-chat/skills", {
      userEmail: "user@example.test",
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", "skills/", {
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      "skills/",
      { orgId: "org-active" },
    );

    mocks.resourceList.mockClear();
    resourceListContexts.length = 0;
    const mentions = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/mentions",
      { userEmail: "user@example.test", orgId: "org-active" },
    );
    await mentions.text();
    expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", undefined, {
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      undefined,
      { orgId: "org-active" },
    );
    expect(resourceListContexts).toContainEqual({
      orgId: "org-active",
      orgScope: undefined,
    });
  });

  it("reserves mention results for peer agents when files fill their source budget", async () => {
    const h3App = await mountResourceRoutes();
    const files = Array.from({ length: 80 }, (_, index) => ({
      id: `file-${index}`,
      path: `brief-${index}.md`,
      owner: "__shared__",
      mimeType: "text/markdown",
    }));
    mocks.resourceList.mockResolvedValue(files);
    mocks.resourceListAccessible.mockResolvedValue(files);
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "slides",
        name: "Slides",
        url: "https://slides.example.test",
        description: "Create presentations",
      },
    ] as never);
    const response = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/mentions",
      { userEmail: "user@example.test", orgId: "org-active" },
    );
    const items = (await response.text())
      .trim()
      .split("\n")
      .flatMap((line) => JSON.parse(line).items);
    expect(items.length).toBeLessThanOrEqual(50);
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "agent:slides",
        section: "Connected Agents",
      }),
    );
    expect(items.some((item) => item.refType === "file")).toBe(true);
  });

  it("inherits the active request organization when a resolver returns undefined", async () => {
    const h3App = await mountResourceRoutes({ resolveOrgId: () => undefined });
    const resourceList = mocks.resourceList.getMockImplementation()!;
    const resourceListContexts: Array<{
      orgId: string | undefined;
      orgScope: "personal" | undefined;
    }> = [];
    mocks.resourceList.mockImplementation(async (...args) => {
      resourceListContexts.push({
        orgId: getRequestOrgId(),
        orgScope: getRequestContext()?.orgScope,
      });
      return resourceList(...args);
    });

    const mentions = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/mentions",
      { userEmail: "user@example.test", orgId: "org-active" },
    );
    await mentions.text();

    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      undefined,
      { orgId: "org-active" },
    );
    expect(resourceListContexts).toContainEqual({
      orgId: "org-active",
      orgScope: undefined,
    });
  });

  it("passes an explicit organization resolver scope to no-owner skill reads", async () => {
    const h3App = await mountResourceRoutes({
      resolveOrgId: () => "org-resolved",
    });

    await fetchWithRequestContext(h3App, "/_agent-native/agent-chat/skills", {
      userEmail: "user@example.test",
      orgId: "org-active",
    });

    expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", "skills/", {
      orgId: "org-resolved",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      "skills/",
      { orgId: "org-resolved" },
    );
    expect(mocks.resourceGet).toHaveBeenCalledWith("skills_company_voice", {
      userEmail: undefined,
      orgId: "org-resolved",
    });
  });

  it.each([
    ["/_agent-native/agent-chat/files", undefined],
    ["/_agent-native/agent-chat/skills", "skills/"],
    ["/_agent-native/agent-chat/mentions", undefined],
  ])(
    "uses the resolver organization instead of the ambient organization for shared %s reads",
    async (path, prefix) => {
      const h3App = await mountResourceRoutes({
        resolveOrgId: () => "org-resolved",
      });

      const response = await fetchWithRequestContext(h3App, path, {
        userEmail: "user@example.test",
        orgId: "org-ambient",
      });
      if (path.endsWith("/mentions")) await response.text();

      expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", prefix, {
        orgId: "org-resolved",
      });
    },
  );

  it.each([
    ["/_agent-native/agent-chat/files", undefined],
    ["/_agent-native/agent-chat/skills", "skills/"],
    ["/_agent-native/agent-chat/mentions", undefined],
  ])(
    "preserves an explicit personal resolver scope for no-owner shared %s reads",
    async (path, prefix) => {
      const h3App = await mountResourceRoutes({ resolveOrgId: () => null });
      const resourceList = mocks.resourceList.getMockImplementation()!;
      const resourceListContexts: Array<{
        orgId: string | undefined;
        orgScope: "personal" | undefined;
      }> = [];
      mocks.resourceList.mockImplementation(async (...args) => {
        resourceListContexts.push({
          orgId: getRequestOrgId(),
          orgScope: getRequestContext()?.orgScope,
        });
        return resourceList(...args);
      });

      const response = await fetchWithRequestContext(h3App, path, {
        userEmail: "user@example.test",
        orgId: "org-ambient",
      });
      if (path.endsWith("/mentions")) await response.text();

      expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", prefix, {
        orgId: null,
      });
      if (path.endsWith("/mentions")) {
        expect(resourceListContexts).toContainEqual({
          orgId: undefined,
          orgScope: "personal",
        });
      }
    },
  );

  it("preserves an explicit personal resolver scope for owned skills and mentions", async () => {
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });
    const h3App = await mountResourceRoutes({ resolveOrgId: () => null });

    await fetchWithRequestContext(h3App, "/_agent-native/agent-chat/skills", {
      userEmail: "user@example.test",
      orgId: "org-active",
    });
    expect(mocks.resourceListAccessible).toHaveBeenCalledWith(
      "user@example.test",
      "skills/",
      { userEmail: "user@example.test", orgId: null },
    );
    expect(mocks.resourceGet).toHaveBeenCalledWith("skills_company_voice", {
      userEmail: "user@example.test",
      orgId: null,
    });

    mocks.resourceListAccessible.mockClear();
    const resourceListAccessible =
      mocks.resourceListAccessible.getMockImplementation()!;
    const resourceListAccessibleContexts: Array<{
      orgId: string | undefined;
      orgScope: "personal" | undefined;
    }> = [];
    mocks.resourceListAccessible.mockImplementation(async (...args) => {
      resourceListAccessibleContexts.push({
        orgId: getRequestOrgId(),
        orgScope: getRequestContext()?.orgScope,
      });
      return resourceListAccessible(...args);
    });
    const mentions = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/mentions",
      { userEmail: "user@example.test", orgId: "org-active" },
    );
    await mentions.text();
    expect(mocks.resourceListAccessible).toHaveBeenCalledWith(
      "user@example.test",
      undefined,
      { userEmail: "user@example.test", orgId: null },
    );
    expect(resourceListAccessibleContexts).toContainEqual({
      orgId: undefined,
      orgScope: "personal",
    });
  });

  it.each([
    "/_agent-native/agent-chat/files",
    "/_agent-native/agent-chat/skills",
    "/_agent-native/agent-chat/mentions",
  ])(
    "does not turn an organization resolver failure into a personal lookup for %s",
    async (path) => {
      const h3App = await mountResourceRoutes({
        resolveOrgId: () => {
          throw new Error("organization lookup failed");
        },
      });

      const response = await fetchWithRequestContext(h3App, path, {
        userEmail: "user@example.test",
        orgId: "org-active",
      });
      expect(response.status).toBe(500);
      expect(mocks.resourceList).not.toHaveBeenCalled();
      expect(mocks.resourceListAccessible).not.toHaveBeenCalled();
      expect(mocks.resourceGet).not.toHaveBeenCalled();
    },
  );
});

describe("promptResourceManifestSections", () => {
  it("accounts for runtime resource notes, budget notes, and available apps", () => {
    const sections = promptResourceManifestSections(`
<context-note>Personal memory remains available on demand.</context-note>
<context-budget-note>Some startup context was omitted.</context-budget-note>
<available-apps>Analytics (analytics) — Query product data.</available-apps>
`);

    expect(sections).toEqual([
      expect.objectContaining({
        label: "Resource availability note",
        provenance: "framework-core",
        governance: "required",
        content: "Personal memory remains available on demand.",
      }),
      expect.objectContaining({
        label: "Context budget note",
        provenance: "framework-core",
        governance: "required",
        content: "Some startup context was omitted.",
      }),
      expect.objectContaining({
        label: "Available workspace apps",
        provenance: "tools",
        governance: "required",
        content: "Analytics (analytics) — Query product data.",
      }),
    ]);
  });

  it("accounts for registered package context with explicit provenance", () => {
    const sections = promptResourceManifestSections(`
<prompt-context-provider id="creative-context" label="Published brand context" provenance="organization" governance="inherited" scope="org" path="context/brand-context.md">
<brand-context><color>#6633ff</color></brand-context>
</prompt-context-provider>
`);

    expect(sections).toEqual([
      expect.objectContaining({
        label: "Published brand context",
        provenance: "organization",
        governance: "inherited",
        content: "\n<brand-context><color>#6633ff</color></brand-context>\n",
        sourceRef: {
          path: "context/brand-context.md",
          scope: "org",
        },
      }),
    ]);
  });
});

describe("loadResourcesForPrompt", () => {
  it("requires approval before shared memory writes in the compact prompt", async () => {
    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt).toContain("Keep setup findings personal");
    expect(prompt).toContain(
      "shared LEARNINGS.md or organization-memory writes require approval",
    );
    expect(prompt).toContain('"Remember this" alone is not approval');
    expect(prompt).not.toContain(
      "Save durable team facts and routing conventions to shared LEARNINGS.md",
    );
  });

  it("fails the prompt build when Lab-gated skill state cannot be read", async () => {
    const failure = new Error("Labs settings unavailable");
    mocks.getRuntimeSkillsForUser.mockRejectedValueOnce(failure);

    await expect(loadResourcesForPrompt("user@example.test")).rejects.toBe(
      failure,
    );
  });

  it.each([false, true])(
    "keeps Lab-gated skills per-user in %s compact prompt mode",
    async (compact) => {
      const creativeSkill = {
        meta: {
          name: "creative-context",
          description: "Use Creative Context packs.",
          scope: "both",
          requiresLab: "content.creative-context",
        },
        content: "CREATIVE_CONTEXT_SKILL_MARKER",
        dir: ".agents/skills/creative-context",
        extraFiles: [],
        files: {},
      };
      const bundle = {
        workspaceAgentsMd: "",
        agentsMd: "",
        skills: { "creative-context": creativeSkill },
      };
      mocks.loadAgentsBundle.mockResolvedValue(bundle);
      mocks.generateSkillsPromptBlock.mockImplementation(
        (_bundle: unknown, skills: (typeof creativeSkill)[]) =>
          skills.map((skill) => skill.content).join("\n"),
      );

      const disabled = await loadResourcesForPrompt(
        "disabled@example.test",
        compact,
      );
      const enabled = await loadResourcesForPrompt(
        "enabled@example.test",
        compact,
      );

      expect(disabled).not.toContain("CREATIVE_CONTEXT_SKILL_MARKER");
      expect(disabled).not.toContain("creative-context");
      expect(enabled).toContain(
        compact ? "creative-context" : "CREATIVE_CONTEXT_SKILL_MARKER",
      );
      expect(mocks.getRuntimeSkillsForUser).toHaveBeenNthCalledWith(
        1,
        bundle,
        "disabled@example.test",
      );
      expect(mocks.getRuntimeSkillsForUser).toHaveBeenNthCalledWith(
        2,
        bundle,
        "enabled@example.test",
      );
    },
  );

  it("uses runtime-scoped instructions and excludes development instructions", async () => {
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: "",
      agentsMd: "# Legacy instructions",
      runtimeAgentsMd: "# Runtime instructions",
      developmentAgentsMd: "# Development instructions",
      skills: {},
    });

    const prompt = await loadResourcesForPrompt("user@example.test");

    expect(prompt).toContain("# Runtime instructions");
    expect(prompt).not.toContain("# Development instructions");
    expect(prompt).not.toContain("# Legacy instructions");
  });

  it("loads bounded package context providers into every prompt path", async () => {
    const unregister = registerPromptContextProvider({
      id: "creative-context-test",
      load: async (context) => ({
        label: "Published brand context",
        provenance: context.orgId ? "organization" : "personal",
        governance: "inherited",
        sourceRef: {
          path: "context/brand-context.md",
          scope: context.orgId ? "org" : "user",
        },
        content: "<brand-context><font>Inter</font></brand-context>",
      }),
    });

    try {
      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        false,
        "slides",
        "org_example",
      );
      expect(prompt).toContain(
        '<prompt-context-provider id="creative-context-test"',
      );
      expect(prompt).toContain(
        "<brand-context><font>Inter</font></brand-context>",
      );
      expect(promptResourceManifestSections(prompt)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Published brand context",
            provenance: "organization",
          }),
        ]),
      );
    } finally {
      unregister();
    }
  });

  it("surfaces failures from prompt providers that fail closed", async () => {
    const unregister = registerPromptContextProvider({
      id: "creative-context-required-test",
      failOnError: true,
      load: async () => {
        throw new Error("Labs settings unavailable");
      },
    });

    try {
      await expect(
        loadResourcesForPrompt("user@example.test", false, "slides"),
      ).rejects.toThrow("Labs settings unavailable");
    } finally {
      unregister();
    }
  });

  it("assembles the same inherited workspace context for every app without sync writes", async () => {
    const analyticsPrompt = await runWithRequestContext(
      { userEmail: "user@example.test" },
      () => loadResourcesForPrompt("user@example.test", false, "analytics"),
    );
    const mailPrompt = await runWithRequestContext(
      { userEmail: "user@example.test" },
      () => loadResourcesForPrompt("user@example.test", false, "mail"),
    );

    expect(analyticsPrompt).toBe(mailPrompt);
    expect(mocks.resourcePut).not.toHaveBeenCalled();
    expect(mocks.discoverAgents).toHaveBeenCalledWith("analytics", {
      includePersonalAgents: true,
    });
    expect(mocks.discoverAgents).toHaveBeenCalledWith("mail", {
      includePersonalAgents: true,
    });

    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      "__workspace__",
      "AGENTS.md",
      { orgId: null },
    );
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      "instructions/",
      { orgId: null },
    );
    expect(mocks.resourceListAccessible).toHaveBeenCalledWith(
      "user@example.test",
      "skills/",
      { orgId: null },
    );
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      undefined,
      {
        orgId: null,
      },
    );

    expect(analyticsPrompt).toContain(
      '<resource name="instructions/guardrails.md" scope="workspace-instruction"',
    );
    expect(analyticsPrompt).toContain(
      '`company-voice` at resource `skills/company-voice/SKILL.md` (personal) - Personal voice override. Use the `resources` tool with `action: "read"`',
    );
    expect(analyticsPrompt).toContain(
      '<workspace-resources scope="workspace">',
    );
    expect(analyticsPrompt).toContain(
      "Workspace reference resources are inherited by every app",
    );

    expect(analyticsPrompt.indexOf("Workspace Guardrails")).toBeLessThan(
      analyticsPrompt.indexOf("Organization Guardrails"),
    );
    expect(analyticsPrompt.indexOf("Organization Guardrails")).toBeLessThan(
      analyticsPrompt.indexOf("Personal Guardrails"),
    );
    expect(analyticsPrompt).not.toContain("Workspace voice default.");
    expect(analyticsPrompt).not.toContain("Organization voice override.");
  });

  it("loads only the active organization's workspace defaults", async () => {
    const ownerA = "__workspace__:__organization__:org-a";
    const ownerB = "__workspace__:__organization__:org-b";
    const orgResources = new Map(
      [
        {
          id: "org_a_agents",
          owner: ownerA,
          path: "AGENTS.md",
          content: "# Org A Workspace Instructions",
        },
        {
          id: "org_a_guardrails",
          owner: ownerA,
          path: "instructions/guardrails.md",
          content: "# Org A Guardrails",
        },
        {
          id: "org_a_company",
          owner: ownerA,
          path: "context/company.md",
          content: "---\ntitle: Acme\ndescription: Org A company.\n---\n",
        },
        {
          id: "org_b_agents",
          owner: ownerB,
          path: "AGENTS.md",
          content: "# Org B Workspace Instructions",
        },
        {
          id: "org_b_guardrails",
          owner: ownerB,
          path: "instructions/guardrails.md",
          content: "# Org B Guardrails",
        },
        {
          id: "org_b_company",
          owner: ownerB,
          path: "context/company.md",
          content: "---\ntitle: Globex\ndescription: Org B company.\n---\n",
        },
      ].map((resource) => [
        resource.id,
        { ...resource, mimeType: "text/markdown" },
      ]),
    );
    const byOwner = (owner: string, prefix?: string) =>
      [...orgResources.values()].filter(
        (resource) =>
          resource.owner === owner &&
          (!prefix || resource.path.startsWith(prefix)),
      );
    mocks.resourceGetByPath.mockImplementation(
      async (owner, path) =>
        byOwner(owner).find((resource) => resource.path === path) ?? null,
    );
    mocks.resourceList.mockImplementation(async (owner, prefix) =>
      byOwner(owner, prefix).map(({ content, ...meta }) => meta),
    );
    mocks.resourceListAccessible.mockResolvedValue([]);
    mocks.resourceGet.mockImplementation(async (id) => orgResources.get(id));

    const prompt = await loadResourcesForPrompt(
      "user@example.test",
      false,
      "analytics",
      "org-a",
    );

    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(ownerA, "AGENTS.md", {
      orgId: "org-a",
    });
    expect(mocks.resourceGetByPath).not.toHaveBeenCalledWith(
      ownerB,
      "AGENTS.md",
      expect.anything(),
    );
    expect(mocks.resourceGetByPath).not.toHaveBeenCalledWith(
      "__workspace__",
      "AGENTS.md",
      expect.anything(),
    );
    expect(prompt).toContain("# Org A Workspace Instructions");
    expect(prompt).toContain("# Org A Guardrails");
    expect(prompt).toContain("`context/company.md` - Acme: Org A company.");
    expect(prompt).not.toContain("Org B");
    expect(prompt).not.toContain("Globex");
  });

  it("loads inherited workspace instructions and indexes workspace reference resources", async () => {
    const prompt = await loadResourcesForPrompt("user@example.test");

    expect(mocks.ensurePersonalDefaults).toHaveBeenCalledWith(
      "user@example.test",
    );
    expect(prompt).toContain('<resource name="AGENTS.md" scope="workspace"');
    expect(prompt).toContain('<resource name="AGENTS.md" scope="shared"');
    expect(prompt).toContain('<resource name="AGENTS.md" scope="personal"');
    expect(prompt).toContain(
      '<resource name="instructions/guardrails.md" scope="workspace-instruction"',
    );
    expect(prompt).toContain(
      '<resource name="instructions/guardrails.md" scope="shared-instruction"',
    );
    expect(prompt).toContain(
      '<resource name="instructions/guardrails.md" scope="personal-instruction"',
    );
    expect(prompt).toContain("Protect customer data.");
    expect(prompt.indexOf('scope="workspace"')).toBeLessThan(
      prompt.indexOf('scope="shared"'),
    );
    expect(prompt.indexOf('scope="shared"')).toBeLessThan(
      prompt.indexOf('scope="personal"'),
    );
    expect(prompt.indexOf("Workspace Guardrails")).toBeLessThan(
      prompt.indexOf("Organization Guardrails"),
    );
    expect(prompt.indexOf("Organization Guardrails")).toBeLessThan(
      prompt.indexOf("Personal Guardrails"),
    );
    expect(prompt).toContain("<resource-skills>");
    expect(prompt).toContain("`company-voice` at resource");
    expect(prompt).toContain("(personal) - Personal voice override.");
    expect(prompt).toContain(
      'Use the `resources` tool with `action: "read"`, `path: "skills/company-voice/SKILL.md"` and `scope: "personal"`',
    );
    expect(prompt).not.toContain("resource-read --path");
    expect(prompt).not.toContain("Workspace voice default.");
    expect(prompt).not.toContain("Organization voice override.");
    expect(prompt).toContain('<workspace-resources scope="workspace">');
    expect(prompt).toContain("`context/brand.md` - Brand Guidelines");
    expect(prompt).toContain(
      "`context/messaging.md` - Messaging: Core value props and proof points.",
    );
    expect(prompt).not.toContain("Use `resource-read --path <path>");
  });

  it("fails prompt construction when Labs state for a resource skill is unreadable", async () => {
    resourcesById.set("skills_lab_required", {
      id: "skills_lab_required",
      path: "skills/lab-required/SKILL.md",
      owner: "__workspace__",
      mimeType: "text/markdown",
      content:
        "---\nname: lab-required\ndescription: Requires an enabled Lab.\nrequires-lab: reports.preview\n---\n\n# Lab Required",
    });
    mocks.resourceListAccessible.mockResolvedValue([
      meta("skills_lab_required"),
    ]);
    mocks.getEnabledSkillLabsForUser.mockRejectedValue(
      new Error("Labs settings unavailable"),
    );

    await expect(loadResourcesForPrompt("user@example.test")).rejects.toThrow(
      "Labs settings unavailable",
    );
  });

  it("points compact bundled skills at their docs-search skill slugs", async () => {
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: "",
      agentsMd: "",
      skills: {
        "deep-review": {
          meta: {
            name: "deep-review",
            description: "Use when reviewing risky changes.",
            scope: "both",
          },
          content: "---\nname: deep-review\n---\n# Deep Review",
          dir: ".agents/skills/deep-review",
          extraFiles: [],
        },
      },
    });

    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt).toContain("<skills-summary>");
    expect(prompt).toContain("Prefer concise updates.");
    expect(prompt).toContain(
      'Read with `docs-search --slug "skill-deep-review"` before starting a task it applies to; reuse that page for the rest of the conversation.',
    );
    expect(prompt).toContain("do not repeat an equivalent docs-search lookup");
    expect(prompt).toContain("Do not use MCP resource reads for these skills.");
    expect(prompt).not.toContain("Use `docs-search` to read a skill");
  });

  it("indexes instruction files instead of inlining their markdown in compact mode", async () => {
    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt).toContain(
      '<instruction-resources scope="workspace-instruction">',
    );
    expect(prompt).toContain("`instructions/guardrails.md`");
    expect(prompt).not.toContain("Protect customer data.");
    expect(prompt).not.toContain("Narrow workspace guardrails.");
    expect(prompt).not.toContain("Prefer concise local overrides.");
  });

  it("keeps a saved personal AGENTS.md instruction in compact startup context", async () => {
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: "",
      agentsMd: "",
      skills: {},
    });
    mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
      if (path === "AGENTS.md") {
        return {
          content:
            owner === "user@example.test"
              ? "# Saved personal rule\n\nAlways preserve the user's requested output format."
              : `# ${owner} rule\n\n${"context ".repeat(2_000)}`,
        };
      }
      return null;
    });

    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt).toContain(
      "Always preserve the user's requested output format.",
    );
    expect(prompt).toContain("# Saved personal rule");
  });

  it("fails loudly when a durable AGENTS.md resource cannot be read", async () => {
    mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
      if (owner === "user@example.test" && path === "AGENTS.md") {
        throw new Error("resource backend unavailable");
      }
      return null;
    });

    await expect(
      loadResourcesForPrompt("user@example.test", true),
    ).rejects.toThrow(
      "Unable to read durable AGENTS.md instructions for personal (user@example.test)",
    );
  });

  it("keeps aggregate compact startup resources within a fixed budget", async () => {
    const skills = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [
        `skill-${index}`,
        {
          meta: {
            name: `skill-${index}`,
            description: `Runtime workflow ${index} ${"detail ".repeat(40)}`,
            scope: "both",
          },
          content: `# Skill ${index}`,
          dir: `.agents/skills/skill-${index}`,
          extraFiles: [],
        },
      ]),
    );
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: `# Workspace\n${"workspace ".repeat(2_000)}`,
      agentsMd: `# Template\n${"template ".repeat(2_000)}`,
      skills,
    });
    mocks.resourceGetByPath.mockImplementation(async (_owner, path) => {
      if (path === "AGENTS.md" || path === "LEARNINGS.md") {
        return { content: `# ${path}\n${"instruction ".repeat(2_000)}` };
      }
      return null;
    });

    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt.length).toBeLessThan(49_000);
    expect(prompt).toContain("<context-budget-note>");
    expect(prompt).toContain("docs-search");
    expect(prompt).toContain("tool-search");
  });

  it("keeps cross-app discovery and names what it dropped when compact context overflows", async () => {
    mocks.discoverAgents.mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, index) => ({
        id: index === 0 ? "analytics" : `app-${index}`,
        name: index === 0 ? "Analytics" : `App ${index}`,
        description: `Query product data ${index}. ${"capability detail ".repeat(20)}`,
      })) as never,
    );
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: `# Workspace\n${"workspace ".repeat(2_000)}`,
      agentsMd: `# Template\n${"template ".repeat(2_000)}`,
      skills: Object.fromEntries(
        Array.from({ length: 80 }, (_, index) => [
          `skill-${index}`,
          {
            meta: {
              name: `skill-${index}`,
              description: `Runtime workflow ${index} ${"detail ".repeat(40)}`,
              scope: "both",
            },
            content: `# Skill ${index}`,
            dir: `.agents/skills/skill-${index}`,
            extraFiles: [],
          },
        ]),
      ),
    });
    mocks.resourceGetByPath.mockImplementation(async (_owner, path) => {
      if (path === "AGENTS.md" || path === "LEARNINGS.md") {
        return { content: `# ${path}\n${"instruction ".repeat(2_000)}` };
      }
      return null;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const prompt = await loadResourcesForPrompt("user@example.test", true);

      expect(prompt).toContain("<available-apps>");
      expect(prompt).toContain("Analytics (analytics)");
      expect(prompt).toContain("describe-workspace-apps");
      expect(prompt).toContain(
        "This list is a directory, not a request to involve another app.",
      );
      expect(prompt).toContain(
        "Use `call-agent` only when the user's requested outcome depends on data or a capability only that app can provide",
      );
      expect(prompt).toContain(
        "Use `describe-workspace-apps` only when that relevant cross-app need exists",
      );
      expect(prompt).toContain(
        "you cannot tell which peer owns it or whether a known peer can provide it",
      );
      expect(prompt).not.toContain(
        "Before building a capability another app may already own",
      );
      expect(prompt).toContain("<context-note>");
      expect(prompt).toMatch(/section\(s\) did not fit the 48,000-character/);
      expect(prompt).toContain("Treat them as unread, not as absent");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("startup context exceeded"),
      );
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("required startup context alone exceeds"),
      );
      expect(promptResourceManifestSections(prompt)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Available workspace apps",
            governance: "required",
          }),
          expect.objectContaining({
            label: "Context budget note",
            governance: "required",
          }),
        ]),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("excludes scope: dev skills from the compact skills summary", async () => {
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: "",
      agentsMd: "",
      skills: {
        "runtime-skill": {
          meta: {
            name: "runtime-skill",
            description: "Visible at runtime.",
            scope: "both",
          },
          content: "---\nname: runtime-skill\n---\n# Runtime",
          dir: ".agents/skills/runtime-skill",
          extraFiles: [],
        },
        "dev-only-skill": {
          meta: {
            name: "dev-only-skill",
            description: "For the human coding agent only.",
            scope: "dev",
          },
          content: "---\nname: dev-only-skill\n---\n# Dev only",
          dir: ".agents/skills/dev-only-skill",
          extraFiles: [],
        },
      },
    });

    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt).toContain("<skills-summary>");
    expect(prompt).toContain("`runtime-skill`");
    expect(prompt).not.toContain("dev-only-skill");
  });

  it("excludes scope: dev resource skills from the runtime prompt", async () => {
    const prompt = await loadResourcesForPrompt("user@example.test");

    expect(prompt).toContain("`company-voice` at resource");
    expect(prompt).not.toContain("dev-only");
    expect(prompt).not.toContain("Development-only workflow.");
  });

  it("caps an oversized shared LEARNINGS.md instead of inlining it in full in the non-lazy (compact: false) path", async () => {
    const hugeLearnings = `# Learnings\n${"- prior incident detail.\n".repeat(3_000)}`;
    mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
      if (owner === "__shared__" && path === "LEARNINGS.md") {
        return { content: hugeLearnings };
      }
      return null;
    });

    const prompt = await loadResourcesForPrompt("user@example.test", false);

    expect(hugeLearnings.length).toBeGreaterThan(30_000);
    expect(prompt).toContain('<resource name="LEARNINGS.md" scope="shared"');
    expect(prompt).toContain("truncated after 30,000 characters");
    expect(prompt).toContain('Use the `resources` tool with `action: "read"`');
    expect(prompt.length).toBeLessThan(hugeLearnings.length);
  });

  it("caps an oversized personal memory/MEMORY.md instead of inlining it in full in the non-lazy (compact: false) path", async () => {
    const hugeMemory = `# Memory Index\n${"- long-term fact.\n".repeat(3_000)}`;
    mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
      if (owner === "user@example.test" && path === "memory/MEMORY.md") {
        return { content: hugeMemory };
      }
      return null;
    });

    const prompt = await loadResourcesForPrompt("user@example.test", false);

    expect(hugeMemory.length).toBeGreaterThan(30_000);
    expect(prompt).toContain(
      '<resource name="memory/MEMORY.md" scope="personal"',
    );
    expect(prompt).toContain("truncated after 30,000 characters");
    expect(prompt.length).toBeLessThan(hugeMemory.length);
  });
});

describe("compact skills summary and the request registry", () => {
  const deepReviewBundle = {
    workspaceAgentsMd: "",
    agentsMd: "",
    skills: {
      "deep-review": {
        meta: {
          name: "deep-review",
          description: "Use when reviewing risky changes.",
          scope: "both",
        },
        content: "---\nname: deep-review\n---\n# Deep Review",
        dir: ".agents/skills/deep-review",
        extraFiles: [],
      },
    },
  };

  async function mountLeanHandler(
    frameworkTools: AgentChatPluginOptions["frameworkTools"],
  ) {
    createAgentChatPlugin({
      actions: () => ({}),
      a2aAgentDelegation: false,
      frameworkTools,
      leanPrompt: true,
      mcp: { enabled: false },
    })({ h3App: createApp(), hooks: { hook: vi.fn() } });
    await routeHarness.initPromises.at(-1);
    const handler = handlerHarness.options[0];
    if (!handler) throw new Error("Lean agent handler was not created");
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });
    mocks.loadAgentsBundle.mockResolvedValue(deepReviewBundle);
    const systemPrompt = await runWithRequestContext(
      { userEmail: "user@example.test", orgScope: "personal" },
      () =>
        handler.systemPrompt(
          new H3Event(new Request("https://app.example.test/chat")),
        ),
    );
    return { registry: handler.actions, systemPrompt };
  }

  function toolsNamedBySkillsSummary(systemPrompt: string): string[] {
    const summary =
      /<skills-summary>[\s\S]*<\/skills-summary>/.exec(systemPrompt)?.[0] ?? "";
    return [...summary.matchAll(/`([a-z][a-z0-9-]*) --(?:slug|query)/g)].map(
      (match) => match[1]!,
    );
  }

  it("gives the lean hosted registry every tool the skills summary names", async () => {
    const { registry, systemPrompt } = await mountLeanHandler({
      preset: "minimal",
      docs: true,
    });

    const named = toolsNamedBySkillsSummary(systemPrompt);
    expect(named).toContain("docs-search");
    for (const name of named) expect(registry).toHaveProperty(name);
    // Only the skill reader joins the lean first request.
    expect(registry).not.toHaveProperty("framework-search");
    // The lean prompt omits the compact framework prompt, so it carries the
    // batching rule itself.
    expect(systemPrompt).toContain("emit them in the same step");
  });

  it("drops the skills summary when the registry has no skill-read tool", async () => {
    const { registry, systemPrompt } = await mountLeanHandler("minimal");

    expect(registry).not.toHaveProperty("docs-search");
    expect(systemPrompt).not.toContain("<skills-summary>");
  });

  it("names the skill-read tool the caller passes, and drops the summary for null", async () => {
    mocks.loadAgentsBundle.mockResolvedValue(deepReviewBundle);

    const renamed = await loadResourcesForPrompt(
      "user@example.test",
      true,
      undefined,
      undefined,
      { skillReadTool: "read-skill" },
    );
    expect(renamed).toContain(
      'Read with `read-skill --slug "skill-deep-review"`',
    );
    expect(renamed).not.toContain("docs-search");

    const absent = await loadResourcesForPrompt(
      "user@example.test",
      true,
      undefined,
      undefined,
      { skillReadTool: null },
    );
    expect(absent).not.toContain("<skills-summary>");
    expect(absent).not.toContain("deep-review");
  });
});
