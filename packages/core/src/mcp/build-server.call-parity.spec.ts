import { format } from "node:util";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ActionContractError, defineAction, fail } from "../action.js";
import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
import { mcpToolsToActionEntries } from "../mcp-client/index.js";
import { registerErrorCaptureProvider } from "../server/capture-error.js";
import { MCP_DIRECTORY_ROUTE_PREFIX } from "./route-paths.js";

// Pins the exact wire output of direct `tools/call` and the ordered side
// effects behind it: action runs, approval predicates, grant writes, embed
// mints, audit rows, action tracking, change markers and analytics. The
// snapshots were captured on `main` before the call path was split into a
// shared execution core and a direct adapter; any diff here is a behavior
// change, not a refactor. Only values that differ per run are replaced, and
// each is replaced by a per-test alias so reuse stays visible.

const trace = vi.hoisted(() => [] as unknown[]);

vi.mock("../server/action-change-marker-write.js", () => ({
  writeActionChangeMarker: vi.fn(async (marker: unknown) => {
    trace.push({ marker });
  }),
}));

vi.mock("./analytics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./analytics.js")>();
  return {
    ...actual,
    trackMcpToolCall: (_ctx: unknown, payload: Record<string, unknown>) => {
      trace.push({ mcpToolCall: payload });
    },
    trackMcpToolsList: () => {},
    trackMcpResourcesList: () => {},
    trackMcpResourceRead: () => {},
  };
});

vi.mock("../tracking/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tracking/registry.js")>()),
  track: (name: string, properties: unknown) => {
    trace.push({ track: { name, properties } });
  },
}));

vi.mock("../audit/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../audit/store.js")>()),
  insertAuditEvent: vi.fn(async (event: unknown) => {
    trace.push({ audit: event });
  }),
}));

const approvalGrants = vi.hoisted(() => new Map<string, any>());

vi.mock("./approval-store.js", async () => {
  const actual = await vi.importActual<typeof import("./approval-store.js")>(
    "./approval-store.js",
  );
  // A grant the client has not answered and nobody has used, before it expires.
  const open = (grant: any) => {
    const existing = approvalGrants.get(grant.nonce);
    return existing &&
      !existing.consumed &&
      existing.answer === undefined &&
      existing.expiresAt >= Date.now() &&
      existing.callerKey === grant.callerKey &&
      existing.actionName === grant.actionName &&
      existing.argumentsHash === grant.argumentsHash
      ? existing
      : undefined;
  };
  return {
    storedApprovalArguments: actual.storedApprovalArguments,
    normalizeApprovalEmail: actual.normalizeApprovalEmail,
    createMcpApprovalGrant: vi.fn(async (grant: any) => {
      trace.push({ grantCreate: grant });
      approvalGrants.set(grant.nonce, { ...grant, consumed: false });
    }),
    consumeMcpApprovalGrant: vi.fn(async (grant: any) => {
      const existing = open(grant);
      if (existing) existing.consumed = true;
      trace.push({ grantConsume: { ...grant, consumed: Boolean(existing) } });
      return Boolean(existing);
    }),
    answerMcpApprovalPrompt: vi.fn(async (grant: any, answer: string) => {
      const existing = open(grant);
      if (existing) existing.answer = answer;
      trace.push({
        grantAnswer: { ...grant, answer, answered: Boolean(existing) },
      });
      return Boolean(existing);
    }),
    // Nothing here approves a grant on its review page.
    consumeReviewedMcpApprovalGrant: vi.fn(
      async (call: any, nonce?: string) => {
        trace.push({ grantReviewedConsume: { ...call, nonce, found: false } });
        return null;
      },
    ),
    findRecentMcpApprovalRun: vi.fn(async () => null),
    recordMcpApprovalRun: vi.fn(async (nonce: string, status: string) => {
      trace.push({ grantRun: { nonce, status } });
    }),
  };
});

// No saved localization: approval prompts are in the default locale.
vi.mock("../settings/user-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/user-settings.js")>()),
  getUserSetting: vi.fn(async () => null),
}));

vi.mock("../org/context.js", () => ({
  resolveOrgByDomain: vi.fn(async () => null),
  resolveA2AOrganizationMetadataById: vi.fn(async () => null),
  resolveOrgIdForEmail: vi.fn(async () => null),
}));

vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  findBetterAuthUserIdForEmail: vi.fn(async () => undefined),
}));

vi.mock("../server/embed-session.js", () => ({
  createEmbedSessionTicket: vi.fn(async (input: Record<string, unknown>) => {
    trace.push({ embedTicket: input });
    return {
      ticket: "minted-ticket",
      ticketHash: "minted-ticket-hash",
      expiresAt: 1735689600000,
      targetPath: input.targetPath,
    };
  }),
  normalizeEmbedTargetPath: vi.fn(
    (raw: string | undefined | null, requestOrigin?: string) => {
      const value = String(raw ?? "").trim();
      if (!value) return null;
      const url = value.startsWith("/")
        ? new URL(value, requestOrigin ?? "https://mail.agent-native.com")
        : new URL(value);
      return `${url.pathname}${url.search}${url.hash}`;
    },
  ),
}));

vi.mock("../server/embed-route.js", () => ({
  buildEmbedStartPath: (ticket: string) =>
    `/_agent-native/embed/start?ticket=${encodeURIComponent(ticket)}`,
}));

vi.mock("./oauth-store.js", () => ({
  MCP_OAUTH_ACCESS_TOKEN_TTL: "30d",
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: 30 * 86400,
  getOAuthClient: vi.fn(async () => null),
}));

vi.mock("./credential-membership.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./credential-membership.js")>();
  return {
    ...actual,
    checkCredentialOrgMembership: async () => "member" as const,
  };
});

vi.mock("h3", () => ({
  defineEventHandler: (fn: any) => fn,
  getMethod: (event: any) => event.method ?? "GET",
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  getRequestHeader: (event: any, name: string) =>
    event._headers?.[name.toLowerCase()],
  getRequestIP: () => undefined,
  getQuery: () => ({}),
  setResponseStatus: (event: any, code: number) => {
    event._status = code;
  },
  setResponseHeader: () => {},
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: vi.fn(async (event: any) => event._body ?? {}),
}));

vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: () => ({ use: () => {} }),
}));

const { handleMcpRequest } = await import("./server.js");

const NOW = Date.parse("2026-01-01T00:00:00.000Z");
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const ORIGIN = "https://mail.agent-native.com";
const EMBED_START = `${ORIGIN}/_agent-native/embed/start?ticket=leaked-ticket`;
const widget = {
  resource: {
    title: "Mail widget",
    html: "<!doctype html><html><body>Widget</body></html>",
  },
};

// Every action goes through `defineAction`, so audit and action tracking run
// exactly as they do for an app. The trace entry for `run` proves whether the
// action executed relative to approval and grant writes.
function act(options: Record<string, any>) {
  const run = options.run;
  const needsApproval = options.needsApproval;
  const defined: any = defineAction({
    ...options,
    run: async (args: any, ctx: any) => {
      trace.push({
        run: {
          action: ctx?.actionName,
          args,
          caller: ctx?.caller,
          userEmail: ctx?.userEmail,
          orgId: ctx?.orgId,
          appId: ctx?.appId,
        },
      });
      return run(args, ctx);
    },
    ...(typeof needsApproval === "function"
      ? {
          needsApproval: async (args: any, ctx: any) => {
            trace.push({ needsApproval: { action: ctx?.actionName, args } });
            return needsApproval(args, ctx);
          },
        }
      : {}),
  });
  // A contract set by hand, as an action without an `outputSchema` may.
  const entry = options.mcpOutputContract
    ? { ...defined, mcpOutputContract: options.mcpOutputContract }
    : defined;
  return options.toolMeta
    ? { ...entry, tool: { ...entry.tool, _meta: options.toolMeta } }
    : entry;
}

const cyclic: Record<string, unknown> = { id: "loop-1" };
cyclic.self = cyclic;

