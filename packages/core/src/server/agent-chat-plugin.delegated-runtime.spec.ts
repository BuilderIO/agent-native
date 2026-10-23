import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createApp, mockEvent } from "h3";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const booted = vi.hoisted(() => ({
  handlerOptions: [] as Array<Record<string, any>>,
  initPromises: [] as Promise<void>[],
  a2aConfig: undefined as Record<string, any> | undefined,
  mcpConfig: undefined as Record<string, any> | undefined,
  loopRuns: [] as Array<{ protocol: string; runOptions: any }>,
}));

// The wire to a remote app. Unset, requests use the real SSRF-safe fetch.
const remote = vi.hoisted(() => ({
  fetch: undefined as
    | ((url: string, init?: RequestInit) => Promise<Response>)
    | undefined,
}));

vi.mock("../extensions/url-safety.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../extensions/url-safety.js")>();
  return {
    ...actual,
    ssrfSafeFetch: (url: string, init?: RequestInit, ...rest: any[]) =>
      remote.fetch
        ? remote.fetch(url, init)
        : (actual.ssrfSafeFetch as any)(url, init, ...rest),
  };
});

// Leaf execution is the only thing substituted: each runtime factory still
// builds its real entries (names, schemas, flags), but `run` records the call
// instead of sending mail, fetching, running code, or writing files.
const leaf = vi.hoisted(() => {
  const reached: string[] = [];
  const produced = new Map<string, string[]>();
  // The factory's own `run`, kept for the one tool a test must drive for real
  // (call-agent over the stubbed wire) instead of recording.
  const real = new Map<string, (args: any, context: any) => Promise<unknown>>();
  const substitute = (group: string, entries: Record<string, any>) => {
    produced.set(group, [
      ...new Set([...(produced.get(group) ?? []), ...Object.keys(entries)]),
    ]);
    return Object.fromEntries(
      Object.entries(entries).map(([name, entry]) => {
        real.set(name, entry.run);
        return [
          name,
          {
            ...entry,
            run: async () => {
              reached.push(name);
              return `leaf-reached:${name}`;
            },
          },
        ];
      }),
    );
  };
  return { reached, produced, real, substitute };
});

vi.mock("./agent-chat/action-filters-a2a.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-chat/action-filters-a2a.js")>();
  const capture = (protocol: string) => async (runOptions: any) => {
    booted.loopRuns.push({ protocol, runOptions });
    throw new Error("agent loop reached");
  };
  return {
    ...actual,
    runA2AAgentLoop: capture("a2a"),
    runMCPAgentLoop: capture("mcp"),
  };
});

vi.mock("./agent-chat/script-entries.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-chat/script-entries.js")>();
  return {
    ...actual,
    createDbScriptEntries: async (...args: any[]) =>
      leaf.substitute(
        "db",
        await (actual.createDbScriptEntries as any)(...args),
      ),
    createChatScriptEntries: async () =>
      leaf.substitute("chat", await actual.createChatScriptEntries()),
    createAgentEngineScriptEntries: async (...args: any[]) =>
      leaf.substitute(
        "engine",
        await (actual.createAgentEngineScriptEntries as any)(...args),
      ),
    createAgentLoopSettingsScriptEntries: async () =>
      leaf.substitute(
        "loop-settings",
        await actual.createAgentLoopSettingsScriptEntries(),
      ),
    createCallAgentScriptEntry: async (...args: any[]) =>
      leaf.substitute(
        "call-agent",
        await (actual.createCallAgentScriptEntry as any)(...args),
      ),
  };
});

vi.mock("./agent-chat/run-code-tools.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-chat/run-code-tools.js")>();
  return {
    ...actual,
    loadRunCodeToolEntries: async (...args: any[]) =>
      leaf.substitute(
        "run-code",
        await (actual.loadRunCodeToolEntries as any)(...args),
      ),
  };
});

vi.mock("./agent-chat/browser-team-tools.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-chat/browser-team-tools.js")>();
  return {
    ...actual,
    createBuilderBrowserTool: (...args: any[]) =>
      leaf.substitute(
        "browser",
        (actual.createBuilderBrowserTool as any)(...args),
      ),
  };
});

vi.mock("../extensions/fetch-tool.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../extensions/fetch-tool.js")>();
  return {
    ...actual,
    createFetchToolEntry: (...args: any[]) =>
      leaf.substitute("fetch", (actual.createFetchToolEntry as any)(...args)),
  };
});

vi.mock("../extensions/web-search-tool.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../extensions/web-search-tool.js")>();
  return {
    ...actual,
    createWebSearchToolEntry: (...args: any[]) =>
      leaf.substitute(
        "web-search",
        (actual.createWebSearchToolEntry as any)(...args),
      ),
  };
});

vi.mock("../workspace-files/tool.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../workspace-files/tool.js")>();
  return {
    ...actual,
    createWorkspaceFilesTool: (...args: any[]) =>
      leaf.substitute(
        "workspace-files",
        (actual.createWorkspaceFilesTool as any)(...args),
      ),
  };
});

vi.mock("../workspace-files/actions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../workspace-files/actions.js")>();
  return {
    ...actual,
    createWorkspaceFileActionEntries: (...args: any[]) =>
      leaf.substitute(
        "workspace-file-actions",
        (actual.createWorkspaceFileActionEntries as any)(...args),
      ),
  };
});

vi.mock("../browser-sessions/actions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../browser-sessions/actions.js")>();
  return {
    ...actual,
    createBrowserSessionActionEntries: (...args: any[]) =>
      leaf.substitute(
        "browser-sessions",
        (actual.createBrowserSessionActionEntries as any)(...args),
      ),
  };
});

vi.mock("../integrations/remote-browser-actions.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../integrations/remote-browser-actions.js")
    >();
  return {
    ...actual,
    createRemoteBrowserActionEntries: (...args: any[]) =>
      leaf.substitute(
        "remote-browser",
        (actual.createRemoteBrowserActionEntries as any)(...args),
      ),
  };
});

