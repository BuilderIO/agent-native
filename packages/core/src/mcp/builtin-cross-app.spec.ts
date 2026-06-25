import { createServer } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as callerAuth from "../a2a/caller-auth.js";
import * as a2aClient from "../a2a/client.js";
import * as embedSession from "../server/embed-session.js";
import { runWithRequestContext } from "../server/request-context.js";
import { verifyAuth } from "./build-server.js";
import type { MCPConfig } from "./build-server.js";
import { getBuiltinCrossAppTools } from "./builtin-tools.js";
import * as orgDirectory from "./org-directory.js";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ACCESS_TOKEN;
  delete process.env.ACCESS_TOKENS;
  delete process.env.A2A_SECRET;
  delete process.env.AGENT_NATIVE_OWNER_EMAIL;
  delete process.env.AGENT_NATIVE_ORG_DIRECTORY_URL;
  delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
  delete process.env.APP_BASE_PATH;
  delete process.env.VITE_APP_BASE_PATH;
}

beforeEach(resetEnv);
afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Issue 1 — ACCESS_TOKEN auth must not lose caller identity
// ---------------------------------------------------------------------------

describe("verifyAuth — static-token caller identity", () => {
  it("dev-open with no owner hint has no identity (unchanged behavior)", async () => {
    const res = await verifyAuth(undefined);
    expect(res.authed).toBe(true);
    expect(res.identity).toBeUndefined();
  });

  it("dev-open derives identity from AGENT_NATIVE_OWNER_EMAIL env", async () => {
    process.env.AGENT_NATIVE_OWNER_EMAIL = "owner@example.com";
    const res = await verifyAuth(undefined);
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("owner@example.com");
  });

  it("dev-open derives identity from the forwarded owner-email header", async () => {
    const res = await verifyAuth(undefined, "hdr@example.com");
    expect(res.identity?.userEmail).toBe("hdr@example.com");
  });

  it("rejects dev-open owner hints when the route is not loopback/local", async () => {
    const res = await verifyAuth(undefined, "hdr@example.com", {
      allowDevOpen: false,
    });
    expect(res.authed).toBe(false);
    expect(res.identity).toBeUndefined();
  });

  it("static ACCESS_TOKEN match derives identity from owner env", async () => {
    process.env.ACCESS_TOKEN = "tok-123";
    process.env.AGENT_NATIVE_OWNER_EMAIL = "env-owner@example.com";
    const res = await verifyAuth("Bearer tok-123");
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("env-owner@example.com");
  });

  it("server env wins over the forwarded header on the static-token path (no impersonation via a leaked token)", async () => {
    process.env.ACCESS_TOKEN = "tok-123";
    process.env.AGENT_NATIVE_OWNER_EMAIL = "env-owner@example.com";
    const res = await verifyAuth("Bearer tok-123", "attacker@evil.com");
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("env-owner@example.com");
  });

  it("forwarded header is used only as a fallback when the owner env is unset", async () => {
    process.env.ACCESS_TOKEN = "tok-123";
    delete process.env.AGENT_NATIVE_OWNER_EMAIL;
    const res = await verifyAuth("Bearer tok-123", "header-owner@example.com");
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("header-owner@example.com");
  });

  it("rejects an unknown token regardless of owner hint", async () => {
    process.env.ACCESS_TOKEN = "tok-123";
    const res = await verifyAuth("Bearer wrong", "owner@example.com");
    expect(res.authed).toBe(false);
    expect(res.identity).toBeUndefined();
  });

  it("a valid JWT identity is not overridden by the owner header", async () => {
    process.env.A2A_SECRET = "jwt-secret";
    const jose = await import("jose");
    const token = await new jose.SignJWT({
      sub: "jwt-user@example.com",
      org_domain: "acme.com",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("jwt-secret"));
    const res = await verifyAuth(`Bearer ${token}`, "spoof@evil.com");
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("jwt-user@example.com");
    expect(res.identity?.orgDomain).toBe("acme.com");
  });
});

// ---------------------------------------------------------------------------
// Issue 2 / 3 — open_app + ask_app honesty for same-app / standalone
// (cross-app workspace resolution needs a real workspace dir and is covered
//  by the workspace-resolve path; here we lock the deterministic behavior.)
// ---------------------------------------------------------------------------

function baseConfig(over: Partial<MCPConfig> = {}): MCPConfig {
  return {
    name: "Mail",
    appId: "mail",
    description: "test",
    actions: {},
    ...over,
  };
}

async function reserveUnusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port =
    address && typeof address === "object" && typeof address.port === "number"
      ? address.port
      : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

describe("open_app — same-app / standalone keeps a relative deep link", () => {
  it("returns a relative /_agent-native/open path for the current app", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig());
    const result: any = await tools.open_app.run({
      app: "mail",
      view: "inbox",
      params: { threadId: "abc" },
    });
    expect(result.url).toBe(
      "/_agent-native/open?app=mail&view=inbox&threadId=abc&agentSidebar=closed",
    );
    expect(result.url.startsWith("/")).toBe(true);
  });

  it("can return a direct same-origin app path for full-app embeds", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig());
    const result: any = await tools.open_app.run({
      app: "mail",
      path: "/extensions/ext_123",
      params: { tab: "settings" },
      embed: true,
    });
    expect(result.url).toBe("/extensions/ext_123?tab=settings");
    expect(result.embed).toBe(true);
  });

  it("uses a direct app route for embedded view links", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig());
    const result: any = await tools.open_app.run({
      app: "mail",
      view: "inbox",
      params: { threadId: "abc" },
      embed: true,
    });
    expect(result.url).toBe("/inbox?threadId=abc");
    expect(result.embedStartUrl).toBeUndefined();
    expect(result.deepLinkUrl).toBeUndefined();
    expect(result.embed).toBe(true);
  });

  it("mints a same-app embed start URL for authenticated MCP app callers", async () => {
    const createTicket = vi
      .spyOn(embedSession, "createEmbedSessionTicket")
      .mockResolvedValue({
        ticket: "ticket-123",
        ticketHash: "hash-123",
        expiresAt: 123456,
      });
    const tools = getBuiltinCrossAppTools(baseConfig(), {
      origin: "https://mail.example.com",
    });

    const result: any = await runWithRequestContext(
      { userEmail: "owner@example.com", orgId: "org-123" },
      () =>
        tools.open_app.run({
          app: "mail",
          view: "inbox",
          params: { threadId: "abc" },
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(result.url).toBe("/inbox?threadId=abc");
    expect(result.embedStartUrl).toBe(
      "https://mail.example.com/_agent-native/embed/start?ticket=ticket-123",
    );
    expect(result.embedTargetPath).toBe(
      "/inbox?threadId=abc&__an_mcp_chat_bridge=1",
    );
    expect(result.embedExpiresAt).toBe(123456);
    expect(createTicket).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      orgId: "org-123",
      targetPath: "/inbox?threadId=abc&__an_mcp_chat_bridge=1",
      scope: "minimal",
    });
  });

  it("requests the default app viewport for full-app MCP App embeds", () => {
    const tools = getBuiltinCrossAppTools(baseConfig());
    const resource = tools.open_app.mcpApp?.resource;
    const html =
      typeof resource?.html === "function"
        ? resource.html({ actionName: "open_app", appId: "mail" })
        : resource?.html;

    expect(html).toContain("--agent-native-shell-height: 560px");
    expect(html).toContain("--agent-native-viewport-height: 516px");
  });

  it("accepts string embed:true from MCP clients that stringify arguments", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig());
    const result: any = await tools.open_app.run({
      app: "mail",
      view: "inbox",
      params: { threadId: "abc" },
      embed: "true",
    });
    expect(result.url).toBe("/inbox?threadId=abc");
    expect(result.embed).toBe(true);
  });

  it("promotes embed and chrome from params for hosts that nest open options", async () => {
    const createTicket = vi
      .spyOn(embedSession, "createEmbedSessionTicket")
      .mockResolvedValue({
        ticket: "ticket-params",
        ticketHash: "hash-params",
        expiresAt: 987654,
      });
    const tools = getBuiltinCrossAppTools(baseConfig(), {
      origin: "https://mail.example.com",
    });

    const result: any = await runWithRequestContext(
      { userEmail: "owner@example.com", orgId: "org-123" },
      () =>
        tools.open_app.run({
          app: "mail",
          view: "inbox",
          params: {
            embed: true,
            chrome: "minimal",
            threadId: "abc",
          },
        }),
    );

    expect(result.url).toBe("/inbox?threadId=abc");
    expect(result.embed).toBe(true);
    expect(result.embedStartUrl).toBe(
      "https://mail.example.com/_agent-native/embed/start?ticket=ticket-params",
    );
    expect(createTicket).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      orgId: "org-123",
      targetPath: "/inbox?threadId=abc&__an_mcp_chat_bridge=1",
      scope: "minimal",
    });
  });

  it("prefixes direct same-app paths with the configured app base path", async () => {
    process.env.APP_BASE_PATH = "/mail";
    const tools = getBuiltinCrossAppTools(baseConfig());
    const result: any = await tools.open_app.run({
      app: "mail",
      path: "/extensions/ext_123",
      params: { tab: "settings" },
      embed: true,
    });
    expect(result.url).toBe("/mail/extensions/ext_123?tab=settings");
    expect(result.embed).toBe(true);
  });

  it("defaults to the app's home page when neither view nor path is given", async () => {
    // Bare `open_app({app:"mail"})` should land on `/`, not throw — otherwise
    // hosts (ChatGPT/Claude) waste a turn on the model's first-attempt retry
    // when it omits view/path on initial call. See PR #884 chrome agent
    // findings: "first open_app({app:'dispatch'}) returns parameter error".
    const tools = getBuiltinCrossAppTools(baseConfig());
    const result: any = await tools.open_app.run({ app: "mail" });
    expect(result.url).toMatch(/^\/$/);
    expect(result.app).toBe("mail");
  });

  it("still rejects open_app calls without an app id", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig());
    await expect(tools.open_app.run({} as any)).rejects.toThrow(
      /requires 'app'/,
    );
  });
});

