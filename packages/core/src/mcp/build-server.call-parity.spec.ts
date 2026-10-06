import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionContractError, defineAction } from "../action.js";
import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
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

vi.mock("./approval-store.js", () => ({
  createMcpApprovalGrant: vi.fn(async (grant: any) => {
    trace.push({ grantCreate: grant });
    approvalGrants.set(grant.nonce, { ...grant, consumed: false });
  }),
  consumeMcpApprovalGrant: vi.fn(async (grant: any) => {
    const existing = approvalGrants.get(grant.nonce);
    const consumed = Boolean(
      existing &&
      !existing.consumed &&
      existing.expiresAt >= Date.now() &&
      existing.callerKey === grant.callerKey &&
      existing.actionName === grant.actionName &&
      existing.argumentsHash === grant.argumentsHash,
    );
    if (consumed) existing.consumed = true;
    trace.push({ grantConsume: { ...grant, consumed } });
    return consumed;
  }),
}));

vi.mock("../org/context.js", () => ({
  resolveOrgByDomain: vi.fn(async () => null),
  resolveA2AOrganizationMetadataById: vi.fn(async () => null),
  resolveOrgIdForEmail: vi.fn(async () => null),
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
  return options.toolMeta
    ? { ...defined, tool: { ...defined.tool, _meta: options.toolMeta } }
    : defined;
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
    return val;
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
    ["throws-string"],
    ["bigint-write"],
    ["bigint-read"],
    ["cycle-write"],
    ["cycle-read"],
    ["wrapped-ok"],
    ["wrapped-error"],
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

  it("approval: a client without elicitation cannot be asked", async () => {
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