vi.mock("./email-actions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email-actions.js")>();
  return {
    ...actual,
    createCoreEmailActionEntries: (...args: any[]) =>
      leaf.substitute(
        "email",
        (actual.createCoreEmailActionEntries as any)(...args),
      ),
  };
});

vi.mock("../coding-tools/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../coding-tools/index.js")>();
  return {
    ...actual,
    createCodingToolRegistry: (...args: any[]) =>
      leaf.substitute(
        "coding",
        (actual.createCodingToolRegistry as any)(...args),
      ),
  };
});

vi.mock("../jobs/tools.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../jobs/tools.js")>();
  return {
    ...actual,
    createJobTools: (...args: any[]) =>
      leaf.substitute("jobs", (actual.createJobTools as any)(...args)),
  };
});

vi.mock("../scripts/dev/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../scripts/dev/index.js")>();
  return {
    ...actual,
    createDevScriptRegistry: async (...args: any[]) =>
      leaf.substitute(
        "dev",
        await (actual.createDevScriptRegistry as any)(...args),
      ),
  };
});

vi.mock("../agent/production-agent.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agent/production-agent.js")>();
  return {
    ...actual,
    createProductionAgentHandler: (options: any) => {
      booted.handlerOptions.push(options);
      return actual.createProductionAgentHandler(options);
    },
  };
});

vi.mock("./framework-request-handler.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./framework-request-handler.js")>()),
  awaitBootstrap: () => Promise.resolve(),
  getH3App: (nitroApp: any) => nitroApp.h3App,
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: (_nitroApp: any, promise: Promise<void>) => {
    booted.initPromises.push(promise);
  },
}));

vi.mock("../a2a/server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../a2a/server.js")>()),
  mountA2A: (_app: unknown, config: any) => {
    booted.a2aConfig = config;
  },
}));

vi.mock("../mcp/server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp/server.js")>()),
  mountMCP: (_nitroApp: unknown, config: any) => {
    booted.mcpConfig = config;
  },
}));

vi.mock("../agent/run-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/run-store.js")>()),
  listUnclaimedBackgroundRunRows: vi.fn(async () => []),
  reapAllStaleRuns: vi.fn(async () => ({
    scanned: 0,
    reaped: 0,
    failed: 0,
    truncated: false,
  })),
}));

vi.mock("../mcp-client/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp-client/index.js")>()),
  buildMergedConfig: vi.fn(async () => null),
  startMcpConfigRefresh: () => () => {},
}));

vi.mock("../jobs/scheduler.js", () => ({
  processRecurringJobs: vi.fn(async () => {}),
}));

vi.mock("../triggers/dispatcher.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../triggers/dispatcher.js")>()),
  initTriggerDispatcher: vi.fn(async () => {}),
  refreshEventSubscriptions: vi.fn(async () => {}),
}));

vi.mock("../chat-threads/migrations.js", () => ({
  runChatThreadDataMigrations: vi.fn(async () => {}),
}));

vi.mock("./social-og-image.js", () => ({
  createAgentNativeOgImageHandler: () => () => new Response(),
}));

import * as callerAuth from "../a2a/caller-auth.js";
import { handleJsonRpcH3, processA2ATaskFromQueue } from "../a2a/handlers.js";
import { isOutsideAgentCall } from "../action-caller.js";
import type { ActionRunContext } from "../action.js";
import {
  actionsToEngineTools,
  runAgentLoop,
  type ActionEntry,
} from "../agent/production-agent.js";
import { runBackgroundAutomation } from "../jobs/background-automation-runner.js";
import { parseJobResource } from "../jobs/frontmatter.js";
import { createMCPServerForRequest } from "../mcp/build-server.js";
import * as orgDirectory from "../mcp/org-directory.js";
import * as workspaceResolve from "../mcp/workspace-resolve.js";
import { resourceGet, resourceList, resourcePut } from "../resources/store.js";
import { createAgentChatPlugin } from "./agent-chat-plugin.js";
import type { AgentChatPluginOptions } from "./agent-chat/plugin-options.js";
import { runWithRequestContext } from "./request-context.js";

const ALICE = "alice@example.com";
const policyContexts: Array<{
  caller: ActionRunContext["caller"] | undefined;
  protocol: ActionRunContext["networkProtocol"] | undefined;
  networkId: string | undefined;
  outside: boolean;
}> = [];

function outsidePolicyProbe(): ActionEntry {
  return {
    tool: {
      description: "Probe app-owned approval policy",
      parameters: { type: "object", properties: {} },
    },
    needsApproval: (_args, ctx) => {
      policyContexts.push({
        caller: ctx?.caller,
        protocol: ctx?.networkProtocol,
        networkId: ctx?.networkId,
        outside: isOutsideAgentCall(ctx),
      });
      return isOutsideAgentCall(ctx);
    },
    run: async () => "app policy admitted",
  };
}

function appAction(description: string): ActionEntry {
  return {
    tool: {
      description,
      parameters: { type: "object", properties: {} },
    },
    readOnly: true,
    mcpAnnotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    run: async () => description,
  };
}

// The CRM template's attach-call-evidence write action (name, argument shape,
// no approval flag); its leaf records the call instead of touching CRM tables.
const CRM_ATTACH_ARGS = {
  recordId: "record-1",
  artifactId: "clip-1",
  sourceUrl: "https://clips.example.com/share/clip-1",
};

function attachCallEvidence(): ActionEntry {
  return {
    tool: {
      description: "Attach bounded call evidence to a CRM record.",
      parameters: {
        type: "object",
        properties: {
          recordId: { type: "string" },
          artifactId: { type: "string" },
          sourceUrl: { type: "string" },
          sourceApp: { type: "string" },
        },
        required: ["artifactId", "sourceUrl"],
      },
    },
    run: async () => {
      leaf.reached.push("attach-call-evidence");
      return "leaf-reached:attach-call-evidence";
    },
  };
}

const closers: Array<() => void | Promise<void>> = [];