const actions: Record<string, any> = {
  "read-thing": act({
    description: "Read a thing",
    readOnly: true,
    run: async () => ({ id: "thing-1", title: "Thing", tags: ["a", "b"] }),
    link: ({ result }: any) => ({
      label: "Open thing",
      view: "thing",
      url: `/things/${result.id}`,
    }),
  }),
  "list-things": act({
    description: "List things",
    readOnly: true,
    run: async () => [{ id: "a" }, { id: "b" }],
  }),
  "long-read": act({
    description: "Read a long thing",
    readOnly: true,
    run: async () => ({ body: "x".repeat(2600) }),
  }),
  "write-thing": act({
    description: "Write a thing",
    parameters: { name: { type: "string" } },
    run: async (args: Record<string, string>) => ({
      id: "w-1",
      message: `Saved ${args.name ?? "nothing"}`,
      nextRequiredAction: "Read it back",
    }),
  }),
  "write-void": act({
    description: "Write without a result",
    run: async () => undefined,
  }),
  "fail-thing": act({
    description: "Always fails",
    run: async () => {
      throw new Error("boom");
    },
  }),
  "partial-then-fail": act({
    description: "Writes, then fails",
    run: async () => {
      trace.push({ effect: "row written before the failure" });
      throw new Error("failed after writing");
    },
  }),
  "contract-fail": act({
    description: "Fails a contract",
    run: async () => {
      throw new ActionContractError("Revision is stale.", {
        errorCode: "stale_revision",
      });
    },
  }),
  "contract-generic": act({
    description: "Fails generically",
    run: async () => {
      throw new ActionContractError("Generic failure.", {
        errorCode: "action_failed",
      });
    },
  }),
  "contract-empty-code": act({
    description: "Fails a contract with an empty code",
    run: async () => {
      throw new ActionContractError("oops", { errorCode: "" });
    },
  }),
  "throws-string": act({
    description: "Throws a non-Error",
    run: async () => {
      throw "plain string";
    },
  }),
  "bigint-write": act({
    description: "Write whose result is not JSON",
    run: async () => ({ id: "big-1", count: 10n }),
  }),
  "bigint-read": act({
    description: "Read whose result is not JSON",
    readOnly: true,
    run: async () => ({ id: "big-2", count: 10n }),
  }),
  "cycle-write": act({
    description: "Write whose result is circular",
    run: async () => cyclic,
  }),
  "cycle-read": act({
    description: "Read whose result is circular",
    readOnly: true,
    run: async () => cyclic,
  }),
  "wrapped-ok": act({
    description: "Proxied MCP result",
    readOnly: true,
    run: async () => ({
      [MCP_ACTION_RESULT_MARKER]: true,
      text: "Upstream says hello",
      raw: { value: 1, nested: { ok: true } },
      serverId: "upstream",
      toolName: "upstream__hello",
      originalToolName: "hello",
      input: {},
    }),
  }),
  "wrapped-error": act({
    description: "Proxied MCP error",
    run: async () => ({
      [MCP_ACTION_RESULT_MARKER]: true,
      text: "Upstream failed",
      raw: { isError: true, content: [] },
      serverId: "upstream",
      toolName: "upstream__fail",
      originalToolName: "fail",
      input: {},
    }),
  }),
  // Every read of `text` lands in the trace, so an added read shows up even
  // when it does not reach the read that throws.
  "wrapped-text-reads": act({
    description: "Proxied MCP result whose text can be read only so often",
    readOnly: true,
    run: async () => {
      let reads = 0;
      return {
        [MCP_ACTION_RESULT_MARKER]: true,
        get text() {
          reads += 1;
          trace.push({ proxyTextRead: reads });
          if (reads > 2) throw new Error("proxy text was read again");
          return "Upstream says hello";
        },
        raw: { value: 1 },
        serverId: "upstream",
        toolName: "upstream__hello",
        originalToolName: "hello",
        input: {},
      };
    },
  }),
  "embed-leak": act({
    description: "Returns an embed ticket without a widget",
    readOnly: true,
    run: async () => ({
      message: `Open it at ${EMBED_START}`,
      embedStartUrl: EMBED_START,
      embedExpiresAt: 1,
      ticket: "leaked-ticket",
      nested: [{ url: EMBED_START, label: "start" }, { keep: "me" }],
    }),
  }),
  "embed-write-leak": act({
    description: "Write that returns an embed ticket",
    run: async () => ({
      id: "doc-9",
      embedStartUrl: EMBED_START,
      embedTicket: "leaked-ticket",
    }),
  }),
  "embed-widget": act({
    description: "Opens a widget",
    readOnly: true,
    mcpApp: widget,
    run: async () => ({
      app: "mail",
      embed: true,
      url: "/inbox/thread-1",
      title: "Thread",
    }),
  }),
  "embed-widget-existing": act({
    description: "Widget with its own ticket",
    mcpApp: widget,
    run: async () => ({
      app: "mail",
      embedStartUrl: EMBED_START,
      deepLinkUrl: "/inbox/thread-2",
      message: "Draft ready",
    }),
  }),
  "embed-empty": act({
    description: "Widget with nothing to show",
    readOnly: true,
    mcpApp: widget,
    run: async () => ({}),
  }),
  "image-thing": act({
    description: "Returns images",
    readOnly: true,
    run: async () => ({
      summary: "Chart rendered",
      _agentImages: [
        { data: "iVBORw0KGgo=", mediaType: "image/png", label: "chart" },
        { url: "https://cdn.example.com/a.png", label: "hosted" },
        { url: "http://insecure.example.com/b.png" },
      ],
    }),
  }),
  "app-only": act({
    description: "Widget-only helper",
    toolMeta: { ui: { visibility: ["app"] } },
    run: async () => ({ startUrl: EMBED_START, ok: true }),
  }),
  publish: act({
    description: "Publish",
    parameters: { draftId: { type: "string" } },
    needsApproval: true,
    run: async (args: Record<string, string>) => ({
      id: args.draftId,
      message: "Published",
    }),
  }),
  "maybe-approve": act({
    description: "Approval only for big changes",
    parameters: { big: { type: "boolean" } },
    needsApproval: async (args: Record<string, unknown>) => args.big === true,
    run: async () => ({ ok: true }),
  }),
  "approval-throws": act({
    description: "Approval predicate throws",
    needsApproval: async () => {
      throw new Error("predicate failed");
    },
    run: async () => ({ ok: true }),
  }),
};

const config = {
  name: "agent-native-mail",
  appId: "mail",
  description: "Mail app",
  version: "1.0.0",
  builtinCrossAppTools: false as const,
  actions,
};

function makeEvent(
  headers: Record<string, string>,
  body: unknown,
  method = "POST",
) {
  const allHeaders: Record<string, string> = {
    host: "mail.agent-native.com",
    "x-forwarded-proto": "https",
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...headers,
  };
  const path = "/";
  return {
    method,
    url: { pathname: path },
    path,
    req: new Request(`${ORIGIN}${path}`, { method, headers: allHeaders }),
    _headers: allHeaders,
    _body: body,
    _status: 200,
  };
}

async function oauthHeaders(
  scope = "mcp:read mcp:write mcp:apps",
  resource = `${ORIGIN}/_agent-native/mcp`,
) {
  const { signMcpOAuthAccessToken } = await import("./oauth-token.js");
  const token = await signMcpOAuthAccessToken({
    ownerEmail: "oauth@example.com",
    clientId: "client-123",
    scope,
    resource,
    issuer: ORIGIN,
  });
  return { authorization: `Bearer ${token}` };
}

const PER_RUN_KEYS: Record<string, string> = {
  requestState: "requestState",
  nonce: "nonce",
  operation_id: "operation",
};
// A review page link carries its grant's nonce.
const APPROVAL_REVIEW_PATH = /(\/mcp\/approvals\/)([0-9a-f-]{36})/g;

// Replaces only values that differ per run. Random ones get a stable alias in
// order of first appearance, so the same nonce or request state reused across
// calls is still visibly the same value.
function stabilize(value: unknown): unknown {
  const aliases = new Map<string, string>();
  const counts = new Map<string, number>();
  const alias = (kind: string, raw: string) => {
    const key = `${kind}\0${raw}`;
    let found = aliases.get(key);
    if (!found) {
      const n = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, n);
      found = `<${kind} #${n}>`;
      aliases.set(key, found);
    }
    return found;
  };
  return JSON.parse(JSON.stringify(value), function (key, val) {
    if (key === "durationMs" || key === "duration_ms") return "<duration>";
    if (typeof val !== "string") return val;
    if (PER_RUN_KEYS[key]) return alias(PER_RUN_KEYS[key], val);
    if (key === "id" && this && "actorKind" in this) {
      return alias("auditId", val);
    }
    return val.replace(
      APPROVAL_REVIEW_PATH,
      (_match, path: string, nonce: string) => path + alias("nonce", nonce),
    );
  });
}

async function connect(
  headers: Record<string, string>,
  options: {
    serverConfig?: Record<string, unknown>;
    approvalDecision?: "approve" | "deny";
    manualInputRequired?: boolean;
    maxRounds?: number;
  } = {},
) {
  const wire: unknown[] = [];
  const transport = new StreamableHTTPClientTransport(
    new URL(`${ORIGIN}/mcp`),
    {
      requestInit: { headers },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const body =
          request.method === "POST"
            ? JSON.parse(await request.clone().text())
            : undefined;
        const response = (await handleMcpRequest(
          makeEvent(
            Object.fromEntries(request.headers),
            body,
            request.method,
          ) as any,
          (options.serverConfig ?? config) as any,
        )) as Response;
        if (body?.method === "tools/call") {
          const text = await response.clone().text();
          wire.push({
            status: response.status,
            body: (response.headers.get("content-type") ?? "").includes(
              "application/json",
            )
              ? JSON.parse(text)
              : text,
          });
        }
        return response;
      },
    },
  );
  const inputRequired =
    options.manualInputRequired || options.maxRounds !== undefined
      ? {
          inputRequired: {
            ...(options.manualInputRequired ? { autoFulfill: false } : {}),
            ...(options.maxRounds !== undefined
              ? { maxRounds: options.maxRounds }
              : {}),
          },
        }
      : {};
  const client = new Client(
    { name: "parity-spec", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" }, ...inputRequired },
  );
  if (options.approvalDecision || options.manualInputRequired) {
    client.registerCapabilities({ elicitation: { form: {} } } as any);
  }
  if (options.approvalDecision) {
    client.setRequestHandler("elicitation/create", async () => ({
      action: "accept" as const,
      content: { decision: options.approvalDecision },
    }));
  }
  await client.connect(transport);
  // The handshake is not part of any call's trace.
  trace.length = 0;
  return { client, wire };
}

async function callCapturingError(
  client: Client,
  params: Record<string, unknown>,
  options?: Record<string, unknown>,
) {
  try {
    await client.callTool(params as any, options as any);
  } catch (error: any) {
    trace.push({
      clientError: {
        name: error?.name,
        code: error?.code,
        message: error?.message,
      },
    });
  }
}

function snapshot(wire: unknown[]) {
  const out = stabilize({ wire, trace });
  trace.length = 0;
  return out;
}

function approvedResume(
  first: { requestState?: string },
  args: Record<string, unknown>,
) {
  return {
    name: "publish",
    arguments: args,
    requestState: first.requestState,
    inputResponses: {
      actionApproval: { action: "accept", content: { decision: "approve" } },
    },
  };
}

