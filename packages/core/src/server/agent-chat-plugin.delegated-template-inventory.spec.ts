import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { pathToFileURL } from "node:url";

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
  // What each delegated run's registry held before filterDelegatedRegistry.
  filterInputs: [] as Array<Record<string, any>>,
  plugins: new Map<string, (nitroApp: unknown) => void>(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const { createAgentChatPlugin } = await import("./agent-chat-plugin.js");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    createAgentChatPlugin: (options: Record<string, unknown>) => {
      const plugin = createAgentChatPlugin(options as never);
      booted.plugins.set(String(options.appId), plugin as never);
      return plugin;
    },
  };
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
    filterDelegatedRegistry: (actions: Record<string, any>) => {
      booted.filterInputs.push({ ...actions });
      return actual.filterDelegatedRegistry(actions);
    },
    runA2AAgentLoop: capture("a2a"),
    runMCPAgentLoop: capture("mcp"),
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

vi.mock("@agent-native/core/mcp", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

vi.mock("../integrations/plugin.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../integrations/plugin.js")>()),
  defaultIntegrationsPlugin: () => {},
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

// Lab-gated actions are advertised once a user enables the lab; treat every lab
// as enabled so the inventory covers them, as the catalog harness does.
vi.mock("@agent-native/core/labs/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserLabEnabled: vi.fn(async () => true),
}));

import { runAgentLoop, type ActionEntry } from "../agent/production-agent.js";
import {
  hasRawQueryInput,
  isFrameworkRuntimeAction,
} from "../mcp/action-eligibility.js";
import {
  assertCoreActionLoadersAreValid,
  loadActionsStrictly,
  repoRoot,
  templateIdsWithAgentChat,
} from "../mcp/advertised-catalog.harness.js";
import { createMCPServerForRequest } from "../mcp/build-server.js";
import { isFrameworkMcpTool } from "../mcp/framework-tools.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import { runWithRequestContext } from "./request-context.js";

const ALICE = "alice@example.com";
const IDENTITY = {
  userEmail: ALICE,
  orgDomain: undefined,
  orgId: null,
  oauthScopes: ["mcp:read", "mcp:write"],
};
const APP_ORIGIN = "https://delegated-inventory.example.com";

// Analytics actions that opt out of direct MCP (`mcpTool: false`) but that its
// MCP instructions send callers to through `ask_app`.
const ANALYTICS_KEYS = [
  "bigquery",
  "search-bigquery-schema",
  "query-agent-native-analytics",
];

interface SurfaceConfig {
  name: string;
  configure(): void;
}

const SURFACES: SurfaceConfig[] = [
  {
    name: "production",
    configure() {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_MODE", "production");
      vi.stubEnv("AGENT_PROD_CODE_EXECUTION", "trusted");
      vi.stubEnv("DEPLOY_PRIME_URL", APP_ORIGIN);
      vi.stubEnv("BETTER_AUTH_SECRET", "delegated-inventory-auth-0123456789");
      vi.spyOn(process, "cwd").mockReturnValue(devCwd);
    },
  },
  {
    name: "dev",
    configure() {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("AGENT_MODE", undefined);
      vi.spyOn(process, "cwd").mockReturnValue(devCwd);
    },
  },
];

// Both surfaces boot from an empty folder, as
// agent-chat-plugin.delegated-runtime.spec.ts does. A dev server wraps every
// loose file in the app's own scripts/ folder, and a CLI script there runs (and
// closes the shared test database) when imported; and from a template folder
// inside this monorepo `ask_app` resolves a multi-app workspace and routes to a
// hosted peer instead of running inline. The registries the template declares
// come from its plugin options, not the folder. The cost: a dev server's
// loose-script tools (a template's own scripts/ folder, coding factories) are
// not in these registries; delegated-runtime.spec.ts covers the real coding
// factories.
const devCwd = mkdtempSync(join(tmpdir(), "delegated-inventory-dev-"));
afterAll(() => rmSync(devCwd, { recursive: true, force: true }));

const results: Record<string, any> = {};

function asAlice<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: ALICE, orgId: "acme" }, run);
}