async function boot(options: Partial<AgentChatPluginOptions>): Promise<void> {
  const nitroApp = {
    h3App: createApp(),
    hooks: {
      hook(name: string, callback: () => void | Promise<void>) {
        if (name === "close") closers.push(callback);
      },
    },
  };
  createAgentChatPlugin({
    appId: "delegated-runtime",
    actions: () => ({
      "list-decks": appAction("template list-decks"),
      "attach-call-evidence": attachCallEvidence(),
      "outside-policy-probe": outsidePolicyProbe(),
    }),
    engine: {
      name: "unused",
      label: "Unused",
      defaultModel: "unused-model",
      supportedModels: ["unused-model"],
      capabilities: {},
      stream: async function* () {},
    } as any,
    ...options,
  })(nitroApp);
  await booted.initPromises.at(-1);
}

// The real names each runtime factory registers. A name that a factory stops
// registering fails the inventory test below, so the matrix cannot quietly
// shrink.
const RUNTIME_BY_FACTORY: Record<string, string[]> = {
  email: ["core-send-email"],
  fetch: ["web-request"],
  "web-search": ["web-search"],
  db: ["db-schema", "db-query", "db-exec", "db-patch"],
  "call-agent": ["call-agent"],
  engine: ["manage-agent-engine"],
  "loop-settings": ["manage-agent-loop-settings"],
  browser: ["activate-browser"],
  "remote-browser": [
    "list-remote-browser-devices",
    "read-remote-browser-page",
    "control-remote-browser",
    "get-remote-browser-command",
  ],
  "browser-sessions": [
    "list-browser-sessions",
    "view-browser-session",
    "list-browser-session-actions",
    "list-browser-session-webmcp-tools",
    "run-browser-session-webmcp-tool",
    "run-browser-session-action",
    "send-browser-session-command",
  ],
  "run-code": ["run-code", "tool-orchestration", "get-code-execution"],
  coding: ["bash", "read", "edit", "write"],
  "workspace-files": ["workspace-files"],
  jobs: ["manage-jobs"],
};
const RUNTIME_NAMES = Object.values(RUNTIME_BY_FACTORY).flat();

// The dev toggle's registry (createDevScriptRegistry) binds its own coding and
// database entries; db-check-scoping exists only there, and the dev browser
// group adds the browser-control toggles.
const DEV_FACTORIES: Record<string, string[]> = {
  browser: ["activate-browser", "set-browser-control", "set-computer-use"],
  dev: [
    "bash",
    "read",
    "edit",
    "write",
    "db-schema",
    "db-query",
    "db-check-scoping",
    "db-exec",
    "db-patch",
  ],
};

// The names the active surface registers; the helpers below probe these.
let activeNames: string[] = RUNTIME_NAMES;

// App-owned and allowlisted tools a delegated run keeps today and must keep
// once the runtime is closed.
const DELEGATED_CONTROLS = [
  "list-decks",
  "share-resource",
  "list-resource-shares",
  "upload-image",
  "tool-search",
  "attach-call-evidence",
  "docs-search",
  "outside-policy-probe",
];

const IDENTITY = {
  userEmail: ALICE,
  orgDomain: undefined,
  orgId: null,
  oauthScopes: ["mcp:read", "mcp:write"],
};

interface CatalogMode {
  name: string;
  plugin: Partial<AgentChatPluginOptions>;
  request?: { fullCatalog: true };
  env?: true;
  // Whether the real MCP server lets an external caller reach each alias.
  callable: { ask_app: boolean; "ask-agent": boolean };
  // The directory profile validates its connector tools against the registered
  // actions, and the dev registry holds none of the app's template actions.
  bootsInDev?: false;
}

const MODES: CatalogMode[] = [
  {
    name: "mounted default",
    plugin: { mcp: { enabled: true } },
    callable: { ask_app: true, "ask-agent": false },
  },
  {
    name: "compact",
    plugin: {
      mcp: { enabled: true, externalAgents: { authenticatedReads: "off" } },
    },
    callable: { ask_app: true, "ask-agent": false },
  },
  {
    name: "connector",
    plugin: {
      mcp: {
        enabled: true,
        // The app declares every runtime tool as a connector tool.
        connectorCatalog: ["list-decks", ...RUNTIME_NAMES],
      },
    },
    callable: { ask_app: true, "ask-agent": false },
  },
  {
    name: "app",
    plugin: { mcp: { enabled: true, catalog: "app" } },
    callable: { ask_app: false, "ask-agent": false },
  },
  {
    name: "directory",
    plugin: {
      mcp: {
        enabled: true,
        catalog: "directory",
        widgetDomain: "https://delegated-runtime.example.com",
        connectorCatalog: ["list-decks"],
      },
    },
    callable: { ask_app: false, "ask-agent": false },
    bootsInDev: false,
  },
  {
    name: "full token",
    plugin: { mcp: { enabled: true } },
    request: { fullCatalog: true },
    callable: { ask_app: true, "ask-agent": true },
  },
  {
    name: "full env",
    plugin: { mcp: { enabled: true } },
    env: true,
    callable: { ask_app: true, "ask-agent": true },
  },
];

type CapturedRun = (typeof booted.loopRuns)[number];

async function bootRuntime(
  options: Partial<AgentChatPluginOptions> = {},
): Promise<void> {
  await boot({
    frameworkTools: { database: "write" },
    selectedA2AReceiverOwnsObjective: true,
    ...options,
  });
}

function runtimeIn(names: Iterable<string>): string[] {
  const present = new Set(names);
  return activeNames.filter((name) => present.has(name));
}

async function asAlice<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: ALICE, orgId: "acme" }, run);
}