describe("create_embed_session", () => {
  it("is write-scoped because the embed ticket becomes a browser session", () => {
    const tools = getBuiltinCrossAppTools(baseConfig(), {
      origin: "https://mail.example.com",
    });
    expect(tools.create_embed_session.readOnly).toBe(false);
  });

  it("requires an authenticated MCP caller", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig(), {
      origin: "https://mail.example.com",
    });
    await expect(
      tools.create_embed_session.run({ path: "/inbox" }),
    ).rejects.toThrow(/authenticated MCP caller/);
  });
});

describe("list_apps — reports the live request origin for the current app", () => {
  // Bug #2: a single-app dev server reached over `connect` was reporting a
  // guessed `PORT || 5173` URL + `running:false` (wrong whenever the dev
  // server picked another port, e.g. `agent-native dev` on :8080). The MCP
  // request is served BY the app, so the inbound origin is authoritative.
  it("uses requestMeta.origin and running:true for the served app", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig({ appId: "content" }), {
      origin: "http://localhost:8080",
    });
    const result: any = await tools.list_apps.run({});
    expect(result.workspace).toBe(false);
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0].url).toBe("http://localhost:8080");
    expect(result.apps[0].port).toBe(8080);
    expect(result.apps[0].running).toBe(true);
  });

  it("falls back to probed values when no request origin is known (stdio standalone)", async () => {
    process.env.PORT = String(await reserveUnusedPort());
    const tools = getBuiltinCrossAppTools(baseConfig({ appId: "content" }));
    const result: any = await tools.list_apps.run({});
    expect(result.apps).toHaveLength(1);
    // No live origin → keep the resolver's URL (not overridden to a bogus
    // live origin) and its real TCP-probe running state.
    expect(result.apps[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(result.apps[0].running).toBe(false);
  });
});