function removalReason(name: string, entry: ActionEntry): string {
  if (isFrameworkMcpTool(entry)) return "marked-framework-not-allowlisted";
  if (entry.cliWrapper === true) return "cli-wrapper";
  const prefix = /^(?:db-|provider-api-|seed-)/i.exec(name);
  if (prefix) return `explicit-prefix:${prefix[0].toLowerCase()}`;
  return "hard-runtime-name";
}

function describeRun(
  before: Record<string, ActionEntry>,
  runOptions: any,
  templateNames: ReadonlySet<string>,
) {
  const after = Object.keys(runOptions.actions as object).sort();
  // tool-search attaches after the filter, so it is part of both registries.
  const beforeNames = [
    ...new Set([...Object.keys(before), "tool-search"]),
  ].sort();
  const removed = beforeNames
    .filter((name) => !after.includes(name))
    .map((name) => ({
      name,
      reason: removalReason(name, before[name]!),
      templateAction: templateNames.has(name),
    }));
  const added = after.filter((name) => !beforeNames.includes(name));
  return {
    before: beforeNames,
    after,
    removed,
    added,
    firstRequest: (runOptions.tools as Array<{ name: string }>)
      .map((tool) => tool.name)
      .sort(),
    availableTools: (
      (runOptions.availableTools ?? runOptions.tools) as Array<{ name: string }>
    )
      .map((tool) => tool.name)
      .sort(),
  };
}

// One scripted model turn that calls one tool through the real loop.
async function dispatchOnce(
  runOptions: any,
  name: string,
  input: Record<string, unknown>,
) {
  const entry = runOptions.actions[name] as ActionEntry | undefined;
  if (!entry) return { available: false, reached: false, approval: false };
  let reached = false;
  const actions = {
    ...runOptions.actions,
    [name]: {
      ...entry,
      run: async () => {
        reached = true;
        return `leaf-reached:${name}`;
      },
    },
  };
  let turn = 0;
  const approvals: string[] = [];
  const engine = {
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
    async *stream() {
      turn += 1;
      const parts =
        turn === 1
          ? [{ type: "tool-call" as const, id: "call-once", name, input }]
          : [{ type: "text" as const, text: "done" }];
      yield { type: "assistant-content", parts };
      yield { type: "stop", reason: turn === 1 ? "tool_use" : "end_turn" };
    },
  };
  await asAlice(() =>
    runAgentLoop({
      ...runOptions,
      actions,
      messages: structuredClone(runOptions.messages),
      engine: engine as any,
      model: "caller-model",
      send: (event: any) => {
        if (event.type === "approval_required") approvals.push(event.tool);
      },
      signal: new AbortController().signal,
      runId: `dispatch-${name}`,
      threadId: `dispatch-${name}`,
      turnId: `dispatch-${name}`,
    }),
  );
  return { available: true, reached, approval: approvals.includes(name) };
}

const RAW_FIELD_NAMES = new Set(["sql", "code", "script", "expression"]);

interface RawField {
  path: string;
  // The field's JSON-schema type, so a boolean style flag or a closed enum named
  // `script` or `code` is told apart from a free-form string a caller can fill.
  type: string;
}

function schemaTypeOf(schema: any): string {
  if (!schema || typeof schema !== "object") return "unknown";
  if (Array.isArray(schema.enum)) return "enum";
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) return schema.type.join("|");
  return schema.anyOf || schema.oneOf ? "union" : "unknown";
}

// Every property named like a raw query field, at any depth of the JSON schema.
function rawFieldsDeep(schema: unknown, trail = ""): RawField[] {
  if (!schema || typeof schema !== "object") return [];
  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) =>
      rawFieldsDeep(item, `${trail}[${index}]`),
    );
  }
  const found: RawField[] = [];
  for (const [key, value] of Object.entries(
    schema as Record<string, unknown>,
  )) {
    if (key === "properties" && value && typeof value === "object") {
      for (const [field, child] of Object.entries(value)) {
        const here = trail ? `${trail}.${field}` : field;
        if (RAW_FIELD_NAMES.has(field.toLowerCase())) {
          found.push({ path: here, type: schemaTypeOf(child) });
        }
        found.push(...rawFieldsDeep(child, here));
      }
    } else {
      found.push(...rawFieldsDeep(value, trail));
    }
  }
  return [
    ...new Map(
      found.map((field) => [`${field.path}:${field.type}`, field]),
    ).values(),
  ];
}