// What a model can reach on one surface: registered actions, the first
// request, every tool offered mid-run, and what tool-search loads by name.
async function probeSurface(surface: {
  actions: Record<string, ActionEntry>;
  tools: Array<{ name: string }>;
  availableTools?: Array<{ name: string }>;
}) {
  const discoverable = new Set<string>();
  for (let i = 0; i < activeNames.length; i += 10) {
    const found: any = await asAlice(() =>
      surface.actions["tool-search"]!.run({
        names: activeNames.slice(i, i + 10),
        limit: 10,
      }),
    );
    for (const result of found.results ?? []) {
      if (result.callable) discoverable.add(result.name);
    }
  }
  return {
    registered: runtimeIn(Object.keys(surface.actions)),
    firstRequest: runtimeIn(surface.tools.map((tool) => tool.name)),
    offered: runtimeIn(
      (surface.availableTools ?? surface.tools).map((tool) => tool.name),
    ),
    discoverable: runtimeIn(discoverable),
  };
}

function syntheticInput(
  name: string,
  actions: Record<string, ActionEntry>,
): Record<string, unknown> {
  const schema: any = actions[name]?.tool.parameters ?? {};
  const branch = (schema.anyOf ?? schema.oneOf ?? [])[0] ?? {};
  const properties = { ...schema.properties, ...branch.properties };
  const input: Record<string, unknown> = {};
  for (const field of [
    ...(schema.required ?? []),
    ...(branch.required ?? []),
  ]) {
    const property = properties[field] ?? {};
    const type = Array.isArray(property.type)
      ? property.type[0]
      : property.type;
    input[field] =
      property.enum?.[0] ??
      (type === "number" || type === "integer"
        ? 1
        : type === "boolean"
          ? true
          : type === "array"
            ? []
            : type === "object"
              ? {}
              : "x");
  }
  return input;
}

// Plays a model that tries one runtime tool directly, asks tool-search for it,
// and tries it again, through the real agent loop and the registry the surface
// was built with. One loop per tool: an earlier tool that ends the turn must not
// mask the rest. Some tools dispatch through a sibling entry (the remote-browser
// controls), so any leaf running during the loop counts as reaching runtime. A call that
// the loop accepts and parks for approval (needsApproval) has reached it too.
async function attackOne(runOptions: any, name: string) {
  let turn = 0;
  let seen = "";
  let attempts = 0;
  const engine = {
    name: "attacker",
    label: "Attacker",
    defaultModel: "attacker-model",
    supportedModels: ["attacker-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(opts: any) {
      for (const message of opts.messages) {
        for (const part of message.content ?? []) {
          if (
            part.type === "tool-result" &&
            part.toolCallId !== "attack-search"
          ) {
            seen = String(part.content);
          }
        }
      }
      turn += 1;
      const direct = {
        type: "tool-call" as const,
        id: `attack-${turn}`,
        name,
        input: syntheticInput(name, runOptions.actions),
      };
      const parts =
        turn === 1 || turn === 3
          ? [direct]
          : turn === 2
            ? [
                {
                  type: "tool-call" as const,
                  id: "attack-search",
                  name: "tool-search",
                  input: { names: [name] },
                },
              ]
            : [{ type: "text" as const, text: "done" }];
      attempts += parts.filter((part) => part.type === "tool-call").length;
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: parts.some((part) => part.type === "tool-call")
          ? "tool_use"
          : "end_turn",
      };
    },
  };
  const approvals: string[] = [];
  const before = leaf.reached.length;
  await asAlice(() =>
    runAgentLoop({
      ...runOptions,
      messages: structuredClone(runOptions.messages),
      engine: engine as any,
      model: "attacker-model",
      send: (event: any) => {
        if (event.type === "approval_required") approvals.push(event.tool);
      },
      signal: new AbortController().signal,
      runId: `attack-${name}`,
      threadId: `attack-${name}`,
      turnId: `attack-${name}`,
    }),
  );
  return {
    reached: leaf.reached.length > before || approvals.includes(name),
    attempts,
    seen,
  };
}

// A model that makes one call, reads what came back, and ends.
function scriptedEngine(
  name: string,
  input: Record<string, unknown>,
  onResult: (result: string) => void,
) {
  let turn = 0;
  return {
    name: "caller",
    label: "Caller",
    defaultModel: "caller-model",
    supportedModels: ["caller-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(opts: any) {
      for (const message of opts.messages) {
        for (const part of message.content ?? []) {
          if (part.type === "tool-result" && part.toolCallId === "call-once") {
            onResult(
              typeof part.content === "string"
                ? part.content
                : JSON.stringify(part.content),
            );
          }
        }
      }
      turn += 1;
      const parts =
        turn === 1
          ? [{ type: "tool-call" as const, id: "call-once", name, input }]
          : [{ type: "text" as const, text: "done" }];
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: turn === 1 ? "tool_use" : "end_turn",
      };
    },
  };
}

// One model turn that makes one call through the real loop, then ends. Reports
// whether the loop parked the call for approval and what the tool returned.
async function callOnce(
  runOptions: any,
  name: string,
  input: Record<string, unknown>,
) {
  let result = "";
  const engine = scriptedEngine(name, input, (value) => {
    result = value;
  });
  const approvals: string[] = [];
  await asAlice(() =>
    runAgentLoop({
      ...runOptions,
      messages: structuredClone(runOptions.messages),
      engine: engine as any,
      model: "caller-model",
      send: (event: any) => {
        if (event.type === "approval_required") approvals.push(event.tool);
      },
      signal: new AbortController().signal,
      runId: `call-${name}`,
      threadId: `call-${name}`,
      turnId: `call-${name}`,
    }),
  );
  return {
    available: name in runOptions.actions,
    approval: approvals.includes(name),
    result,
  };
}

let automationCounter = 0;

function defineInput() {
  automationCounter += 1;
  return {
    action: "define",
    name: `routed-probe-${automationCounter}`,
    trigger_type: "manual",
    mode: "agentic",
    body: "Check my decks.",
  };
}

// Reads the stored automation back from the jobs resources, not from what the
// tool said it did.
async function storedAutomation(name: string) {
  const listed = await resourceList(ALICE, "jobs/");
  const found = listed.find((resource) => resource.path.includes(name));
  if (!found) return null;
  const resource = await resourceGet(found.id);
  return resource ? { resource, ...parseJobResource(resource.content) } : null;
}