describe("direct tools/call wire output", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.ACCESS_TOKEN = "test-access-token";
    process.env.BETTER_AUTH_SECRET = "oauth-secret-at-least-32-characters-long";
    process.env.AGENT_NATIVE_MCP_APPS_INLINE = "1";
    delete process.env.A2A_SECRET;
    delete process.env.AGENT_NATIVE_OWNER_EMAIL;
    delete process.env.AGENT_NATIVE_AUDIT_ENABLED;
    approvalGrants.clear();
    trace.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ACCESS_TOKEN;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE;
  });

  const fullCatalogCalls: Array<[string, Record<string, unknown>?]> = [
    ["read-thing"],
    ["list-things"],
    ["long-read"],
    ["write-thing", { name: "draft" }],
    ["write-void"],
    ["fail-thing"],
    ["partial-then-fail"],
    ["contract-fail"],
    ["contract-generic"],
    ["contract-empty-code"],
    ["throws-string"],
    ["bigint-write"],
    ["bigint-read"],
    ["cycle-write"],
    ["cycle-read"],
    ["wrapped-ok"],
    ["wrapped-error"],
    ["wrapped-text-reads"],
    ["embed-leak"],
    ["embed-write-leak"],
    ["embed-widget"],
    ["embed-widget-existing"],
    ["embed-empty"],
    ["image-thing"],
    ["app-only"],
    ["maybe-approve", { big: false }],
    ["no-such-tool"],
  ];

  it.each(fullCatalogCalls)(
    "full catalog, OAuth user: %s",
    async (name, args) => {
      const { client, wire } = await connect({
        ...(await oauthHeaders()),
        "x-agent-native-mcp-full-catalog": "1",
      });
      try {
        await callCapturingError(client, { name, arguments: args ?? {} });
      } finally {
        await client.close();
      }
      expect(snapshot(wire)).toMatchSnapshot();
    },
  );

  it.each([["read-thing"], ["write-thing"], ["embed-widget"]])(
    "compact catalog, read-only OAuth scope: %s",
    async (name) => {
      const { client, wire } = await connect(await oauthHeaders("mcp:read"));
      try {
        await callCapturingError(client, { name, arguments: {} });
      } finally {
        await client.close();
      }
      expect(snapshot(wire)).toMatchSnapshot();
    },
  );

  it("full catalog, read-only OAuth scope: a write is refused by scope", async () => {
    const { client, wire } = await connect({
      ...(await oauthHeaders("mcp:read")),
      "x-agent-native-mcp-full-catalog": "1",
    });
    try {
      await callCapturingError(client, { name: "write-thing", arguments: {} });
      await callCapturingError(client, { name: "read-thing", arguments: {} });
    } finally {
      await client.close();
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });

  it("approval: elicitation, approved retry, and replay", async () => {
    const { client, wire } = await connect(
      { ...(await oauthHeaders()), "x-agent-native-mcp-full-catalog": "1" },
      { manualInputRequired: true },
    );
    try {
      const first = (await client.callTool(
        { name: "publish", arguments: { draftId: "d-1" } },
        { allowInputRequired: true } as any,
      )) as any;
      const resume = approvedResume(first, { draftId: "d-1" });
      await callCapturingError(client, resume);
      await callCapturingError(client, resume);
      await callCapturingError(client, {
        ...resume,
        arguments: { draftId: "d-2" },
      });
    } finally {
      await client.close();
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });

  it("approval: denied decision and predicate outcomes", async () => {
    const { client, wire } = await connect(
      { ...(await oauthHeaders()), "x-agent-native-mcp-full-catalog": "1" },
      { manualInputRequired: true },
    );
    try {
      const first = (await client.callTool(
        { name: "publish", arguments: { draftId: "d-3" } },
        { allowInputRequired: true } as any,
      )) as any;
      await callCapturingError(client, {
        name: "publish",
        arguments: { draftId: "d-3" },
        requestState: first.requestState,
        inputResponses: {
          actionApproval: { action: "accept", content: { decision: "deny" } },
        },
      });
      await callCapturingError(
        client,
        { name: "maybe-approve", arguments: { big: true } },
        { allowInputRequired: true },
      );
      await callCapturingError(
        client,
        { name: "approval-throws", arguments: {} },
        { allowInputRequired: true },
      );
    } finally {
      await client.close();
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });

  it("approval: client-fulfilled elicitation round trip", async () => {
    const { client, wire } = await connect(
      { ...(await oauthHeaders()), "x-agent-native-mcp-full-catalog": "1" },
      { approvalDecision: "approve" },
    );
    try {
      await callCapturingError(client, {
        name: "publish",
        arguments: { draftId: "d-4" },
      });
    } finally {
      await client.close();
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });

  it("approval: a client without elicitation gets the review page link", async () => {
    const { client, wire } = await connect({
      ...(await oauthHeaders()),
      "x-agent-native-mcp-full-catalog": "1",
    });
    try {
      await callCapturingError(client, {
        name: "publish",
        arguments: { draftId: "d-6" },
      });
    } finally {
      await client.close();
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });

  it("approval: the client gives up when its round limit is exhausted", async () => {
    const { client, wire } = await connect(
      { ...(await oauthHeaders()), "x-agent-native-mcp-full-catalog": "1" },
      { approvalDecision: "approve", maxRounds: 0 },
    );
    try {
      await callCapturingError(client, {
        name: "publish",
        arguments: { draftId: "d-7" },
      });
    } finally {
      await client.close();
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });

  it("approval: a grant that expired in the store is refused", async () => {
    const { client, wire } = await connect(
      { ...(await oauthHeaders()), "x-agent-native-mcp-full-catalog": "1" },
      { manualInputRequired: true },
    );
    try {
      const first = (await client.callTool(
        { name: "publish", arguments: { draftId: "d-8" } },
        { allowInputRequired: true } as any,
      )) as any;
      for (const grant of approvalGrants.values()) grant.expiresAt = NOW - 1;
      await callCapturingError(
        client,
        approvedResume(first, { draftId: "d-8" }),
      );
    } finally {
      await client.close();
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });

  it("approval: a resume after the approval window is refused", async () => {
    const { client, wire } = await connect(
      { ...(await oauthHeaders()), "x-agent-native-mcp-full-catalog": "1" },
      { manualInputRequired: true },
    );
    try {
      const first = (await client.callTool(
        { name: "publish", arguments: { draftId: "d-9" } },
        { allowInputRequired: true } as any,
      )) as any;
      vi.setSystemTime(NOW + APPROVAL_TTL_MS + 1000);
      await callCapturingError(
        client,
        approvedResume(first, { draftId: "d-9" }),
      );
    } finally {
      await client.close();
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });

  it("approval: two concurrent resumes of one approval run the action once", async () => {
    const { client, wire } = await connect(
      { ...(await oauthHeaders()), "x-agent-native-mcp-full-catalog": "1" },
      { manualInputRequired: true },
    );
    let firstLeg: unknown;
    try {
      const first = (await client.callTool(
        { name: "publish", arguments: { draftId: "d-10" } },
        { allowInputRequired: true } as any,
      )) as any;
      firstLeg = stabilize({ wire, trace });
      wire.length = 0;
      trace.length = 0;
      const resume = approvedResume(first, { draftId: "d-10" });
      await Promise.all([
        callCapturingError(client, resume),
        callCapturingError(client, resume),
      ]);
    } finally {
      await client.close();
    }
    // The two resumes race, so which request wins is not the contract: the
    // snapshot drops their order and their JSON-RPC ids.
    const sorted = (items: unknown[]) =>
      items
        .map((item) => JSON.stringify(item))
        .sort()
        .map((item) => JSON.parse(item));
    const raced = snapshot(wire) as { wire: any[]; trace: unknown[] };
    const racedWire = raced.wire.map((leg) => ({
      ...leg,
      body: { ...leg.body, id: "<either resume>" },
    }));
    expect({
      firstLeg,
      raced: { wire: sorted(racedWire), trace: sorted(raced.trace) },
    }).toMatchSnapshot();
  });

  it("approval: a static-token caller cannot approve", async () => {
    const { client, wire } = await connect(
      {
        authorization: "Bearer test-access-token",
        "x-agent-native-mcp-full-catalog": "1",
      },
      { approvalDecision: "approve" },
    );
    try {
      await callCapturingError(client, {
        name: "publish",
        arguments: { draftId: "d-5" },
      });
    } finally {
      await client.close();
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });

  it("directory catalog: projected results, errors, and widget embeds", async () => {
    const annotations = (readOnly: boolean) => ({
      readOnlyHint: readOnly,
      destructiveHint: false,
      openWorldHint: false,
    });
    const directoryActions = {
      "dir-read": act({
        description: "Read a thing",
        readOnly: true,
        http: { method: "GET" },
        mcpAnnotations: annotations(true),
        run: async () => ({ id: "thing-1", title: "Thing", tags: ["a", "b"] }),
        link: ({ result }: any) => ({
          label: "Open thing",
          view: "thing",
          url: `/things/${result.id}`,
        }),
      }),
      "dir-fail": act({
        description: "Always fails",
        mcpAnnotations: annotations(false),
        run: async () => {
          throw new Error("boom");
        },
      }),
      "dir-widget": act({
        description: "Opens a widget",
        readOnly: true,
        mcpApp: widget,
        mcpAnnotations: annotations(true),
        link: () => ({ url: "/inbox/thread-1", label: "Open" }),
        run: async () => ({
          title: "Thread",
          embedStartUrl: EMBED_START,
          embedTargetPath: "/inbox",
          embedExpiresAt: 2,
        }),
      }),
      "dir-write-widget": act({
        description: "Opens a widget after a write",
        mcpApp: widget,
        mcpAnnotations: annotations(false),
        link: () => ({ url: "/inbox/thread-9", label: "Open" }),
        run: async () => ({ title: "Draft" }),
      }),
      // The projector below clears `isError` on the proxied value it is
      // handed, so the response shows whether the error flag is read before
      // or after projection.
      "dir-proxy-error": act({
        description: "Proxied MCP error",
        mcpApp: widget,
        mcpAnnotations: annotations(false),
        run: async () => ({
          [MCP_ACTION_RESULT_MARKER]: true,
          text: "Upstream failed",
          raw: { isError: true, detail: "upstream detail" },
          serverId: "upstream",
          toolName: "upstream__fail",
          originalToolName: "fail",
          input: {},
        }),
      }),
    };
    const names = Object.keys(directoryActions);
    const directoryConfig = {
      ...config,
      catalogMode: "directory" as const,
      connectorCatalog: names,
      directoryProfile: {
        connectorCatalog: names,
        // Directory widgets attach only to the profile's widget targets, and
        // only with a scoped read the widget session can carry.
        widgetTargets: Object.fromEntries(
          ["dir-widget", "dir-write-widget", "dir-proxy-error"].map((name) => [
            name,
            () => ({
              targetPath: "/inbox",
              resourceIds: { thread: "thread-1" },
            }),
          ]),
        ),
        widgetReadActionArguments: { "dir-read": { id: "thread" } },
        projectResult: (toolName: string, result: unknown) => {
          trace.push({
            projectResult: {
              toolName,
              result: JSON.parse(JSON.stringify(result)),
            },
          });
          if (typeof result === "string") return `[${toolName}] ${result}`;
          if (!result || typeof result !== "object" || Array.isArray(result)) {
            return result;
          }
          const record = result as Record<string, unknown>;
          if (record.isError === true) {
            record.isError = false;
            return record;
          }
          return { ...record, projectedBy: toolName };
        },
      },
      widgetDomain: ORIGIN,
      actions: directoryActions,
    };
    const headers = await oauthHeaders(
      "mcp:read mcp:write mcp:apps",
      `${ORIGIN}${MCP_DIRECTORY_ROUTE_PREFIX}`,
    );
    const wire: unknown[] = [];
    for (const name of [...names, "read-thing"]) {
      const event = makeEvent(headers, {
        jsonrpc: "2.0",
        id: name,
        method: "tools/call",
        params: { name, arguments: {} },
      });
      const response = (await handleMcpRequest(
        event as any,
        directoryConfig as any,
        MCP_DIRECTORY_ROUTE_PREFIX,
      )) as Response;
      wire.push({ status: response.status, body: await response.text() });
    }
    expect(snapshot(wire)).toMatchSnapshot();
  });
});

// Each leak is an embed start URL whose own path is not the embed route, so a
// test that reads only a URL's path lets it and its ticket through.
describe("direct tools/call embed credential redaction", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.BETTER_AUTH_SECRET = "oauth-secret-at-least-32-characters-long";
    process.env.AGENT_NATIVE_MCP_APPS_INLINE = "1";
    trace.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE;
  });

  // An embed start URL inside another URL, where its own path is never the
  // embed route.
  const nestedEmbedStarts = [
    `https://redirect.example/?next=${EMBED_START}`,
    `https://redirect.example/?next=${encodeURIComponent(EMBED_START)}`,
    `https://redirect.example/?next=${encodeURIComponent(encodeURIComponent(EMBED_START))}`,
    `https://redirect.example/#next=${EMBED_START}`,
    JSON.stringify({ next: EMBED_START }).replaceAll("/", "\\/"),
  ];
  let nested = "";
  // A nested URL that is not https:// is dropped as an invalid image first.
  const imageNote = (leak: string, name: string) =>
    leak.startsWith("https://")
      ? "[image #1 dropped: it carried an embed credential]"
      : `[image ${name} dropped: url must be a public https:// URL]`;
  const ordinary = {
    source: "embed",
    start: "2026-10-01",
    next: `https://redirect.example/?next=${encodeURIComponent(`${ORIGIN}/inbox`)}`,
    support: {
      ticket: "SUP-12",
      url: "https://support.example/_agent-native/embed?step=1#started-guide",
      note: "Embedded charts &amp; start-up tips",
    },
  };
  const leakActions = {
    "leak-in-value": act({
      description: "Nested start URL in a value",
      readOnly: true,
      run: async () => ({ next: nested, ticket: "leaked-ticket", keep: "me" }),
    }),
    "leak-in-key": act({
      description: "Nested start URL as a key",
      readOnly: true,
      run: async () => ({
        links: { [nested]: { label: "open" }, ticket: "leaked-ticket" },
        keep: "me",
      }),
    }),
    "leak-beside-ticket": act({
      description: "Nested start URL beside a ticket",
      readOnly: true,
      run: async () => ({
        items: [{ url: nested }, { ticket: "leaked-ticket", id: "kept" }],
      }),
    }),
    "leak-in-widget": act({
      description: "Widget whose result nests a start URL",
      readOnly: true,
      mcpApp: widget,
      run: async () => ({
        app: "mail",
        embed: true,
        url: "/inbox/thread-1",
        deepLinkUrl: nested,
        title: "Thread",
      }),
    }),
    "leak-in-link": act({
      description: "Links to a nested start URL",
      readOnly: true,
      run: async () => ({ id: "doc-1", title: "Doc" }),
      link: () => ({ label: "Open doc", url: nested }),
    }),
    "leak-in-image": act({
      description: "Attaches an image at a nested start URL",
      readOnly: true,
      run: async () => ({
        summary: "Chart",
        _agentImages: [{ url: nested, label: "chart" }],
      }),
    }),
    "leak-beside-image": act({
      description: "Ticket beside an image at a nested start URL",
      readOnly: true,
      run: async () => ({
        keep: "me",
        ticket: "leaked-ticket",
        _agentImages: [{ url: nested }],
      }),
    }),
    "leak-below-image": act({
      description: "Ticket in an object beside an image at a nested start URL",
      readOnly: true,
      run: async () => ({
        keep: "me",
        account: { ticket: "leaked-ticket", id: "acct-1" },
        _agentImages: [{ url: nested }],
      }),
    }),
    "app-only-start": act({
      description: "App-only session helper",
      toolMeta: { ui: { visibility: ["app"] } },
      run: async () => ({
        startUrl: EMBED_START,
        targetPath: "/inbox",
        expiresAt: 1735689600,
      }),
    }),
    "app-only-nested": act({
      description: "App-only helper whose result nests a start URL",
      toolMeta: { ui: { visibility: ["app"] } },
      run: async () => ({ next: nested, ticket: "leaked-ticket", ok: true }),
    }),
    "leak-in-error": act({
      description: "Fails with a nested start URL",
      run: async () => {
        throw new Error(`Could not open ${nested}`);
      },
    }),
    ordinary: act({
      description: "Ordinary nested URLs and tickets",
      readOnly: true,
      run: async () => ordinary,
      link: () => ({ label: "Open guide", url: ordinary.support.url }),
    }),
  };
  const proxied = (text: string, raw: unknown) => ({
    [MCP_ACTION_RESULT_MARKER]: true,
    text,
    raw,
    serverId: "upstream",
    toolName: "upstream__session",
    originalToolName: "session",
    input: {},
  });
  // Each of these holds a ticket in a field that names no start route, while
  // the start URL that carries it is elsewhere in the call.
  const contextActions = {
    "proxy-raw-start": act({
      description: "Proxy text beside a raw start URL",
      readOnly: true,
      run: async () =>
        proxied(JSON.stringify({ ticket: "leaked-ticket" }), {
          startUrl: EMBED_START,
          ticket: "leaked-ticket",
        }),
    }),
    "proxy-structured-ticket": act({
      description: "Proxy whose structured ticket sits beside its _meta start",
      readOnly: true,
      run: async () => {
        const { flattenMcpToolResult } = await import("../mcp-client/index.js");
        const raw = {
          content: [{ type: "text", text: "Session created" }],
          structuredContent: { ticket: "leaked-ticket" },
          _meta: { "agent-native/embedStart": { startUrl: EMBED_START } },
        };
        return proxied(
          flattenMcpToolResult(raw as any, { preferStructuredContent: true }),
          raw,
        );
      },
    }),
    "proxy-meta-echo": act({
      description: "Proxy text echoing the ticket of its _meta start URL",
      readOnly: true,
      run: async () =>
        proxied("Sign in with code leaked-ticket.", {
          content: [{ type: "text", text: "Sign in with code leaked-ticket." }],
          _meta: { "agent-native/embedStart": { startUrl: EMBED_START } },
        }),
    }),
    "serializes-to-start": act({
      description: "Result whose JSON is a start URL",
      readOnly: true,
      run: async () => ({
        toJSON: () => ({ startUrl: EMBED_START, ticket: "leaked-ticket" }),
      }),
    }),
    "getter-start": act({
      description: "Result whose getter returns a start URL",
      readOnly: true,
      run: async () => ({
        get startUrl() {
          return EMBED_START;
        },
        ticket: "leaked-ticket",
        keep: "me",
      }),
    }),
    "split-link": act({
      description: "Link that joins a start URL from split fields",
      readOnly: true,
      run: async () => ({
        prefix: "/_agent-native/embed",
        suffix: "start",
        ticket: "leaked-ticket",
      }),
      link: ({ result }: { result: Record<string, string> }) => ({
        label: "Open",
        url: `${ORIGIN}${result.prefix}/${result.suffix}?ticket=${result.ticket}`,
      }),
    }),
    "prose-start-echo": act({
      description: "Prose that ends with a start URL, and its ticket alone",
      readOnly: true,
      run: async () => ({
        note: `Open ${EMBED_START}.`,
        code: "Your code is leaked-ticket",
      }),
    }),
    "deep-start-echo": act({
      description: "A start URL escaped 8 times, and its ticket alone",
      readOnly: true,
      run: async () => {
        let next = EMBED_START;
        for (let layer = 0; layer < 8; layer += 1) {
          next = encodeURIComponent(next);
        }
        return {
          next: `https://redirect.example/?next=${next}`,
          code: "Your code is leaked-ticket",
        };
      },
    }),
  };
  // One layer past what the check reads, beside a plain echo of its ticket.
  const overCapStart = () => {
    let next = EMBED_START;
    for (let layer = 0; layer < 9; layer += 1) {
      next = encodeURIComponent(next);
    }
    return `https://redirect.example/?next=${next}`;
  };
  const unreadableActions = {
    "over-cap-read": act({
      description: "Reads a start URL escaped 9 times, and its ticket alone",
      readOnly: true,
      run: async () => ({ next: overCapStart(), code: "Code: leaked-ticket" }),
    }),
    "over-cap-write": act({
      description: "Writes a start URL escaped 9 times, and its ticket alone",
      run: async () => ({ next: overCapStart(), code: "Code: leaked-ticket" }),
    }),
    "over-cap-widget-write": act({
      description:
        "Widget write whose result holds a start URL escaped 9 times",
      mcpApp: widget,
      run: async () => ({
        app: "mail",
        embed: true,
        url: "/inbox/thread-1",
        title: "Thread",
        next: overCapStart(),
      }),
    }),
  };
  const leakConfig = {
    ...config,
    actions: { ...leakActions, ...contextActions, ...unreadableActions },
  };

  async function call(name: string) {
    const { client, wire } = await connect(
      {
        ...(await oauthHeaders()),
        "x-agent-native-mcp-full-catalog": "1",
      },
      { serverConfig: leakConfig },
    );
    try {
      await callCapturingError(client, { name, arguments: {} });
    } finally {
      await client.close();
    }
    const [leg] = wire as Array<{ body: { result: any } }>;
    return leg.body.result;
  }

  it("hides a nested start URL and its ticket in values, keys and siblings", async () => {
    for (const leak of nestedEmbedStarts) {
      nested = leak;
      const expected: Record<string, unknown> = {
        "leak-in-value": { keep: "me" },
        "leak-in-key": { links: {}, keep: "me" },
        "leak-beside-ticket": { items: [{}, { id: "kept" }] },
      };
      for (const [name, value] of Object.entries(expected)) {
        const result = await call(name);
        expect(result.structuredContent, `${name}: ${leak}`).toEqual(value);
        expect(JSON.parse(result.content[0].text), `${name}: ${leak}`).toEqual(
          value,
        );
        expect(JSON.stringify(result)).not.toContain("leaked-ticket");
      }
    }
  });

  it("still mints a widget session when the result nests a start URL", async () => {
    for (const leak of nestedEmbedStarts) {
      nested = leak;
      const result = await call("leak-in-widget");
      expect(result._meta["agent-native/embedStart"].startUrl).toContain(
        "ticket=minted-ticket",
      );
      expect(result.structuredContent).toEqual({
        app: "mail",
        embed: true,
        url: "/inbox/thread-1",
        title: "Thread",
      });
      // Its open link would be the nested start URL, so it is left out.
      expect(result._meta["agent-native/openLink"]).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("leaked-ticket");
    }
  });

  it("hides a nested start URL in a link or an image note", async () => {
    for (const leak of nestedEmbedStarts) {
      nested = leak;
      const linked = await call("leak-in-link");
      expect(linked.content, leak).toEqual([
        { type: "text", text: JSON.stringify({ id: "doc-1", title: "Doc" }) },
        { type: "text", text: "[hidden embed URL]" },
      ]);
      expect(linked.structuredContent, leak).toEqual({
        id: "doc-1",
        title: "Doc",
      });
      const pictured = await call("leak-in-image");
      expect(pictured.content, leak).toEqual([
        {
          type: "text",
          text: `${JSON.stringify({ summary: "Chart" })}

${imageNote(leak, '"chart"')}`,
        },
      ]);
    }
  });

  it("hides a ticket beside an image whose URL nests a start URL", async () => {
    for (const leak of nestedEmbedStarts) {
      nested = leak;
      const expected: Record<string, unknown> = {
        "leak-beside-image": { keep: "me" },
        "leak-below-image": { keep: "me", account: { id: "acct-1" } },
      };
      for (const [name, value] of Object.entries(expected)) {
        const result = await call(name);
        expect(result.structuredContent, `${name}: ${leak}`).toEqual(value);
        expect(result.content, `${name}: ${leak}`).toEqual([
          {
            type: "text",
            text: `${JSON.stringify(value)}

${imageNote(leak, "#1")}`,
          },
        ]);
        expect(JSON.stringify(result)).not.toContain("leaked-ticket");
      }
    }
  });

  it("hands an app-only tool's start URL to the view in _meta alone", async () => {
    const started = await call("app-only-start");
    expect(started._meta["agent-native/embedStart"]).toEqual({
      startUrl: EMBED_START,
      expiresAt: 1735689600,
    });
    expect(started.structuredContent).toEqual({
      targetPath: "/inbox",
      expiresAt: 1735689600,
    });
    expect(JSON.stringify(started.content)).not.toContain("leaked-ticket");

    for (const leak of nestedEmbedStarts) {
      nested = leak;
      const result = await call("app-only-nested");
      expect(result._meta["agent-native/embedStart"], leak).toBeUndefined();
      expect(result.structuredContent, leak).toEqual({ ok: true });
      expect(JSON.stringify(result), leak).not.toContain("leaked-ticket");
    }
  });

  it("hides a nested start URL in an error message", async () => {
    nested = nestedEmbedStarts[0];
    const result = await call("leak-in-error");
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Error: [hidden embed URL]" },
    ]);
  });

  it("keeps ordinary nested URLs and tickets with no embed route beside them", async () => {
    const result = await call("ordinary");
    expect(result.structuredContent).toEqual({
      ...ordinary,
      openLink: expect.objectContaining({ webUrl: ordinary.support.url }),
      url: ordinary.support.url,
    });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(ordinary) },
      {
        type: "text",
        text: `

[Open guide →](${ordinary.support.url})`,
      },
    ]);
  });

  it.each(Object.keys(contextActions))(
    "hides a ticket wherever the call holds its start URL: %s",
    async (name) => {
      const result = await call(name);
      const visible = JSON.stringify({
        content: result.content,
        structuredContent: result.structuredContent,
      });
      expect(visible).not.toContain("leaked-ticket");
      expect(visible).not.toContain("embed/start");
    },
  );

  it("keeps the rest of a result around a hidden ticket", async () => {
    expect((await call("proxy-meta-echo")).content).toEqual([
      { type: "text", text: "[hidden embed ticket]" },
    ]);
    expect((await call("getter-start")).structuredContent).toEqual({
      keep: "me",
    });
    const linked = await call("split-link");
    expect(linked.content.at(-1)).toEqual({
      type: "text",
      text: "[hidden embed URL]",
    });
    expect(linked._meta["agent-native/openLink"]).toBeUndefined();
    expect(JSON.stringify(linked)).not.toContain("leaked-ticket");
  });

  it("hides a start URL escaped as deeply as the check reads, string by string", async () => {
    const result = await call("deep-start-echo");
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({ code: "[hidden embed ticket]" }),
      },
    ]);
  });

  it("withholds a write's result escaped past the check, and still reports success", async () => {
    const result = await call("over-cap-write");
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: "text",
        text: "over-cap-write completed. Its result could not be checked for embed credentials, so it is not shown.",
      },
    ]);
    expect(trace).toContainEqual({
      marker: expect.objectContaining({ actionName: "over-cap-write" }),
    });
    expect(JSON.stringify(result)).not.toContain("leaked-ticket");
  });

  it("fails a read whose result is escaped past the check", async () => {
    const result = await call("over-cap-read");
    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "Error: The result could not be checked for embed credentials.",
        },
      ],
    });
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("leaked-ticket");
  });

  it("still hands a withheld widget write the session it minted", async () => {
    const result = await call("over-cap-widget-write");
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: "text",
        text: "over-cap-widget-write completed. Its result could not be checked for embed credentials, so it is not shown.",
      },
    ]);
    expect(result._meta["agent-native/embedStart"].startUrl).toContain(
      "ticket=minted-ticket",
    );
    expect(result._meta["agent-native/openLink"]).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("leaked-ticket");
  });

  it("leaves out an action link's _meta entry that carries a ticket", async () => {
    for (const leak of nestedEmbedStarts) {
      nested = leak;
      const linked = await call("leak-in-link");
      expect(linked._meta["agent-native/openLink"], leak).toBeUndefined();
      expect(JSON.stringify(linked), leak).not.toContain("leaked-ticket");
    }
  });
});