function syntheticInput(entry: ActionEntry): Record<string, unknown> {
  const schema: any = entry.tool?.parameters ?? {};
  const input: Record<string, unknown> = {};
  for (const field of schema.required ?? []) {
    const property = schema.properties?.[field] ?? {};
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

async function proveKeys(runOptions: any, keys: string[]) {
  const proof: Record<string, any> = {};
  for (const key of keys) {
    const found: any = runOptions.actions["tool-search"]
      ? await asAlice(() =>
          runOptions.actions["tool-search"].run({ names: [key], limit: 5 }),
        )
      : { results: [] };
    const entry = runOptions.actions[key] as ActionEntry | undefined;
    proof[key] = {
      registered: entry !== undefined,
      firstRequest: runOptions.tools.some((tool: any) => tool.name === key),
      availableTools: (runOptions.availableTools ?? runOptions.tools).some(
        (tool: any) => tool.name === key,
      ),
      toolSearchCallable: (found.results ?? []).some(
        (result: any) => result.name === key && result.callable,
      ),
      dispatch: entry
        ? await dispatchOnce(runOptions, key, syntheticInput(entry))
        : { available: false, reached: false, approval: false },
    };
  }
  return proof;
}

async function askMcp(
  alias: "ask_app" | "ask-agent",
  fullCatalog: boolean,
): Promise<
  | { absent: true; advertised: number }
  | { absent: false; before: number; error: boolean; text: string }
> {
  const server = await createMCPServerForRequest(
    booted.mcpConfig as any,
    IDENTITY,
    {
      transport: "http",
      inlineMcpApps: false,
      ...(fullCatalog ? { fullCatalog: true } : {}),
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "delegated-inventory", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  try {
    const tools = (await client.listTools()).tools;
    if (!tools.some((tool) => tool.name === alias)) {
      return { absent: true, advertised: tools.length };
    }
    const before = booted.loopRuns.length;
    const result = await client.callTool({
      name: alias,
      arguments: { message: "summarise my work", async: false },
    });
    return {
      absent: false,
      before,
      error: result.isError === true,
      text: JSON.stringify(result.content).slice(0, 160),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

async function receiveA2A(taskId: string) {
  const before = booted.loopRuns.length;
  await asAlice(() =>
    booted
      .a2aConfig!.handler(
        { role: "user", parts: [{ type: "text", text: "summarise my work" }] },
        {
          taskId,
          metadata: {},
          event: mockEvent(
            new Request("http://localhost/_agent-native/a2a", {
              method: "POST",
            }),
          ),
          writeArtifact: () => "",
        },
      )
      .next()
      .catch(() => undefined),
  );
  return before;
}

const closers: Array<() => void | Promise<void>> = [];

async function bootPlugin(appId: string, projectRoot: string) {
  booted.handlerOptions.length = 0;
  booted.a2aConfig = undefined;
  booted.mcpConfig = undefined;
  booted.loopRuns.length = 0;
  booted.filterInputs.length = 0;
  const nitroApp = {
    h3App: createApp(),
    h3: { "~middleware": [] },
    hooks: {
      hook(name: string, callback: () => void | Promise<void>) {
        if (name === "close") closers.push(callback);
      },
      callHook: async () => {},
    },
  };
  // Skills that require a lab read the registry the template's own labs
  // plugin fills, which this harness does not otherwise run.
  const labsPath = path.join(projectRoot, "server/plugins/labs.ts");
  if (fs.existsSync(labsPath)) {
    const { default: registerTemplateLabs } = await import(
      pathToFileURL(labsPath).href
    );
    await registerTemplateLabs(nitroApp);
  }
  const initsBefore = booted.initPromises.length;
  booted.plugins.get(appId)!(nitroApp);
  const init = booted.initPromises[initsBefore];
  if (!init) throw new Error(`${appId}: the plugin did not start init.`);
  await init;
  let ownMcpMount = false;
  if (!booted.mcpConfig) {
    const ownMountPath = path.join(projectRoot, "server/plugins/00-mcp.ts");
    if (fs.existsSync(ownMountPath)) {
      ownMcpMount = true;
      const { default: mountOwnMcp } = await import(
        pathToFileURL(ownMountPath).href
      );
      mountOwnMcp(nitroApp);
    }
  }
  return { ownMcpMount };
}

const allTemplateIds = templateIdsWithAgentChat();

// Two uses, one file.
//
// Ordinary CI runs the default: Analytics, on the production and dev surfaces,
// through the real plugin, asserting its `mcpTool:false` key actions stay
// reachable through A2A and `ask_app` after the delegated filter.
//
// The 17-template audit behind docs/security/delegated-framework-registry-diff.md
// is opt-in: INVENTORY_TEMPLATES=<id>[,<id>...] selects exact templates and
// INVENTORY_OUT=<file.json> names where the by-name results are merged. It must
// run one template per process. A template that imports a package (Dispatch,
// creative-context) registers that package's actions on a process-wide registry
// (action-discovery.ts, getPackageActionRegistry), and every later boot in the
// same process merges them in: Brain alone has 229 delegated actions, 262 after
// Analytics and Assets ran first, and templates after Dispatch route `ask_app`
// to Dispatch's gateway. The registry is production code and is left as is; this
// file only avoids sharing a process. .tmp/run-each.sh drives the audit.
function selectedTemplateIds(): string[] {
  const raw = process.env.INVENTORY_TEMPLATES;
  if (raw === undefined) return ["analytics"];
  const names = raw.split(",").map((name) => name.trim());
  if (names.some((name) => name === "")) {
    throw new Error(
      `INVENTORY_TEMPLATES must be a comma-separated list of template ids, got "${raw}".`,
    );
  }
  const unknown = names.filter((name) => !allTemplateIds.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `INVENTORY_TEMPLATES names no agent-chat template: ${unknown.join(", ")}. Known: ${allTemplateIds.join(", ")}.`,
    );
  }
  return [...new Set(names)];
}

const templateIds = selectedTemplateIds();
const outputFile = process.env.INVENTORY_OUT
  ? path.resolve(repoRoot, process.env.INVENTORY_OUT)
  : undefined;
if (process.env.INVENTORY_OUT !== undefined && !outputFile) {
  throw new Error("INVENTORY_OUT is set but empty.");
}

afterAll(() => {
  if (!outputFile) return;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const previous = fs.existsSync(outputFile)
    ? JSON.parse(fs.readFileSync(outputFile, "utf8"))
    : {};
  fs.writeFileSync(
    outputFile,
    `${JSON.stringify({ ...previous, ...results }, null, 2)}
`,
  );
});

// A template's plugin and imports may set process.env (a workspace marker, a
// hosted credential); restore it so one template's boot cannot change how the
// next one routes `ask_app`.
let envBefore: NodeJS.ProcessEnv = {};
beforeEach(() => {
  envBefore = { ...process.env };
});

afterEach(async () => {
  // The plugins' real close hooks run after every boot. A failed one fails
  // the test: a leaked cleanup is not a clean teardown.
  const closed = await Promise.allSettled(
    closers.splice(0).map((close) => close()),
  );
  const failed = closed.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  for (const key of Object.keys(process.env)) {
    if (!(key in envBefore)) delete process.env[key]; // guard:allow-env-mutation — restoring a test's own process.env changes
  }
  Object.assign(process.env, envBefore); // guard:allow-env-mutation — restoring a test's own process.env changes
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (failed.length > 0) {
    throw new AggregateError(
      failed.map((result) => result.reason),
      "a plugin close hook failed",
    );
  }
});

describe("delegated registry inventory, real template plugins", () => {
  it("loads every framework loader before inventorying", async () => {
    await assertCoreActionLoadersAreValid();
    expect(allTemplateIds.length).toBeGreaterThan(10);
    expect(templateIds.length).toBeGreaterThan(0);
  }, 120_000);

  describe.each(templateIds)("%s", (appId) => {
    it.each(SURFACES)(
      "captures main and companion registries on $name",
      async (surface) => {
        const projectRoot = path.join(repoRoot, "templates", appId);
        generateActionRegistryForProject(projectRoot);
        const registry = await import(
          pathToFileURL(
            path.join(projectRoot, ".generated/actions-registry.ts"),
          ).href
        );
        const templateActions = loadActionsStrictly(appId, registry.default);
        const generatedNames = Object.keys(templateActions);
        await import(
          pathToFileURL(path.join(projectRoot, "server/plugins/agent-chat.ts"))
            .href
        );
        surface.configure();
        vi.stubEnv("A2A_SECRET", "delegated-inventory-a2a-secret");

        const { ownMcpMount } = await bootPlugin(appId, projectRoot);
        // The in-app agent is the control: the registry the app's own chat has.
        const inAppEntries: Record<string, ActionEntry> = booted.handlerOptions
          .map((options) => options.actions ?? {})
          .reduce(
            (largest, actions) =>
              Object.keys(actions).length > Object.keys(largest).length
                ? actions
                : largest,
            {} as Record<string, ActionEntry>,
          );
        const inApp = Object.keys(inAppEntries).sort();
        // Ownership comes from the entry the app serves, not from the generated
        // registry or the actions folder: a file there that the app's plugin never
        // registers is not served, and a name the app serves as a framework twin
        // (marked, filling a hole) is the framework's, not the template's.
        const templateNames = new Set(
          generatedNames.filter((name) => {
            const served = inAppEntries[name];
            return (
              !served ||
              (!isFrameworkMcpTool(served) && served.cliWrapper !== true)
            );
          }),
        );
        const inAppTemplate = inApp.filter((name) => templateNames.has(name));

        const runs: Record<string, any> = {};
        const record = (
          label: string,
          startedAt: number,
          filterStart: number,
        ) => {
          const run = booted.loopRuns[startedAt];
          if (!run) {
            runs[label] = { reachedLoop: false };
            return undefined;
          }
          runs[label] = {
            reachedLoop: true,
            ...describeRun(
              booted.filterInputs[filterStart] ?? {},
              run.runOptions,
              templateNames,
            ),
          };
          return run.runOptions;
        };

        const optionsByRun: Record<string, any> = {};
        if (booted.a2aConfig) {
          const loopStart = booted.loopRuns.length;
          const filterStart = booted.filterInputs.length;
          await receiveA2A(`inventory-${appId}-${surface.name}-a2a`);
          optionsByRun.a2a = record("a2a receiver", loopStart, filterStart);
        } else {
          runs["a2a receiver"] = { absent: true };
        }
        for (const [label, alias, full] of [
          ["mcp ask_app (default catalog)", "ask_app", false],
          ["mcp ask-agent (full catalog)", "ask-agent", true],
        ] as const) {
          const loopStart = booted.loopRuns.length;
          const filterStart = booted.filterInputs.length;
          const asked = booted.mcpConfig
            ? await askMcp(alias, full)
            : ({ absent: true, advertised: 0 } as const);
          if (asked.absent) {
            runs[label] = {
              absent: true,
              reason: booted.mcpConfig
                ? `not advertised (${asked.advertised} tools listed)`
                : "no MCP mount",
            };
            continue;
          }
          const options = record(label, loopStart, filterStart);
          if (!options) {
            runs[label].callResult = asked;
            // Dispatch registers its own `ask_app` action, a gateway to the apps
            // granted to it that requires `app`; `ask-agent` is its way in.
            runs[label].blocked = /does not expose an agent/.test(asked.text)
              ? "app exposes no agent handler"
              : alias === "ask_app" &&
                  /Missing required parameter: app/.test(asked.text)
                ? "ask_app is the app's own gateway action"
                : "UNEXPLAINED";
          }
          optionsByRun[label] = options;
        }

        // A run that never reached the loop is a gap in this inventory, not an
        // empty registry; only the two documented app-specific cases below may skip one.
        expect(
          Object.entries(runs)
            .filter(
              ([, run]) =>
                run.reachedLoop === false &&
                (run.blocked === undefined || run.blocked === "UNEXPLAINED"),
            )
            .map(([label, run]) => [
              label,
              run.callResult?.text ?? "never reached",
            ]),
          `${appId}/${surface.name}: runs that did not reach the agent loop`,
        ).toEqual([]);

        // A template action the in-app agent has, left out of a delegated run.
        for (const [label, run] of Object.entries(runs)) {
          if (!run.reachedLoop) continue;
          run.templateMissingVsInApp = inAppTemplate.filter(
            (name) => !run.after.includes(name),
          );
          run.templateMissingVsMain = inAppTemplate.filter(
            (name) => run.before.includes(name) && !run.after.includes(name),
          );
          run.templateRetained = inAppTemplate.filter((name) =>
            run.after.includes(name),
          ).length;
          expect(
            run.after.filter((name: string) => !run.before.includes(name)),
            `${appId}/${surface.name}/${label}: the filter only removes`,
          ).toEqual([]);
        }

        const ownActions = Object.entries(templateActions).filter(([name]) =>
          templateNames.has(name),
        );
        const rawInput = ownActions
          .map(([name, entry]) => ({
            name,
            entry,
            rawFields: rawFieldsDeep(entry.tool?.parameters),
          }))
          .filter(({ rawFields }) => rawFields.length > 0)
          .map(({ name, entry, rawFields }) => ({
            name,
            rawFields,
            // The framework's own check reads top-level properties only; a
            // field reachable only through a union or nested object is listed
            // so it is not read as "no raw input".
            topLevelRaw: hasRawQueryInput(entry),
            mcpTool: entry.mcpTool ?? null,
            readOnly: entry.readOnly === true,
            agentTool: entry.agentTool ?? null,
            inApp: inApp.includes(name),
            allowRawQueryInput: entry.publicAgent?.allowRawQueryInput === true,
            frameworkRuntime: isFrameworkRuntimeAction(name, entry),
          }));
        const mcpToolFalse = ownActions
          .filter(([, entry]) => entry.mcpTool === false)
          .map(([name, entry]) => ({
            name,
            inApp: inApp.includes(name),
            inMainDelegated: Object.values(runs).every(
              (run) => !run.reachedLoop || run.before.includes(name),
            ),
            inCompanionDelegated: Object.values(runs).every(
              (run) => !run.reachedLoop || run.after.includes(name),
            ),
            agentTool: entry.agentTool ?? null,
            readOnly: entry.readOnly === true,
          }));

        const keyProof: Record<string, any> = {};
        if (appId === "analytics") {
          for (const [label, options] of Object.entries(optionsByRun)) {
            if (options)
              keyProof[label] = await proveKeys(options, ANALYTICS_KEYS);
          }
        }

        results[`${appId}:${surface.name}`] = {
          appId,
          surface: surface.name,
          ownMcpMount,
          a2aMounted: booted.a2aConfig !== undefined,
          mcpMounted: booted.mcpConfig !== undefined,
          templateActionCount: templateNames.size,
          inAppActionCount: inApp.length,
          inApp,
          inAppTemplateActionCount: inAppTemplate.length,
          inAppHandlerCount: booted.handlerOptions.length,
          mcpToolFalse,
          rawInput,
          runs,
          keyProof,
        };

        if (appId === "analytics") {
          expect(
            Object.keys(keyProof),
            `analytics ${surface.name}: runs that reached the loop`,
          ).toEqual(
            expect.arrayContaining(["a2a", "mcp ask_app (default catalog)"]),
          );
        }
        for (const proof of Object.values(keyProof)) {
          for (const key of ANALYTICS_KEYS) {
            expect(
              proof[key],
              `analytics ${surface.name} ${key}`,
            ).toMatchObject({
              registered: true,
              availableTools: true,
              dispatch: { available: true, reached: true, approval: false },
            });
            expect(
              proof[key].firstRequest || proof[key].toolSearchCallable,
              `analytics ${surface.name} ${key} offered or discoverable`,
            ).toBe(true);
          }
        }
      },
      600_000,
    );
  });
});