// What a delegated run does when asked to create an automation: it must park
// for approval and persist nothing.
async function expectAutomationGated(run: CapturedRun, label: string) {
  const input = defineInput();
  const outcome = await callOnce(run.runOptions, "manage-automations", input);
  const stored = await storedAutomation(input.name);
  const observed = {
    available: outcome.available,
    approval: outcome.approval,
    created: stored !== null,
    marked: stored?.meta.mcpManaged === true,
    result: outcome.result.slice(0, 120),
  };
  if (run.protocol === "mcp") {
    expect
      .soft(observed, `${label}: inline automation is absent`)
      .toMatchObject({
        available: false,
        approval: false,
        created: false,
        result: 'Error: Unknown tool "manage-automations"',
      });
    return;
  }
  expect
    .soft(observed, `${label}: A2A automation must reach approval`)
    .toMatchObject({
      available: true,
      approval: true,
      created: false,
    });
}

async function replayAttack(runOptions: any) {
  leaf.reached.length = 0;
  const outcomes = new Map<string, Awaited<ReturnType<typeof attackOne>>>();
  for (const name of activeNames) {
    outcomes.set(name, await attackOne(runOptions, name));
  }
  return {
    reached: activeNames.filter((name) => outcomes.get(name)!.reached),
    outcomes,
  };
}

// Soft assertions: one failing base reports the surface and the real loop
// replay together instead of stopping at the first.
async function expectContained(run: CapturedRun, label: string) {
  const { runOptions } = run;

  const surface = await probeSurface(runOptions);
  for (const [where, names] of Object.entries(surface)) {
    expect
      .soft(names.join(","), `${label}: runtime reachable via ${where}`)
      .toBe("");
  }

  expect
    .soft(
      {
        retained: DELEGATED_CONTROLS.filter(
          (name) => name in runOptions.actions,
        ),
        appToolOnFirstRequest: runOptions.tools.some(
          (tool: any) => tool.name === "list-decks",
        ),
      },
      `${label}: app and allowlisted tools stay`,
    )
    .toEqual({ retained: DELEGATED_CONTROLS, appToolOnFirstRequest: true });

  await expectAutomationGated(run, label);
  const policy = await callOnce(runOptions, "outside-policy-probe", {});
  expect
    .soft(policy, `${label}: app-owned outside approval predicate`)
    .toMatchObject({
      available: true,
      approval: true,
    });
  expect
    .soft(policyContexts.at(-1), `${label}: tool caller and outside protocol`)
    .toEqual({
      caller: "tool",
      protocol: run.protocol,
      networkId: runOptions.networkId,
      outside: true,
    });

  const attack = await replayAttack(runOptions);
  expect
    .soft(attack.reached.join(","), `${label}: runtime run by the real loop`)
    .toBe("");
}

const APP_ORIGIN = "https://delegated-runtime.example.com";
const REMOTE_ORIGIN = "https://calendar.example.com";

interface Ask {
  args?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  // The ask is routed over A2A, so the receiver starts after the call returns.
  receiver?: boolean;
}

interface Asked {
  isError: boolean;
  text: string;
  inline: CapturedRun[];
  receiver: CapturedRun[];
}