describe("direct tools/call after the action has run", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.BETTER_AUTH_SECRET = "oauth-secret-at-least-32-characters-long";
    process.env.AGENT_NATIVE_MCP_APPS_INLINE = "1";
    trace.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE;
  });

  // Valid base64 as well as a ticket, so it can stand in for image data.
  const ticket = "AbcdefghijklmnopqrstuvwxyzABCDEFG0123456789";
  const start = `${ORIGIN}/_agent-native/embed/start?ticket=${ticket}`;
  const overCap = () => {
    let next = start;
    for (let layer = 0; layer < 9; layer += 1) {
      next = encodeURIComponent(next);
    }
    return `https://redirect.example/?next=${next}`;
  };
  const unchecked =
    "Its result could not be checked for embed credentials, so it is not shown.";
  const directory = (projectResult: (name: string, value: any) => unknown) => ({
    catalogMode: "directory",
    widgetDomain: ORIGIN,
    connectorCatalog: ["probe"],
    directoryProfile: { connectorCatalog: ["probe"], projectResult },
  });
  const annotations = (readOnlyHint: boolean) => ({
    readOnly: readOnlyHint,
    mcpAnnotations: {
      readOnlyHint,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  });

  async function call(
    action: Record<string, any>,
    serverConfig: Record<string, unknown> = {},
  ) {
    const { client, wire } = await connect(
      {
        ...(await oauthHeaders()),
        "x-agent-native-mcp-full-catalog": "1",
      },
      {
        serverConfig: {
          ...config,
          ...serverConfig,
          actions: { probe: act({ description: "Probe", ...action }) },
        },
      },
    );
    try {
      await callCapturingError(client, { name: "probe", arguments: {} });
    } finally {
      await client.close();
    }
    const [leg] = wire as Array<{ body: { result: any } }>;
    return leg.body.result;
  }
  const markers = () => trace.filter((entry: any) => "marker" in entry);
  const analytics = () =>
    trace.flatMap((entry: any) =>
      "mcpToolCall" in entry ? [entry.mcpToolCall] : [],
    );
  async function capturing(run: () => Promise<unknown>) {
    const seen: unknown[] = [];
    const stop = registerErrorCaptureProvider("parity", (error, context) => {
      seen.push({ message: (error as Error).message, tags: context.tags });
    });
    try {
      await run();
    } finally {
      stop();
    }
    return seen;
  }
  // Every server warning and error, as the console would print it.
  async function logged(run: () => Promise<unknown>) {
    const lines: string[] = [];
    const spies = (["warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(format(...args));
      }),
    );
    try {
      await run();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    return lines;
  }

  it("writes no marker for a write that opts out of change events", async () => {
    const result = await call({
      changeEvents: false,
      run: async () => ({ id: "written" }),
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("written");
    expect(markers()).toEqual([]);
  });

  it("tells a write by its effect, not by whether it notifies", async () => {
    const result = await call({
      changeEvents: false,
      run: async () => ({ id: "written", value: 1n }),
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: "text", text: `probe completed. ${unchecked}` },
    ]);
    expect(markers()).toEqual([]);
  });

  it("reads a proxied write's raw getter once, for its status and its resource hint", async () => {
    let reads = 0;
    const result = await call({
      changeResource: (_args: unknown, written: any) => ({
        resourceType: "document",
        resourceId: written.id,
      }),
      run: async () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Written",
        get raw() {
          reads += 1;
          if (reads > 1) throw new Error("raw read twice");
          return { id: "doc-1", value: 1n };
        },
      }),
    });
    expect(reads).toBe(1);
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: "text", text: `probe completed. ${unchecked}` },
    ]);
    expect(markers()).toEqual([
      {
        marker: {
          actionName: "probe",
          resourceType: "document",
          resourceId: "doc-1",
          owner: "oauth@example.com",
        },
      },
    ]);
  });

  it.each([true, false])(
    "withholds a result it cannot classify, reading it once (readOnly: %s)",
    async (readOnly) => {
      let reads = 0;
      const result = await call({
        readOnly,
        run: async () => ({
          [MCP_ACTION_RESULT_MARKER]: true,
          get text() {
            reads += 1;
            throw new Error(`Cannot read ${start}`);
          },
        }),
      });
      expect(reads).toBe(1);
      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: readOnly
              ? "Error: The result could not be checked for embed credentials."
              : `probe ran, but whether it succeeded could not be read; check before retrying. ${unchecked}`,
          },
        ],
      });
      expect(markers()).toHaveLength(readOnly ? 0 : 1);
      expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
    },
  );

  it.each([
    ["input", { input: { startUrl: start } }],
    ["MCP App tool input", { mcpApp: { toolInput: { startUrl: start } } }],
    ["_meta", { _meta: { startUrl: start } }],
  ])("learns a credential from a proxied tool's %s", async (_, fields) => {
    const result = await call({
      ...annotations(true),
      run: async () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Upstream result",
        raw: { ticket },
        serverId: "fake",
        toolName: "probe",
        originalToolName: "probe",
        ...fields,
      }),
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
  });

  it("learns the input of a result the MCP client built", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "Upstream result" }],
      structuredContent: { ticket },
    }));
    const entries = mcpToolsToActionEntries({
      getTools: () => [
        {
          name: "probe",
          source: "fake",
          originalName: "probe",
          description: "Probe",
          inputSchema: {
            type: "object",
            properties: { startUrl: { type: "string" } },
          },
          annotations: { readOnlyHint: true },
          raw: {},
        },
      ],
      callTool,
    } as any);
    const returned = await entries.probe!.run({ startUrl: start });
    const result = await call({
      ...annotations(true),
      run: async () => returned,
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
  });

  it("keeps a proxied write's reported failure when another field's getter clears it", async () => {
    const raw = { id: "doc-1", isError: true };
    let reads = 0;
    const result = await call({
      changeResource: (_args: unknown, written: any) => ({
        resourceType: "document",
        resourceId: written.id,
      }),
      run: async () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Upstream failure",
        raw,
        get input() {
          reads += 1;
          raw.isError = false;
          return {};
        },
      }),
    });
    expect(reads).toBe(1);
    expect(result.isError).toBe(true);
    expect(markers()).toEqual([]);
  });

  it("learns a proxied tool's fields when its status cannot be read", async () => {
    const raw = Object.defineProperty({ ticket }, "isError", {
      get() {
        throw new Error("No status");
      },
    });
    const result = await call({
      ...annotations(true),
      run: async () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Upstream result",
        raw,
        input: { startUrl: start },
      }),
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
  });

  it("does not let a wrapper's JSON hook erase the input the guard reads", async () => {
    let calls = 0;
    const result = await call({
      ...annotations(true),
      run: async () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Upstream result",
        raw: { ticket },
        input: { startUrl: start },
        toJSON() {
          calls += 1;
          return {};
        },
      }),
    });
    expect(calls).toBe(0);
    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "Error: The action result is not JSON data, so it could not be shown.",
        },
      ],
    });
    expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
  });

  const unreadableWrapper = (how: string, raw: object, read: () => void) =>
    how === "reading a field"
      ? {
          [MCP_ACTION_RESULT_MARKER]: true,
          text: "Written",
          raw,
          get input() {
            read();
            throw new Error(`Cannot read ${start}`);
          },
        }
      : new Proxy(
          { [MCP_ACTION_RESULT_MARKER]: true, text: "Written", raw },
          {
            ownKeys() {
              read();
              throw new Error(`Cannot list ${start}`);
            },
          },
        );

  it.each([
    ["reading a field", "completed"],
    ["reading a field", "failed"],
    ["listing its keys", "completed"],
    ["listing its keys", "failed"],
  ])(
    "withholds a proxied write when %s throws, trying it once (%s upstream)",
    async (how, status) => {
      const failed = status === "failed";
      let reads = 0;
      let result: any;
      const captured = await capturing(async () => {
        result = await call({
          changeResource: (_args: unknown, written: any) => ({
            resourceType: "document",
            resourceId: written.id,
          }),
          run: async () =>
            unreadableWrapper(
              how,
              failed ? { id: "doc-1", isError: true } : { id: "doc-1" },
              () => (reads += 1),
            ),
        });
      });
      expect(reads).toBe(1);
      expect(result.isError).toBe(failed ? true : undefined);
      expect(result.content).toEqual([
        { type: "text", text: `probe ${status}. ${unchecked}` },
      ]);
      expect(markers()).toEqual(
        failed
          ? []
          : [
              {
                marker: {
                  actionName: "probe",
                  resourceType: "document",
                  resourceId: "doc-1",
                  owner: "oauth@example.com",
                },
              },
            ],
      );
      expect(captured).toMatchObject([{ tags: { stage: "check" } }]);
      expect(JSON.stringify([result, analytics(), captured])).not.toContain(
        ticket,
      );
    },
  );

  it.each([
    ["its result", () => ({ id: "doc-1", big: 1n })],
    [
      "a proxied tool's raw result",
      () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Written",
        raw: { id: "doc-1", big: 1n },
      }),
    ],
    [
      "a Proxy whose marker descriptor throws",
      () =>
        new Proxy(
          { id: "doc-1", big: 1n },
          {
            getOwnPropertyDescriptor(target, key) {
              if (key === MCP_ACTION_RESULT_MARKER) throw new Error("No");
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
          },
        ),
    ],
    [
      "a result with an inherited false marker",
      () =>
        Object.assign(Object.create({ [MCP_ACTION_RESULT_MARKER]: false }), {
          id: "doc-1",
          big: 1n,
        }),
    ],
    [
      "a proxied tool's inherited raw result",
      () =>
        Object.assign(Object.create({ raw: { id: "doc-1", big: 1n } }), {
          [MCP_ACTION_RESULT_MARKER]: true,
          text: "Written",
        }),
    ],
    [
      "a result whose marker has no text",
      () => ({
        id: "doc-1",
        [MCP_ACTION_RESULT_MARKER]: true,
        text: 42,
        raw: { isError: true },
      }),
    ],
  ])(
    "keeps the resource hint of a write, read from %s",
    async (_, returned) => {
      const result = await call({
        changeResource: (_args: unknown, written: any) => ({
          resourceType: "document",
          resourceId: written.id,
        }),
        run: async () => returned(),
      });
      expect(result.isError).toBeUndefined();
      expect(markers()).toEqual([
        {
          marker: {
            actionName: "probe",
            resourceType: "document",
            resourceId: "doc-1",
            owner: "oauth@example.com",
          },
        },
      ]);
    },
  );

  it("keeps an upstream failure when the result cannot be read as JSON or projected", async () => {
    const raw = { isError: true, count: 1n };
    const unread = await call({
      run: async () => ({ [MCP_ACTION_RESULT_MARKER]: true, text: "No", raw }),
    });
    expect(unread).toMatchObject({
      isError: true,
      content: [{ type: "text", text: `probe failed. ${unchecked}` }],
    });

    const projectResult = (_name: string, value: any) => {
      if (value && typeof value === "object") {
        throw new Error(`Cannot project ${value.code}`);
      }
      return value;
    };
    const unprojected = await call(
      {
        ...annotations(false),
        run: async () => ({
          [MCP_ACTION_RESULT_MARKER]: true,
          text: "Upstream failed",
          raw: { isError: true, code: ticket, startUrl: start },
        }),
      },
      directory(projectResult),
    );
    expect(unprojected).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "probe failed. Its result is not shown: [hidden embed ticket]",
        },
      ],
    });
    expect(markers()).toEqual([]);
    expect(JSON.stringify([unprojected, analytics()])).not.toContain(ticket);
  });

  it("keeps an upstream failure a failure when its result is withheld", async () => {
    const result = await call({
      run: async () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Upstream write failed",
        raw: { isError: true, note: overCap() },
      }),
    });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: `probe failed. ${unchecked}` }],
    });
    expect(markers()).toEqual([]);
  });

  it.each([
    [
      "a hidden flag",
      () =>
        Object.defineProperty({ detail: "failed" }, "isError", {
          value: true,
        }),
    ],
    [
      "an inherited flag",
      () => Object.assign(Object.create({ isError: true }), { detail: "x" }),
    ],
    [
      "an inherited flag on a result that is not JSON",
      () => Object.assign(Object.create({ isError: true }), { count: 1n }),
    ],
    [
      "a flag its JSON form drops",
      () => ({ isError: true, toJSON: () => ({ detail: "failed" }) }),
    ],
    [
      "an inherited getter",
      () =>
        Object.assign(
          Object.create({
            get isError() {
              return true;
            },
          }),
          { detail: "failed" },
        ),
    ],
    [
      "a hidden getter",
      () =>
        Object.defineProperty({ detail: "failed" }, "isError", {
          get: () => true,
        }),
    ],
    [
      "a Proxy that hides its descriptors and drops the flag from its JSON",
      () =>
        new Proxy(
          { isError: true, detail: "failed" },
          {
            getOwnPropertyDescriptor() {
              throw new Error("no descriptors");
            },
            get: (target, key) =>
              key === "toJSON"
                ? () => ({ detail: target.detail })
                : Reflect.get(target, key),
          },
        ),
    ],
  ])("keeps an upstream failure reported by %s", async (_label, raw) => {
    const result = await call({
      run: async () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Upstream failed",
        raw: raw(),
      }),
    });
    expect(result.isError).toBe(true);
    expect(analytics()).toMatchObject([{ isError: true }]);
    expect(markers()).toEqual([]);
  });

  it("never takes a status it could not read for success", async () => {
    let reads = 0;
    const result = await call({
      run: async () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Written",
        get raw() {
          reads += 1;
          return Object.create({
            get isError() {
              throw new Error("No flag");
            },
          });
        },
      }),
    });
    expect(reads).toBe(1);
    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringMatching(
            /^probe ran, but whether it succeeded could not be read; check before retrying\. /,
          ),
        },
      ],
    });
    expect(markers()).toHaveLength(1);

    trace.length = 0;
    const settled = await call({
      run: async () => ({
        [MCP_ACTION_RESULT_MARKER]: true,
        text: "Written",
        get raw() {
          return { isError: false, id: "w" };
        },
      }),
    });
    expect(settled.isError).toBeUndefined();
    expect(markers()).toHaveLength(1);
  });

  it("keeps an upstream failure a projector marks as a success", async () => {
    const result = await call(
      {
        ...annotations(false),
        run: async () => ({
          [MCP_ACTION_RESULT_MARKER]: true,
          text: "Upstream failed",
          raw: { isError: true, detail: "failed" },
        }),
      },
      directory((_name, value) => {
        if (value && typeof value === "object") value.isError = false;
        return value;
      }),
    );
    expect(result.isError).toBe(true);
    expect(markers()).toEqual([]);
  });

  it("checks a failure after the action ran against what it produced", async () => {
    const projectResult = (_name: string, value: any) => {
      if (value && typeof value === "object") {
        throw new Error(`Cannot project code ${value.code}`);
      }
      return value;
    };
    const run = async () => ({ startUrl: start, code: ticket });
    const read = await call(
      { run, ...annotations(true) },
      directory(projectResult),
    );
    expect(read).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Error: [hidden embed ticket]" }],
    });

    trace.length = 0;
    const write = await call(
      { run, ...annotations(false) },
      directory(projectResult),
    );
    expect(write.isError).toBeUndefined();
    expect(write.content).toEqual([
      {
        type: "text",
        text: "probe completed. Its result is not shown: [hidden embed ticket]",
      },
    ]);
    expect(markers()).toHaveLength(1);
    expect(JSON.stringify([read, write])).not.toContain(ticket);
  });

  it("gives a failure's details to an app catalog but not to a directory catalog", async () => {
    const run = async () =>
      fail("An import is already running", {
        errorCode: "import_in_progress",
        details: { importId: "imp_1" },
      });
    const app = await call({ run, ...annotations(false) });
    expect(app.content).toEqual([
      {
        type: "text",
        text:
          "Error: An import is already running (errorCode: import_in_progress)\n" +
          'Error details: {"importId":"imp_1"}',
      },
    ]);
    expect(app.structuredContent).toEqual({
      error: {
        message: "An import is already running",
        errorCode: "import_in_progress",
        details: { importId: "imp_1" },
      },
    });

    const listed = await call(
      { run, ...annotations(false) },
      directory((_name, value) => value),
    );
    expect(listed.content).toEqual([
      {
        type: "text",
        text: "Error: An import is already running (errorCode: import_in_progress)",
      },
    ]);
    expect(listed.structuredContent).toBeUndefined();
  });

  it("captures the checked failure of a write it reports as completed", async () => {
    let result: any;
    const captured = await capturing(async () => {
      result = await call(
        {
          ...annotations(false),
          run: async () => ({ startUrl: start, code: ticket }),
        },
        directory((_name, value: any) => {
          if (value && typeof value === "object") {
            throw new Error(`Cannot project code ${value.code}`);
          }
          return value;
        }),
      );
    });
    expect(result.isError).toBeUndefined();
    expect(analytics()).toMatchObject([{ isError: false }]);
    expect(captured).toEqual([
      {
        message: "[hidden embed ticket]",
        tags: {
          source: "mcp",
          action: "probe",
          failureClass: "tool-response-error",
          stage: "respond",
        },
      },
    ]);
    expect(JSON.stringify(captured)).not.toContain(ticket);
  });

  it("sends a fixed diagnostic everywhere for a result that is not JSON data", async () => {
    let result: any;
    const captured = await capturing(async () => {
      result = await call({
        readOnly: true,
        run: async () => ({
          toJSON() {
            throw new Error(`Cannot serialize ${start}`);
          },
        }),
      });
    });
    const diagnostic =
      "The action result is not JSON data, so it could not be shown.";
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: `Error: ${diagnostic}` }],
    });
    expect(analytics()).toMatchObject([
      { errorType: "result_not_json", errorMessage: diagnostic },
    ]);
    expect(captured).toMatchObject([
      {
        message: diagnostic,
        tags: { action: "probe", stage: "normalize" },
      },
    ]);
  });

  it("checks the whole error, its code included, before it goes anywhere", async () => {
    const projectResult = (_name: string, value: any) => {
      if (value && typeof value === "object") {
        throw new ActionContractError("Projection failed", {
          errorCode: value.code,
        });
      }
      return value;
    };
    let result: any;
    const captured = await capturing(async () => {
      result = await call(
        {
          ...annotations(true),
          run: async () => ({ startUrl: start, code: ticket }),
        },
        directory(projectResult),
      );
    });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Error: [hidden embed ticket]" }],
    });
    expect(analytics()).toMatchObject([
      {
        errorType: "[hidden embed ticket]",
        errorMessage: "[hidden embed ticket]",
      },
    ]);
    // Checked, it is on the wire and in analytics, so it is not captured.
    expect(captured).toEqual([]);
    expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
  });

  it("hides a start URL in an error from before the action returned, in analytics too", async () => {
    const { createMcpApprovalGrant } = await import("./approval-store.js");
    const thrown = () =>
      new ActionContractError(`Cannot open ${start}`, { errorCode: start });
    const outcome = async (action: Record<string, any>) => {
      const result = await call(action);
      return { content: result.content, analytics: analytics() };
    };
    const ran = await outcome({
      run: async () => {
        throw thrown();
      },
    });
    vi.mocked(createMcpApprovalGrant).mockRejectedValueOnce(thrown());
    const approval = await outcome({
      needsApproval: true,
      run: async () => ({ ok: true }),
    });
    const hidden = "[hidden embed URL]";
    for (const failed of [ran, approval]) {
      expect(failed).toEqual({
        content: [
          { type: "text", text: `Error: ${hidden} (errorCode: ${hidden})` },
        ],
        analytics: [
          expect.objectContaining({ errorType: hidden, errorMessage: hidden }),
        ],
      });
    }
    expect(JSON.stringify([ran, approval])).not.toContain(ticket);

    const plain = await outcome({
      run: async () => {
        throw new Error("Plain failure");
      },
    });
    expect(plain).toEqual({
      content: [{ type: "text", text: "Error: Plain failure" }],
      analytics: [
        expect.objectContaining({
          errorType: "Error",
          errorMessage: "Plain failure",
        }),
      ],
    });
  });

  it.each([
    [
      "a contract that fails to compile",
      {
        mcpOutputContract: {
          semantic: {},
          response: {
            type: "object",
            properties: { url: { type: "string", format: start } },
          },
        },
      },
    ],
    ["invalid arguments", { schema: z.object({ url: z.literal(start) }) }],
  ])("hides a start URL in %s, before the action runs", async (_, action) => {
    const result = await call({ ...action, run: async () => ({ ok: true }) });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[hidden embed URL]");
    expect(analytics()).toHaveLength(1);
    expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
    expect(trace.filter((entry: any) => "run" in entry)).toEqual([]);
    expect(markers()).toEqual([]);
  });

  it.each([
    ["names a start URL", Object.assign(new Error("No JSON"), { name: start })],
    [
      "cannot read its name",
      Object.defineProperty(new Error("No JSON"), "name", {
        get() {
          throw new Error(start);
        },
      }),
    ],
  ])(
    "types a contracted write whose result's error %s, reading none of it",
    async (_, error) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let result: any;
      let warnings: unknown[][] = [];
      try {
        result = await call({
          mcpOutputContract: {
            semantic: {},
            response: { type: "object", additionalProperties: true },
          },
          run: async () => ({
            toJSON() {
              throw error;
            },
          }),
        });
      } finally {
        warnings = [...warn.mock.calls];
        warn.mockRestore();
      }
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("(root): not_serializable");
      expect(result.content[0].text).toContain("do not retry");
      expect(analytics()).toMatchObject([
        { errorType: "output_contract_violation" },
      ]);
      expect(markers()).toHaveLength(1);
      expect(warnings).toContainEqual([
        '[mcp] Building the contracted result of "probe" failed after it ran (not_serializable)',
      ]);
      expect(JSON.stringify([result, analytics(), warnings])).not.toContain(
        ticket,
      );
    },
  );

  it("sends a fixed diagnostic for an error from before the action returned that cannot be read", async () => {
    const result = await call({
      run: async () => {
        throw Object.defineProperty(new Error("Unread"), "message", {
          get() {
            throw new Error(start);
          },
        });
      },
    });
    const diagnostic = "The call failed, and its error could not be read.";
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: `Error: ${diagnostic}` }],
    });
    expect(analytics()).toMatchObject([
      { errorType: "error_unreadable", errorMessage: diagnostic },
    ]);
    expect(markers()).toHaveLength(1);
    expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
  });

  const unreadable: Array<[string, () => unknown]> = [
    [
      "a contract flag that throws",
      () =>
        Object.defineProperty(new Error("Invalid"), "actionContractError", {
          get() {
            throw new Error(start);
          },
        }),
    ],
    [
      "a Proxy whose get trap throws",
      () =>
        new Proxy(new Error("Invalid"), {
          get() {
            throw new Error(start);
          },
        }),
    ],
    [
      "a Proxy whose getPrototypeOf trap throws",
      () =>
        new Proxy(new Error("Invalid"), {
          getPrototypeOf() {
            throw new Error(start);
          },
        }),
    ],
    [
      "a revoked Proxy",
      () => {
        const { proxy, revoke } = Proxy.revocable(new Error("Invalid"), {});
        revoke();
        return proxy;
      },
    ],
  ];
  it.each(
    unreadable.flatMap(([kind, thrown]) =>
      [true, false].map((readOnly) => ({ kind, thrown, readOnly })),
    ),
  )(
    "refuses arguments whose validation throws $kind (readOnly: $readOnly), reading none of it",
    async ({ thrown, readOnly }) => {
      const result = await call({
        readOnly,
        schema: z.object({}).superRefine(() => {
          throw thrown();
        }),
        run: async () => ({ ok: true }),
      });
      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: "Error: The call failed, and its error could not be read.",
          },
        ],
      });
      expect(analytics()).toMatchObject([{ errorType: "error_unreadable" }]);
      expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
      expect(trace.filter((entry: any) => "run" in entry)).toEqual([]);
      expect(markers()).toEqual([]);
    },
  );

  it.each([
    [
      "a change hint that throws with the result",
      (_args: unknown, result: any) => {
        throw new Error(`Cannot hint ${result.startUrl}`);
      },
      "[action-change] changeResource threw",
    ],
    [
      "a change hint error whose message cannot be read",
      (_args: unknown, result: any) => {
        throw Object.defineProperty(new Error("Unread"), "message", {
          get() {
            throw new Error(`Cannot read ${result.startUrl}`);
          },
        });
      },
      "[action-change] changeResource threw",
    ],
    [
      "a change hint whose getter throws when read again",
      (_args: unknown, result: any) => {
        let reads = 0;
        return {
          get resourceType() {
            reads += 1;
            if (reads > 2) throw new Error(result.startUrl);
            return "review";
          },
          resourceId: "r1",
        };
      },
      undefined,
    ],
  ])("logs %s with no embed credential", async (_, changeResource, warning) => {
    let result: any;
    const lines = await logged(async () => {
      result = await call({
        changeResource,
        run: async () => ({ startUrl: start }),
      });
    });
    expect(result.isError).toBeUndefined();
    expect(markers()).toHaveLength(1);
    if (warning) expect(lines.join("\n")).toContain(warning);
    expect(lines.join("\n")).not.toContain(ticket);
  });

  it("logs a change-marker store failure with no embed credential", async () => {
    const { writeActionChangeMarker } =
      await import("../server/action-change-marker-write.js");
    vi.mocked(writeActionChangeMarker).mockRejectedValueOnce(
      new Error(`Store rejected ${start}`),
    );
    let result: any;
    const lines = await logged(async () => {
      result = await call({ run: async () => ({ id: "written" }) });
    });
    expect(result.isError).toBeUndefined();
    expect(lines.join("\n")).toContain(
      "Could not write the action-change marker",
    );
    expect(lines.join("\n")).not.toContain(ticket);
  });

  it("logs an MCP App resource that fails to resolve with no embed credential", async () => {
    // Resource metadata can read what the action keeps between calls.
    let lastStart: string | undefined;
    const lines = await logged(async () => {
      await call({
        readOnly: true,
        mcpApp: {
          resource: {
            title: "Probe",
            html: "<!doctype html><html><body>Probe</body></html>",
            csp() {
              throw new Error(lastStart ?? "No start URL yet");
            },
          },
        },
        run: async () => {
          lastStart = start;
          return { startUrl: start };
        },
      });
    });
    expect(lines.join("\n")).toContain("Skipping MCP App resource");
    expect(lines.join("\n")).not.toContain(ticket);
  });

  it.each([
    ["throws with it", { throws: true }],
    ["reports an issue naming it", { message: true }],
    ["reports an issue at a key that names it", { path: true }],
  ])(
    "logs an output schema that %s with no embed credential",
    async (
      _,
      kind: { throws?: boolean; message?: boolean; path?: boolean },
    ) => {
      const lines = await logged(async () => {
        await call({
          readOnly: true,
          outputSchema: z
            .object({ startUrl: z.string() })
            .superRefine((value, ctx) => {
              if (kind.throws) {
                throw new Error(`Cannot validate ${value.startUrl}`);
              }
              ctx.addIssue({
                code: "custom",
                message: kind.message
                  ? `Cannot validate ${value.startUrl}`
                  : "Unexpected key",
                path: kind.path ? [value.startUrl] : [],
              });
            }),
          run: async () => ({ startUrl: start }),
        });
      });
      expect(lines.join("\n")).toContain("Action output");
      expect(lines.join("\n")).not.toContain(ticket);
    },
  );

  it("checks a failure against a projection the call already built", async () => {
    // The first projection assembles a start URL; the second fails echoing
    // its ticket.
    const projectResult = (_name: string, value: any) => {
      if (value && typeof value === "object") {
        return {
          ...value,
          startUrl: `${ORIGIN}${value.base}/${value.part}?ticket=${value.ticket}`,
        };
      }
      if (value === "Read") throw new Error(`Cannot project ${ticket}`);
      return value;
    };
    let result: any;
    const captured = await capturing(async () => {
      result = await call(
        {
          ...annotations(true),
          run: async () => ({
            [MCP_ACTION_RESULT_MARKER]: true,
            text: "Read",
            raw: { base: "/_agent-native/embed", part: "start", ticket },
          }),
        },
        directory(projectResult),
      );
    });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Error: [hidden embed ticket]" }],
    });
    expect(captured).toEqual([]);
    expect(JSON.stringify([result, analytics()])).not.toContain(ticket);
  });

  it("checks images against everything the call built, its link included", async () => {
    const result = await call({
      readOnly: true,
      run: async () => ({
        base: "/_agent-native/embed",
        part: "start",
        ticket,
        _agentImages: [{ data: ticket, mediaType: "image/png" }],
      }),
      link: ({ result }: any) => ({
        label: "Open",
        url: `${ORIGIN}${result.base}/${result.part}?ticket=${result.ticket}`,
      }),
    });
    expect(
      result.content.filter((block: any) => block.type === "image"),
    ).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(ticket);
  });

  it("builds a link from the result as returned, then checks it", async () => {
    const result = await call({
      readOnly: true,
      run: async () => ({ id: "record-1", startUrl: start }),
      link: ({ result }: any) => ({
        label: "Open record",
        url: new URL(`/records/${result.id}`, new URL(result.startUrl).origin)
          .href,
      }),
    });
    const url = `${ORIGIN}/records/record-1`;
    expect(result.content[1].text).toContain(`(${url})`);
    expect(result._meta["agent-native/openLink"].webUrl).toBe(url);
    expect(JSON.stringify(result)).not.toContain(ticket);
  });

  it("still drops an image that echoes a ticket, and one too large to send", async () => {
    const result = await call({
      readOnly: true,
      run: async () => ({
        startUrl: start,
        _agentImages: [
          { data: ticket, mediaType: "image/png" },
          { data: "QUJD".repeat(600_000), mediaType: "image/png" },
        ],
      }),
    });
    expect(
      result.content.filter((block: any) => block.type === "image"),
    ).toEqual([]);
    expect(result.content[0].text).toContain(
      "[image #1 dropped: it carried an embed credential]",
    );
    expect(result.content[0].text).toContain(
      "exceeds the 2,000,000-char limit",
    );
    expect(JSON.stringify(result)).not.toContain(ticket);
  });

  it("records a widget write that produced nothing, flagged so no empty widget mounts", async () => {
    const write = await call({ mcpApp: widget, run: async () => null });
    // `isError` is how a host is told not to mount the widget; the text says
    // the write ran, so it is not retried.
    expect(write).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "probe completed; its change was saved, but it produced no widget content.",
        },
      ],
    });
    expect(markers()).toHaveLength(1);

    trace.length = 0;
    const read = await call({
      mcpApp: widget,
      readOnly: true,
      run: async () => null,
    });
    expect(read.isError).toBe(true);
    expect(markers()).toEqual([]);
  });

  it("sends images from the checked copy, leaving out one that carried a credential", async () => {
    const image = "iVBORw0KGgo=";
    const result = await call({
      readOnly: true,
      run: async () => ({
        startUrl: start,
        _agentImages: [
          { data: ticket, mediaType: "image/png" },
          { data: image, mediaType: "image/png" },
        ],
      }),
    });
    expect(
      result.content.filter((block: any) => block.type === "image"),
    ).toEqual([{ type: "image", data: image, mimeType: "image/png" }]);
    expect(result.content[0].text).toContain(
      "[image #1 dropped: it carried an embed credential]",
    );
    expect(JSON.stringify(result)).not.toContain(ticket);
  });

  it("mints no widget session for a write that is not JSON data", async () => {
    // Minting reads the result's target, so there is nothing to mint from.
    const result = await call({
      mcpApp: widget,
      run: async () => ({
        app: "mail",
        embed: true,
        url: "/inbox/thread-1",
        count: 1n,
      }),
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: "text", text: `probe completed. ${unchecked}` },
    ]);
    expect(result._meta?.["agent-native/embedStart"]).toBeUndefined();
    expect(markers()).toHaveLength(1);
  });
});
