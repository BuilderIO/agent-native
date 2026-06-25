import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActionEntry } from "../agent/production-agent.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";
import { createAgentNativeEmbeddedPlugin } from "./embedded.js";

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

const ORIGINAL_ENV = {
  APP_NAME: process.env.APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
  AGENT_MODE: process.env.AGENT_MODE,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

interface DispatchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function dispatch(
  nitroApp: any,
  pathname: string,
  { method = "GET", body, headers = {} }: DispatchOptions = {},
) {
  const url = `https://host.test${pathname}`;
  const requestHeaders = new Headers(headers);
  if (body !== undefined && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  const req = new Request(url, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const responseHeaders = new Headers();
  const event = {
    method,
    url: new URL(url),
    path: pathname,
    context: {},
    req,
    headers: requestHeaders,
    res: {
      status: 200,
      headers: responseHeaders,
    },
    node: {
      req: {
        method,
        url: pathname,
        headers: Object.fromEntries(
          Array.from(requestHeaders.entries()).map(([key, value]) => [
            key.toLowerCase(),
            value,
          ]),
        ),
      },
      res: {
        statusCode: 200,
        setHeader(name: string, value: string) {
          responseHeaders.set(name, value);
        },
      },
    },
  };

  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };

  const result = await next();
  return {
    body: result,
    status: event.res.status ?? event.node.res.statusCode,
    headers: responseHeaders,
  };
}

describe("embedded Agent-Native host fixture", () => {
  let tempDir = "";

  beforeAll(() => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), "agent-native-embedded-"));
    process.env.NODE_ENV = "test";
    process.env.AGENT_MODE = "production";
  });

  afterAll(async () => {
    vi.useRealTimers();
    await closeDbExec();
    restoreEnv();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("mounts host auth, managed SQL routes, actions, browser sessions, and extensions", async () => {
    let currentUser = {
      userId: "host-user-1",
      email: "alice@host.test",
      name: "Alice Host",
      orgId: "host-org-1",
      orgRole: "admin",
    };
    const actions: Record<string, ActionEntry> = {
      "host-echo": {
        tool: {
          description: "Echo host params and request context",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
          },
        },
        run: async (params: Record<string, unknown>) => ({
          params,
          userEmail: getRequestUserEmail(),
          orgId: getRequestOrgId(),
        }),
      } as ActionEntry,
    };
    const nitroApp = createNitroApp();
    const plugin = createAgentNativeEmbeddedPlugin({
      databaseUrl: `file:${join(tempDir, "embedded.db")}`,
      auth: async () => currentUser,
      actions,
      agentChat: {
        appId: "embedded-fixture",
        leanPrompt: true,
        systemPrompt: "You are an embedded test agent.",
      },
      sentry: false,
      resources: false,
      onboarding: false,
      integrations: false,
      terminal: false,
    });
    await plugin(nitroApp);

    await expect(
      dispatch(nitroApp, "/_agent-native/actions/host-echo", {
        method: "POST",
        headers: { "X-Agent-Native-CSRF": "1" },
        body: { value: "ok" },
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        params: { value: "ok" },
        userEmail: "alice@host.test",
        orgId: "host-org-1",
      },
    });

    await expect(
      dispatch(nitroApp, "/_agent-native/browser-sessions", {
        method: "POST",
        headers: { "X-Agent-Native-CSRF": "1" },
        body: {
          session: { id: "tab-1", label: "Builder editor" },
          context: {
            route: { name: "builder-editor" },
            resource: { type: "content", id: "content-1" },
          },
          actions: [
            {
              name: "select-element",
              description: "Select an element in the editor",
              schema: { type: "object" },
            },
          ],
        },
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        session: {
          sessionId: "tab-1",
          label: "Builder editor",
          active: true,
        },
      },
    });

    await expect(
      dispatch(nitroApp, "/_agent-native/browser-sessions"),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        sessions: [
          {
            sessionId: "tab-1",
            context: {
              resource: { type: "content", id: "content-1" },
            },
            actions: [{ name: "select-element" }],
          },
        ],
      },
    });

    const created = await dispatch(nitroApp, "/_agent-native/extensions", {
      method: "POST",
      headers: { "X-Agent-Native-CSRF": "1" },
      body: {
        name: "Embedded fixture extension",
        description: "Stored through host-auth embedded runtime",
        content: "<div>hello</div>",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Embedded fixture extension",
      ownerEmail: "alice@host.test",
      orgId: "host-org-1",
    });
    const extensionId = (created.body as { id: string }).id;

    await expect(
      dispatch(nitroApp, `/_agent-native/extensions/${extensionId}`, {
        method: "PUT",
        headers: { "X-Agent-Native-CSRF": "1" },
        body: { visibility: "org" },
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        id: extensionId,
        visibility: "org",
      },
    });

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes`,
        {
          method: "POST",
          headers: { "X-Agent-Native-CSRF": "1" },
          body: {
            id: "content-1",
            scope: "org",
            data: { text: "Shared org note" },
          },
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        id: "content-1",
        extensionId,
        scope: "org",
        orgId: "host-org-1",
      },
    });

    const rows = await dispatch(
      nitroApp,
      `/_agent-native/extensions/data/${extensionId}/notes?scope=org`,
    );
    expect(rows.status).toBe(200);
    expect(rows.body).toEqual([
      expect.objectContaining({
        id: "content-1",
        tool_id: extensionId,
        scope: "org",
        org_id: "host-org-1",
        data: JSON.stringify({ text: "Shared org note" }),
      }),
    ]);

    currentUser = {
      userId: "host-user-2",
      email: "viewer@host.test",
      name: "Viewer Host",
      orgId: "host-org-1",
      orgRole: "member",
    };

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes?scope=org`,
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: [
        expect.objectContaining({
          id: "content-1",
          data: JSON.stringify({ text: "Shared org note" }),
        }),
      ],
    });

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes`,
        {
          method: "POST",
          headers: { "X-Agent-Native-CSRF": "1" },
          body: {
            id: "viewer-write",
            scope: "org",
            data: { text: "Should be rejected" },
          },
        },
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: {
        error: expect.stringContaining("Requires editor role"),
      },
    });

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes/content-1?scope=org`,
        {
          method: "DELETE",
          headers: { "X-Agent-Native-CSRF": "1" },
        },
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: {
        error: expect.stringContaining("Requires editor role"),
      },
    });

    const afterViewerDelete = await dispatch(
      nitroApp,
      `/_agent-native/extensions/data/${extensionId}/notes?scope=org`,
    );
    expect(afterViewerDelete.status).toBe(200);
    expect(afterViewerDelete.body).toEqual([
      expect.objectContaining({
        id: "content-1",
        data: JSON.stringify({ text: "Shared org note" }),
      }),
    ]);

    await getDbExec().execute({
      sql: `INSERT INTO tool_shares (id, resource_id, principal_type, principal_id, role, created_by, created_at)
        VALUES (?, ?, 'user', ?, 'editor', ?, datetime('now'))`,
      args: [
        "embedded-extension-editor-share",
        extensionId,
        "editor@host.test",
        "alice@host.test",
      ],
    });
    currentUser = {
      userId: "host-user-3",
      email: "editor@host.test",
      name: "Editor Host",
      orgId: "host-org-1",
      orgRole: "member",
    };

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes`,
        {
          method: "POST",
          headers: { "X-Agent-Native-CSRF": "1" },
          body: {
            id: "editor-write",
            scope: "org",
            data: { text: "Editor write" },
          },
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        id: "editor-write",
        extensionId,
        scope: "org",
        orgId: "host-org-1",
      },
    });

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes/editor-write?scope=org`,
        {
          method: "DELETE",
          headers: { "X-Agent-Native-CSRF": "1" },
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { ok: true },
    });

    await getDbExec().execute({
      sql: `INSERT INTO tool_shares (id, resource_id, principal_type, principal_id, role, created_by, created_at)
        VALUES (?, ?, 'user', ?, 'admin', ?, datetime('now'))`,
      args: [
        "embedded-extension-admin-share",
        extensionId,
        "admin@host.test",
        "alice@host.test",
      ],
    });
    currentUser = {
      userId: "host-user-4",
      email: "admin@host.test",
      name: "Admin Host",
      orgId: "host-org-1",
      orgRole: "member",
    };

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes`,
        {
          method: "POST",
          headers: { "X-Agent-Native-CSRF": "1" },
          body: {
            id: "admin-write",
            scope: "org",
            data: { text: "Admin write" },
          },
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        id: "admin-write",
        extensionId,
        scope: "org",
      },
    });

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes/admin-write?scope=org`,
        {
          method: "DELETE",
          headers: { "X-Agent-Native-CSRF": "1" },
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { ok: true },
    });

    currentUser = {
      userId: "host-user-5",
      email: "stranger@other.test",
      name: "Stranger Host",
      orgId: "other-org-1",
      orgRole: "member",
    };

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes?scope=org`,
      ),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: "Extension not found" },
    });

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes`,
        {
          method: "POST",
          headers: { "X-Agent-Native-CSRF": "1" },
          body: {
            id: "stranger-write",
            scope: "org",
            data: { text: "Should be rejected" },
          },
        },
      ),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: "Extension not found" },
    });

    currentUser = {
      userId: "host-user-1",
      email: "alice@host.test",
      name: "Alice Host",
      orgId: "host-org-1",
      orgRole: "admin",
    };

    await expect(
      dispatch(
        nitroApp,
        `/_agent-native/extensions/data/${extensionId}/notes/content-1?scope=org`,
        {
          method: "DELETE",
          headers: { "X-Agent-Native-CSRF": "1" },
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { ok: true },
    });
  });
});
