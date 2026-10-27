import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const booted = vi.hoisted(() => ({
  routes: [] as Array<{ path: string; handler: (event: any) => unknown }>,
  a2aConfig: undefined as Record<string, any> | undefined,
  initPromises: [] as Promise<void>[],
}));

const session = vi.hoisted(() => ({
  email: "alice@example.com",
  orgId: "acme",
}));

// Only the HTTP mount is replaced: routes register on a plain list so the test
// can invoke the approval route the real `mountA2A` installs.
vi.mock("./framework-request-handler.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./framework-request-handler.js")>()),
  awaitBootstrap: () => Promise.resolve(),
  getH3App: () => ({
    use: (path: unknown, handler: (event: any) => unknown) => {
      if (typeof path === "string") booted.routes.push({ path, handler });
    },
  }),
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: (_nitroApp: any, promise: Promise<void>) => {
    booted.initPromises.push(promise);
  },
}));

vi.mock("../a2a/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../a2a/server.js")>();
  return {
    ...actual,
    mountA2A: (nitroApp: unknown, config: any, ...rest: any[]) => {
      booted.a2aConfig = config;
      return (actual.mountA2A as any)(nitroApp, config, ...rest);
    },
  };
});

vi.mock("../mcp/server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp/server.js")>()),
  mountMCP: () => {},
}));

// The owner's live browser session is the one input the approval route reads
// from the web layer.
vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getSession: async () => ({
    email: session.email,
    orgId: session.orgId,
    token: "approval-session",
  }),
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

import { handleJsonRpcH3, processA2ATaskFromQueue } from "../a2a/handlers.js";
import { A2A_ORG_ID_OWNER_SCOPE_PREFIX, getTask } from "../a2a/task-store.js";
import { actionArgumentsHash } from "../action-arguments-identity.js";
import { approvalKeyWithArguments } from "../agent/approval-key.js";
import { toolCallCacheKey } from "../agent/production-agent.js";
import { ensureRunTables } from "../agent/run-store.js";
import { getDbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migrations.js";
import { parseJobResource } from "../jobs/frontmatter.js";
import { orgStore } from "../org/schema-store.js";
import { resourceGet, resourceList } from "../resources/store.js";
import { createAgentChatPlugin } from "./agent-chat-plugin.js";

const ALICE = "alice@example.com";
const ORG = "acme";
const APP_ORIGIN = "https://automation-approval.example.com";
const CALL_ID = "call-once";

const closers: Array<() => void | Promise<void>> = [];
const processing: Promise<void>[] = [];

// A model that makes one `manage-automations` define call and ends.
function scriptedEngine(input: Record<string, unknown>) {
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
    async *stream() {
      turn += 1;
      const parts =
        turn === 1
          ? [
              {
                type: "tool-call" as const,
                id: CALL_ID,
                name: "manage-automations",
                input,
              },
            ]
          : [{ type: "text" as const, text: "done" }];
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: turn === 1 ? "tool_use" : "end_turn",
      };
    },
  };
}

async function bootReceiver(defineInput: Record<string, unknown>) {
  booted.routes.length = 0;
  booted.a2aConfig = undefined;
  const nitroApp = {
    hooks: {
      hook(name: string, callback: () => void | Promise<void>) {
        if (name === "close") closers.push(callback);
      },
    },
  };
  createAgentChatPlugin({
    appId: "automation-approval",
    actions: () => ({}),
    engine: scriptedEngine(defineInput) as any,
  })(nitroApp);
  await booted.initPromises.at(-1);
  if (!booted.a2aConfig) throw new Error("the plugin never mounted A2A");
  return booted.a2aConfig;
}

// The organization and membership the receiver's identity names, so the org
// binding under test rests on real rows instead of an unknown org.
async function seedOrganization() {
  const db = getDbExec();
  await db.execute({
    sql: `INSERT INTO organizations (id, name, created_by, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    args: [ORG, "Automation approval fixture", ALICE, Date.now()],
  });
  await db.execute({
    sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    args: [`${ORG}:${ALICE}`, ORG, ALICE, "owner", Date.now()],
  });
}

// The async processor handoff is an HMAC-signed POST to `_process-task`; the
// route body is `processA2ATaskFromQueue`, so the stubbed wire runs it for real.
function installProcessorWire(config: Record<string, any>) {
  const network = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (init?.method === "POST" && url.endsWith("/a2a/_process-task")) {
        const { taskId } = JSON.parse(String(init.body));
        const run = processA2ATaskFromQueue(
          taskId,
          config as any,
          mockEvent(new Request(url, { method: "POST" })),
        );
        processing.push(run);
        await run;
        return new Response(JSON.stringify({ ok: true }));
      }
      return network(input as any, init);
    },
  );
}

async function sendAsAlice(config: Record<string, any>): Promise<string> {
  const event = mockEvent(
    new Request(`${APP_ORIGIN}/_agent-native/a2a`, { method: "POST" }),
  );
  event.context = {
    __a2aVerifiedEmail: ALICE,
    __a2aIdentityAssurance: "user",
    __a2aVerifiedOrgId: ORG,
  };
  const response: any = await handleJsonRpcH3(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [
            { type: "text", text: "Create the CRM to Clips automation." },
          ],
        },
        async: true,
      },
    },
    event,
    config as any,
  );
  const taskId = response.result?.id;
  if (typeof taskId !== "string") {
    throw new Error(
      `message/send returned no task: ${JSON.stringify(response)}`,
    );
  }
  return taskId;
}

async function waitForTaskState(taskId: string, states: string[]) {
  for (let i = 0; i < 600; i += 1) {
    const task = await getTask(taskId);
    if (task && states.includes(task.status.state)) return task;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const last = await getTask(taskId);
  throw new Error(
    `task ${taskId} never reached ${states.join("/")}: ${JSON.stringify(last?.status)}`,
  );
}

async function approvalRows(taskId: string) {
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM a2a_approvals WHERE task_id = ?`,
    args: [taskId],
  });
  return rows as Array<Record<string, any>>;
}