describe("ask_app — honest routing metadata", () => {
  it("answers locally and reports routedVia:local for the current app", async () => {
    let received: string | undefined;
    const tools = getBuiltinCrossAppTools(
      baseConfig({
        askAgent: async (m: string) => {
          received = m;
          return "local-answer";
        },
      }),
    );
    const result: any = await tools.ask_app.run({
      app: "mail",
      message: "hello",
    });
    expect(received).toBe("hello");
    expect(result.routedVia).toBe("local");
    expect(result.app).toBe("mail");
    expect(result.response).toBe("local-answer");
    expect(result.note).toBeUndefined();
  });

  it("submits hosted same-app asks as durable A2A tasks", async () => {
    const askAgent = vi.fn(async () => "local-answer");
    vi.spyOn(callerAuth, "resolveA2ACallerAuth").mockResolvedValue({
      apiKey: "signed-org-jwt",
      userEmail: "caller@acme.com",
      orgId: "org-1",
      orgDomain: "acme.com",
      orgSecret: "org-secret",
      metadata: {},
    });
    const sendSpy = vi
      .spyOn(a2aClient.A2AClient.prototype, "send")
      .mockResolvedValue({
        id: "task-1",
        status: {
          state: "working",
          timestamp: "2026-06-15T00:00:00.000Z",
        },
        history: [],
        artifacts: [],
      } as any);

    const tools = getBuiltinCrossAppTools(baseConfig({ askAgent }), {
      origin: "https://mail.example.com",
    });
    const result: any = await tools.ask_app.run({
      app: "mail",
      message: "hello",
      async: true,
    });

    expect(askAgent).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      {
        async: true,
        metadata: { userEmail: "caller@acme.com", orgDomain: "acme.com" },
      },
    );
    expect(result).toMatchObject({
      app: "mail",
      routedVia: "local",
      taskId: "task-1",
      status: "working",
      poll: {
        tool: "ask_app_status",
        arguments: { app: "mail", taskId: "task-1" },
      },
    });
  });

  it("polls hosted ask_app tasks by task id", async () => {
    vi.spyOn(callerAuth, "resolveA2ACallerAuth").mockResolvedValue({
      apiKey: "signed-org-jwt",
      userEmail: "caller@acme.com",
      orgId: "org-1",
      orgDomain: "acme.com",
      orgSecret: "org-secret",
      metadata: {},
    });
    const getTaskSpy = vi
      .spyOn(a2aClient.A2AClient.prototype, "getTask")
      .mockResolvedValue({
        id: "task-1",
        status: {
          state: "completed",
          timestamp: "2026-06-15T00:00:01.000Z",
          message: {
            role: "agent",
            parts: [{ type: "text", text: "local answer" }],
          },
        },
        history: [],
        artifacts: [],
      } as any);

    const tools = getBuiltinCrossAppTools(
      baseConfig({ askAgent: async () => "unused" }),
      { origin: "https://mail.example.com" },
    );
    const result: any = await tools.ask_app_status.run({
      app: "mail",
      taskId: "task-1",
    });

    expect(getTaskSpy).toHaveBeenCalledWith("task-1");
    expect(result).toMatchObject({
      app: "mail",
      routedVia: "local",
      taskId: "task-1",
      status: "completed",
      response: "local answer",
    });
  });

  it("does not falsely claim delegation when the target is unreachable", async () => {
    const tools = getBuiltinCrossAppTools(
      baseConfig({
        askAgent: async () => "local-answer",
      }),
    );
    // "calendar" is not a resolvable workspace app in this test env, so it
    // falls back to local but must say so honestly.
    const result: any = await tools.ask_app.run({
      app: "calendar",
      message: "hi",
    });
    expect(result.routedVia).toBe("local");
    expect(result.app).toBe("mail");
    expect(typeof result.note).toBe("string");
    expect(result.note).toContain("calendar");
  });

  it("throws when no agent handler exists and target is local", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig());
    await expect(tools.ask_app.run({ message: "hi" })).rejects.toThrow(
      /does not expose an agent/,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 3b — org-directory auto-discovery merged into list_apps / ask_app
// ---------------------------------------------------------------------------

describe("list_apps — org-directory merge", () => {
  it("no directory env ⇒ fetchOrgApps()=[] and list_apps unchanged", async () => {
    // No directory env configured: the real fetchOrgApps short-circuits to []
    // so list_apps must report only the local/workspace app(s).
    const tools = getBuiltinCrossAppTools(baseConfig());
    const result: any = await tools.list_apps.run({});
    expect(Array.isArray(result.apps)).toBe(true);
    for (const a of result.apps) {
      expect(a.source).toBe("workspace");
    }
  });

  it("directory returns apps ⇒ list_apps merges + dedupes by id/origin", async () => {
    vi.spyOn(orgDirectory, "fetchOrgApps").mockResolvedValue([
      {
        id: "calendar",
        name: "Calendar",
        url: "https://calendar.acme.com",
        a2aUrl: "https://calendar.acme.com/_agent-native/a2a",
      },
      {
        // Duplicate id of the current app — must be deduped out.
        id: "mail",
        name: "Mail",
        url: "https://mail.acme.com",
        a2aUrl: "https://mail.acme.com/_agent-native/a2a",
      },
    ]);

    const tools = getBuiltinCrossAppTools(baseConfig());
    const result: any = await tools.list_apps.run({});
    const calendar = result.apps.find((a: any) => a.id === "calendar");
    expect(calendar).toBeDefined();
    expect(calendar.source).toBe("org-directory");
    expect(calendar.url).toBe("https://calendar.acme.com");
    // Only one "mail" entry — the workspace one wins, the directory dup drops.
    expect(result.apps.filter((a: any) => a.id === "mail").length).toBe(1);
  });
});

describe("ask_app — org-directory routing", () => {
  it("routes an org-directory-only app over A2A and reports it honestly", async () => {
    vi.spyOn(orgDirectory, "fetchOrgApps").mockResolvedValue([
      {
        id: "calendar",
        name: "Calendar",
        url: "https://calendar.acme.com",
        a2aUrl: "https://calendar.acme.com/_agent-native/a2a",
      },
    ]);
    const callAgentSpy = vi
      .spyOn(a2aClient, "callAgent")
      .mockResolvedValue("calendar-says-hi");
    vi.spyOn(callerAuth, "resolveA2ACallerAuth").mockResolvedValue({
      apiKey: "signed-org-jwt",
      userEmail: "caller@acme.com",
      orgId: "org-1",
      orgDomain: "acme.com",
      orgSecret: "org-secret",
      metadata: {},
    });

    const tools = getBuiltinCrossAppTools(
      baseConfig({ askAgent: async () => "local-answer" }),
    );
    const result: any = await tools.ask_app.run({
      app: "calendar",
      message: "what's on my schedule?",
    });

    // Routed over A2A against the directory's a2aUrl — not answered locally.
    expect(callAgentSpy).toHaveBeenCalledTimes(1);
    expect(callAgentSpy.mock.calls[0][0]).toBe(
      "https://calendar.acme.com/_agent-native/a2a",
    );
    expect(callAgentSpy.mock.calls[0][2]).toMatchObject({
      apiKey: "signed-org-jwt",
      userEmail: "caller@acme.com",
      orgDomain: "acme.com",
      orgSecret: "org-secret",
    });
    expect(result.routedVia).toBe("a2a");
    expect(result.app).toBe("calendar");
    expect(result.response).toBe("calendar-says-hi");
    expect(result.note).toBeUndefined();
  });

  it("directory error ⇒ silent [] ⇒ falls back to honest local answer", async () => {
    vi.spyOn(orgDirectory, "fetchOrgApps").mockResolvedValue([]);
    const callAgentSpy = vi.spyOn(a2aClient, "callAgent");

    const tools = getBuiltinCrossAppTools(
      baseConfig({ askAgent: async () => "local-answer" }),
    );
    const result: any = await tools.ask_app.run({
      app: "calendar",
      message: "hi",
    });

    expect(callAgentSpy).not.toHaveBeenCalled();
    expect(result.routedVia).toBe("local");
    expect(result.app).toBe("mail");
    expect(typeof result.note).toBe("string");
    expect(result.note).toContain("calendar");
    expect(result.response).toBe("local-answer");
  });
});