// Calls one alias on the real MCP mount for this catalog mode. A2A-routed asks
// start the receiver in the background, so wait for it to reach the loop.
async function askThroughMcp(
  mode: CatalogMode,
  alias: "ask_app" | "ask-agent",
  ask: Ask = {},
): Promise<Asked> {
  const server = await createMCPServerForRequest(
    booted.mcpConfig as any,
    IDENTITY,
    {
      transport: "http",
      inlineMcpApps: false,
      ...(mode.request ?? {}),
      ...(ask.meta ?? {}),
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "delegated-runtime", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  try {
    const before = booted.loopRuns.length;
    const result = await client.callTool({
      name: alias,
      arguments: { message: "summarise my decks", async: false, ...ask.args },
    });
    const seen = (protocol: string) =>
      booted.loopRuns.slice(before).filter((run) => run.protocol === protocol);
    const expectsReceiver = ask.receiver === true && mode.callable[alias];
    for (let i = 0; expectsReceiver && i < 160; i += 1) {
      if (seen("a2a").length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      isError: result.isError === true,
      text: JSON.stringify(result.content),
      inline: seen("mcp"),
      receiver: seen("a2a"),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

// The in-process task client the hosted MCP route hands `ask_app`, counted so a
// test can tell the local transport from a remote one.
function localTaskClient() {
  const real = booted.mcpConfig!.createLocalAgentTaskClient(
    mockEvent(
      new Request(`${APP_ORIGIN}/_agent-native/mcp`, { method: "POST" }),
    ),
  );
  const calls = { send: 0, getTask: 0 };
  return {
    calls,
    client: {
      send: (...args: Parameters<typeof real.send>) => {
        calls.send += 1;
        return real.send(...args);
      },
      getTask: (...args: Parameters<typeof real.getTask>) => {
        calls.getTask += 1;
        return real.getTask(...args);
      },
    },
  };
}

// A remote app is this plugin's own A2A receiver reached over a stubbed wire:
// the destination still builds its real run options, so a pass cannot come
// from the stub. Only the network and the destination's auth check are faked.
const wire: Array<{ url: string; rpc: string }> = [];

// The async processor handoff is an HMAC-signed POST to the destination's
// _process-task route; the route body is processA2ATaskFromQueue.
const dispatched: string[] = [];

function installProcessorWire() {
  dispatched.length = 0;
  const network = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      dispatched.push(url);
      if (init?.method === "POST" && url.endsWith("/a2a/_process-task")) {
        const { taskId } = JSON.parse(String(init.body));
        await processA2ATaskFromQueue(
          taskId,
          booted.a2aConfig as any,
          mockEvent(new Request(url, { method: "POST" })),
        );
        return new Response(JSON.stringify({ ok: true }));
      }
      return network(input as any, init);
    },
  );
}

function installRemoteWire() {
  wire.length = 0;
  installProcessorWire();
  remote.fetch = async (url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return new Response("", { status: 404 });
    const body = JSON.parse(String(init.body));
    wire.push({ url, rpc: String(body.method) });
    const event = mockEvent(new Request(url, { method: "POST" }));
    event.context = {
      __a2aVerifiedEmail: ALICE,
      __a2aIdentityAssurance: "user",
      __a2aVerifiedOrgId: "acme",
    };
    const response = await handleJsonRpcH3(
      body,
      event,
      booted.a2aConfig as any,
    );
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  vi.spyOn(callerAuth, "resolveA2ACallerAuth").mockResolvedValue({
    apiKey: "signed-org-jwt",
    userEmail: ALICE,
    orgId: "acme",
    orgDomain: "example.com",
    orgSecret: "org-secret",
    metadata: {},
  } as any);
}

function installRemoteApp(resolver: "workspace" | "directory") {
  installRemoteWire();
  vi.spyOn(workspaceResolve, "resolveWorkspace").mockResolvedValue(
    resolver === "workspace"
      ? {
          root: "/workspace",
          isWorkspace: true,
          apps: [
            { id: "calendar", url: REMOTE_ORIGIN, port: 443, running: true },
          ],
        }
      : { root: "/workspace", isWorkspace: false, apps: [] },
  );
  vi.spyOn(orgDirectory, "fetchOrgApps").mockResolvedValue(
    resolver === "directory"
      ? [
          {
            id: "calendar",
            name: "Calendar",
            url: REMOTE_ORIGIN,
            a2aUrl: REMOTE_ORIGIN,
          },
        ]
      : [],
  );
}

const REMOTE_ROUTES = [
  { name: "workspace sibling, durable", resolver: "workspace", durable: true },
  { name: "workspace sibling, direct", resolver: "workspace", durable: false },
  { name: "org directory, durable", resolver: "directory", durable: true },
  { name: "org directory, direct", resolver: "directory", durable: false },
] as const;

let taskCounter = 0;

async function receiveA2A(
  taskId: string,
  metadata: Record<string, unknown> = {},
): Promise<CapturedRun> {
  const before = booted.loopRuns.length;
  taskCounter += 1;
  taskId = `${taskId}-${taskCounter}`;
  let failure: Error | undefined;
  await asAlice(() =>
    booted
      .a2aConfig!.handler(
        { role: "user", parts: [{ type: "text", text: "summarise my decks" }] },
        {
          taskId,
          metadata,
          event: mockEvent(
            new Request("http://localhost/_agent-native/a2a", {
              method: "POST",
            }),
          ),
          writeArtifact: () => "",
        },
      )
      .next()
      .catch((error: Error) => {
        failure = error;
      }),
  );
  const run = booted.loopRuns
    .slice(before)
    .find((captured) => captured.protocol === "a2a");
  if (!run) {
    throw new Error(
      `A2A task ${taskId} never reached the agent loop: ${failure?.message}`,
    );
  }
  return run;
}

interface Surface {
  name: string;
  names: string[];
  factories: Record<string, string[]>;
  configure(): void;
}

const devCwd = mkdtempSync(join(tmpdir(), "delegated-runtime-dev-"));
afterAll(() => rmSync(devCwd, { recursive: true, force: true }));

const SURFACES: Surface[] = [
  {
    name: "production",
    names: RUNTIME_NAMES,
    factories: RUNTIME_BY_FACTORY,
    configure() {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_MODE", "production");
      vi.stubEnv("AGENT_PROD_CODE_EXECUTION", "trusted");
      vi.stubEnv("DEPLOY_PRIME_URL", APP_ORIGIN);
      vi.stubEnv(
        "BETTER_AUTH_SECRET",
        "delegated-runtime-auth-secret-0123456789",
      );
    },
  },
  {
    // The dev toggle registers the filesystem-discovered dev scripts. Its cwd is
    // an empty directory so the plugin cannot import this package's scripts.
    name: "dev",
    names: [
      ...new Set(
        Object.values({ ...RUNTIME_BY_FACTORY, ...DEV_FACTORIES }).flat(),
      ),
    ],
    factories: { ...RUNTIME_BY_FACTORY, ...DEV_FACTORIES },
    configure() {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("AGENT_MODE", undefined);
      vi.spyOn(process, "cwd").mockReturnValue(devCwd);
    },
  },
];

describe.each(SURFACES)("$name surface", (surface) => {
  beforeEach(() => {
    surface.configure();
    vi.stubEnv("A2A_SECRET", "delegated-runtime-a2a-secret");
    activeNames = surface.names;
    booted.handlerOptions.length = 0;
    booted.a2aConfig = undefined;
    booted.mcpConfig = undefined;
    booted.loopRuns.length = 0;
    leaf.reached.length = 0;
  });

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
    remote.fetch = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("takes the runtime inventory from the real factories", async () => {
    await bootRuntime();

    for (const [factory, names] of Object.entries(surface.factories)) {
      expect(leaf.produced.get(factory), factory).toEqual(
        expect.arrayContaining(names),
      );
    }
  });

  describe.each(MODES)("$name catalog", (mode) => {
    if (surface.name === "dev" && mode.bootsInDev === false) {
      it("refuses to boot, loudly, instead of serving a catalog", async () => {
        await expect(
          (async () => {
            await bootRuntime(mode.plugin);
            await askThroughMcp(mode, "ask_app");
          })(),
        ).rejects.toThrow(/list-decks.*not registered or is not exposed/);
      });
      return;
    }

    it("contains ask_app and ask-agent through the configured MCP mount", async () => {
      await bootRuntime(mode.plugin);
      if (mode.env) vi.stubEnv("AGENT_NATIVE_MCP_FULL_CATALOG", "1");

      for (const alias of ["ask_app", "ask-agent"] as const) {
        const outcome = await askThroughMcp(mode, alias);
        expect(
          { alias, reachedAgent: outcome.inline.length > 0 },
          `${mode.name}: ${alias} reachability`,
        ).toEqual({ alias, reachedAgent: mode.callable[alias] });
        if (!outcome.inline.length) {
          expect(outcome.isError, `${alias} refusal`).toBe(true);
          continue;
        }
        await expectContained(outcome.inline[0]!, `${mode.name} ${alias}`);
      }
    }, 240_000);

    it("contains the A2A receiver, selected or not", async () => {
      await bootRuntime(mode.plugin);

      await expectContained(await receiveA2A("task-plain"), `${mode.name} A2A`);
      await expectContained(
        await receiveA2A("task-selected", {
          selectedReceiverApp: "delegated-runtime",
        }),
        `${mode.name} A2A selected receiver`,
      );
    }, 240_000);

    it("contains ask_app routed to this app through the local task client", async () => {
      await bootRuntime(mode.plugin);
      if (mode.env) vi.stubEnv("AGENT_NATIVE_MCP_FULL_CATALOG", "1");

      for (const alias of ["ask_app", "ask-agent"] as const) {
        installProcessorWire();
        const local = localTaskClient();
        const outcome = await askThroughMcp(mode, alias, {
          args: { async: true },
          meta: { origin: APP_ORIGIN, localAgentTaskClient: local.client },
          receiver: true,
        });
        if (!mode.callable[alias]) {
          expect(
            {
              alias,
              refused: outcome.isError,
              localSends: local.calls.send,
              loops: outcome.inline.length + outcome.receiver.length,
            },
            `${mode.name}: ${alias} refusal`,
          ).toEqual({ alias, refused: true, localSends: 0, loops: 0 });
          continue;
        }
        const taken = {
          localSends: local.calls.send,
          inlineLoops: outcome.inline.length,
          receiverLoops: outcome.receiver.length,
          isError: outcome.isError,
          dispatched,
          text: outcome.text.slice(0, 240),
        };
        expect
          .soft(
            taken.localSends === 1 &&
              taken.inlineLoops === 0 &&
              taken.receiverLoops >= 1,
            `${mode.name} ${alias}: route taken ${JSON.stringify(taken)}`,
          )
          .toBe(true);
        if (outcome.receiver[0]) {
          await expectContained(
            outcome.receiver[0],
            `${mode.name} ${alias} local A2A route`,
          );
        }
      }
    }, 240_000);

    describe.each(REMOTE_ROUTES)("remote $name", (route) => {
      it("contains the destination app's receiver", async () => {
        await bootRuntime(mode.plugin);
        installRemoteApp(route.resolver);
        const local = localTaskClient();
        const outcome = await askThroughMcp(mode, "ask_app", {
          args: { app: "calendar", async: true },
          receiver: true,
          meta: route.durable
            ? { origin: APP_ORIGIN, localAgentTaskClient: local.client }
            : {},
        });
        if (!mode.callable.ask_app) {
          expect(
            { refused: outcome.isError, wire: wire.length },
            `${mode.name}: ask_app refusal`,
          ).toEqual({ refused: true, wire: 0 });
          return;
        }
        const destinations = [
          ...new Set(wire.map((entry) => new URL(entry.url).origin)),
        ];
        const taken = {
          destinations,
          rpcs: wire.map((entry) => entry.rpc),
          localSends: local.calls.send,
          inlineLoops: outcome.inline.length,
          receiverLoops: outcome.receiver.length,
          isError: outcome.isError,
          text: outcome.text.slice(0, 240),
        };
        expect
          .soft(
            taken.destinations.length === 1 &&
              taken.destinations[0] === REMOTE_ORIGIN &&
              taken.localSends === 0 &&
              taken.inlineLoops === 0 &&
              taken.receiverLoops >= 1,
            `${mode.name} ${route.name}: route taken ${JSON.stringify(taken)}`,
          )
          .toBe(true);
        if (outcome.receiver[0]) {
          await expectContained(
            outcome.receiver[0],
            `${mode.name} remote ${route.name}`,
          );
        }
      }, 240_000);
    });
  });

  it("keeps every runtime tool reachable in the in-app agent", async () => {
    await bootRuntime();
    const options =
      booted.handlerOptions.find((candidate) =>
        surface.names.every((name) => name in candidate.actions),
      ) ?? booted.handlerOptions[0]!;
    const tools = actionsToEngineTools(options.actions);

    const inApp = await probeSurface({ actions: options.actions, tools });
    expect(
      surface.names.filter((name) => !inApp.registered.includes(name)),
      "not registered in-app",
    ).toEqual([]);
    expect(
      surface.names.filter(
        (name) =>
          name !== "workspace-files" &&
          !inApp.firstRequest.includes(name) &&
          !inApp.discoverable.includes(name),
      ),
      "neither offered nor discoverable in-app",
    ).toEqual([]);

    const attack = await replayAttack({
      actions: options.actions,
      tools,
      availableTools: tools,
      systemPrompt: "in-app",
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      ownerEmail: ALICE,
      orgId: "acme",
      executionMode: "act",
      runId: "in-app-control",
      threadId: "in-app-control",
      turnId: "in-app-control",
    });
    const missed = surface.names
      .filter((name) => !attack.reached.includes(name))
      .map((name) => [name, attack.outcomes.get(name)!.seen.slice(0, 160)]);
    expect(missed, "in-app tools the loop did not run").toEqual([]);
  }, 240_000);

  it("keeps the static docs reader isolated from personal, workspace, and memory resources", async () => {
    const paths = [
      "memory/private.md",
      "skills/private/SKILL.md",
      "context/private.md",
    ];
    for (const owner of [
      ALICE,
      "__shared__",
      "__workspace__:__organization__:acme",
    ]) {
      for (const path of paths) {
        await asAlice(() =>
          resourcePut(owner, path, "PRIVATE_RESOURCE_CORPUS_SENTINEL"),
        );
      }
    }
    await bootRuntime();
    const run = await receiveA2A("static-reader");
    const docs = run.runOptions.actions["docs-search"] as ActionEntry;
    expect(docs.readOnly).toBe(true);
    for (const slug of [
      ...paths,
      "../memory/private.md",
      "agents-personal",
      "skill-private",
    ]) {
      const result = String(await asAlice(() => docs.run({ slug })));
      expect(result).toContain(`Doc not found: ${slug}`);
      expect(result).not.toContain("PRIVATE_RESOURCE_CORPUS_SENTINEL");
    }
    const queried = String(
      await asAlice(() =>
        docs.run({ query: "PRIVATE_RESOURCE_CORPUS_SENTINEL" }),
      ),
    );
    expect(queried).toContain(
      'No docs found matching "PRIVATE_RESOURCE_CORPUS_SENTINEL".',
    );
  });

  describe("ordinary in-app automation", () => {
    async function inAppRun(nativeActionsInDev = false) {
      await bootRuntime({ mcp: { enabled: true }, nativeActionsInDev });
      const options =
        booted.handlerOptions.find((candidate) =>
          surface.names.every((name) => name in candidate.actions),
        ) ?? booted.handlerOptions[0]!;
      const tools = actionsToEngineTools(options.actions);
      return {
        actions: options.actions as Record<string, ActionEntry>,
        tools,
        availableTools: tools,
        systemPrompt: "in-app",
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        ownerEmail: ALICE,
        orgId: "acme",
        executionMode: "act",
        runId: "in-app-automation",
        threadId: "in-app-automation",
        turnId: "in-app-automation",
      };
    }

    it("is created without approval and stored unmarked, with call-agent kept", async () => {
      const run = await inAppRun();
      const input = defineInput();
      const outcome = await callOnce(run, "manage-automations", input);
      const stored = await storedAutomation(input.name);
      expect({
        approval: outcome.approval,
        created: stored !== null,
        marked: stored?.meta.mcpManaged === true,
        callAgent: "call-agent" in run.actions,
      }).toEqual({
        approval: false,
        created: true,
        marked: false,
        callAgent: true,
      });
    }, 240_000);

    it("keeps an in-app tool caller outside the outside-call approval policy", async () => {
      const run = await inAppRun(true);
      const result = await callOnce(run, "outside-policy-probe", {});
      expect(result).toMatchObject({
        available: true,
        approval: false,
        result: "app policy admitted",
      });
      expect(policyContexts.at(-1)).toEqual({
        caller: "tool",
        protocol: undefined,
        networkId: undefined,
        outside: false,
      });
    });

    it("reaches attach-call-evidence through the real call-agent and receiver without approval", async () => {
      const run = await inAppRun();
      installRemoteApp("workspace");
      const realRun = leaf.real.get("call-agent")!;
      const actions = {
        ...run.actions,
        "call-agent": { ...run.actions["call-agent"]!, run: realRun },
      } as Record<string, ActionEntry>;
      const before = booted.loopRuns.length;

      const call = await callOnce({ ...run, actions }, "call-agent", {
        agent: "calendar",
        message: "attach the call evidence",
      });
      const receiver = booted.loopRuns
        .slice(before)
        .find((captured) => captured.protocol === "a2a");
      expect(
        {
          receiverReached: receiver !== undefined,
          wire: wire.map((entry) => entry.rpc),
          call: call.result.slice(0, 200),
        },
        "call-agent reached the destination receiver",
      ).toMatchObject({ receiverReached: true });

      leaf.reached.length = 0;
      const attach = await callOnce(
        receiver!.runOptions,
        "attach-call-evidence",
        CRM_ATTACH_ARGS,
      );
      expect({
        available: attach.available,
        approval: attach.approval,
        reached: leaf.reached.includes("attach-call-evidence"),
      }).toEqual({ available: true, approval: false, reached: true });
    }, 240_000);

    it("runs through the real background runner and attaches evidence without approval", async () => {
      const run = await inAppRun();
      installRemoteApp("workspace");
      const actions = {
        ...run.actions,
        "call-agent": {
          ...run.actions["call-agent"]!,
          run: leaf.real.get("call-agent")!,
        },
      } as Record<string, ActionEntry>;
      const input = defineInput();
      await callOnce(run, "manage-automations", input);
      const stored = await storedAutomation(input.name);
      expect(stored, "automation stored by the in-app define").not.toBeNull();
      const before = booted.loopRuns.length;
      let toolResult = "";

      // The destination's model is out of scope, so its receiver loop stops at the
      // capture and the run ends without a confirmed action; that failure is the
      // stub's, and the run is judged by what its call-agent reached.
      const outcome = await asAlice(() =>
        runBackgroundAutomation(
          {
            automation: {
              name: input.name,
              meta: stored!.meta,
              body: stored!.body,
              resource: stored!.resource,
            },
            ownerEmail: ALICE,
            orgId: "acme",
            prompt: stored!.body,
            threadTitle: "automation",
            runIdPrefix: "automation",
            usageLabel: "automation",
            manual: true,
          },
          {
            getActions: async () => actions,
            getSystemPrompt: async () => "automation",
            engine: scriptedEngine(
              "call-agent",
              { agent: "calendar", message: "attach the call evidence" },
              (value) => {
                toolResult = value;
              },
            ) as any,
            model: "caller-model",
            apiKey: "unused",
            appId: "delegated-runtime",
          },
        ),
      ).catch((error: Error) => error);
      const receiver = booted.loopRuns
        .slice(before)
        .find((captured) => captured.protocol === "a2a");
      expect(
        {
          ran: outcome instanceof Error ? outcome.message.slice(0, 120) : "ok",
          receiverReached: receiver !== undefined,
          wire: wire.map((entry) => entry.rpc),
          toolResult: toolResult.slice(0, 200),
        },
        "the run's call-agent reached the destination receiver",
      ).toMatchObject({ receiverReached: true });

      leaf.reached.length = 0;
      const attach = await callOnce(
        receiver!.runOptions,
        "attach-call-evidence",
        CRM_ATTACH_ARGS,
      );
      expect({
        marked: stored!.meta.mcpManaged === true,
        approval: attach.approval,
        reached: leaf.reached.includes("attach-call-evidence"),
      }).toEqual({ marked: false, approval: false, reached: true });
    }, 240_000);
  });
});