// Reads the stored automation back from the jobs resources, not from what the
// tool said it did.
async function storedAutomations(name: string) {
  const listed = await resourceList(ALICE, "jobs/");
  const found = listed.filter((resource) => resource.path.includes(name));
  return Promise.all(
    found.map(async (entry) => {
      const resource = await resourceGet(entry.id);
      return resource ? parseJobResource(resource.content) : null;
    }),
  );
}

function approvalRoute() {
  const route = booted.routes.find(
    (entry) => entry.path === "/_agent-native/a2a/approvals",
  );
  if (!route) throw new Error("the A2A approval route was never mounted");
  return route.handler;
}

async function callApprovalRoute(approvalId: string, method: "GET" | "POST") {
  const event = mockEvent(
    new Request(`${APP_ORIGIN}/${approvalId}`, {
      method,
      headers: { "sec-fetch-site": "same-origin" },
    }),
  );
  const body: any = await approvalRoute()(event);
  return { status: event.res.status ?? 200, body };
}

describe("manage-automations through the real A2A receiver", () => {
  beforeEach(async () => {
    // Hosted requests expect release-owned schema, including execution leases.
    await withMigrationRuntime(async () => {
      await orgStore.ready();
      await ensureRunTables();
    });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_MODE", "production");
    vi.stubEnv("DEPLOY_PRIME_URL", APP_ORIGIN);
    vi.stubEnv("BETTER_AUTH_SECRET", "automation-approval-auth-0123456789");
    vi.stubEnv("A2A_SECRET", "automation-approval-a2a-secret");
    processing.length = 0;
  });

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("parks a define in a stored approval, creates nothing, then replays it once", async () => {
    const defineInput = {
      action: "define",
      name: `crm-to-clips-${Date.now()}`,
      trigger_type: "manual",
      mode: "agentic",
      body: "Attach the Clips recording to the CRM record.",
    };
    await seedOrganization();
    const config = await bootReceiver(defineInput);
    installProcessorWire(config);

    const taskId = await sendAsAlice(config);
    const paused = await waitForTaskState(taskId, [
      "input-required",
      "failed",
      "completed",
    ]);
    await Promise.all(processing);
    expect(paused.status.state, JSON.stringify(paused.status)).toBe(
      "input-required",
    );

    // The task carries the trusted identity the receiver verified.
    const { rows: taskRows } = await getDbExec().execute({
      sql: `SELECT owner_email, owner_scope FROM a2a_tasks WHERE id = ?`,
      args: [taskId],
    });
    expect(taskRows[0]).toMatchObject({
      owner_email: ALICE,
      owner_scope: `${A2A_ORG_ID_OWNER_SCOPE_PREFIX}${ORG}`,
    });

    // A real approval row binds the exact call, owner, and organization.
    const rows = await approvalRows(taskId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect({
      tool: row.tool_name,
      input: JSON.parse(row.tool_input),
      owner: row.owner_email,
      org: row.org_id,
      callId: row.call_id,
      status: row.status,
    }).toEqual({
      tool: "manage-automations",
      input: defineInput,
      owner: ALICE,
      org: ORG,
      callId: CALL_ID,
      status: "pending",
    });
    expect(row.approval_key).toMatch(/#arguments=[0-9a-f]{64}$/);
    expect(row.approval_key).toBe(
      approvalKeyWithArguments(
        toolCallCacheKey("manage-automations", defineInput),
        actionArgumentsHash(defineInput),
      ),
    );

    // The review link the caller receives points at that row.
    const message: any = paused.status.message;
    expect(message.metadata).toMatchObject({
      agentNativeTaskState: "input-required",
      agentNativeApproval: { id: row.id, tool: "manage-automations" },
    });
    expect(message.metadata.agentNativeApproval.url).toMatch(
      new RegExp(`/_agent-native/a2a/approvals/${row.id}$`),
    );

    // Nothing exists until the owner approves.
    expect(await storedAutomations(defineInput.name)).toEqual([]);

    const review = await callApprovalRoute(row.id, "GET");
    expect(review.status).toBe(200);
    expect(String(review.body)).toContain("manage-automations");
    expect(await storedAutomations(defineInput.name)).toEqual([]);

    // Approving runs the stored call once, as an outside caller.
    const approved = await callApprovalRoute(row.id, "POST");
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ status: "completed" });

    const stored = await storedAutomations(defineInput.name);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.meta).toMatchObject({
      createdBy: ALICE,
      mcpManaged: true,
    });

    const [settled] = await approvalRows(taskId);
    expect(settled).toMatchObject({ status: "completed" });
    const completed = await getTask(taskId);
    expect(completed?.status.state).toBe("completed");

    // The approval is spent: a second click is refused and runs nothing.
    const again = await callApprovalRoute(row.id, "POST");
    expect(again.status).toBe(409);
    expect(await storedAutomations(defineInput.name)).toHaveLength(1);
    expect(await approvalRows(taskId)).toHaveLength(1);
  });
});
