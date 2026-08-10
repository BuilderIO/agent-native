import { beforeEach, describe, expect, it, vi } from "vitest";

const setResponseHeader = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getHeader: (event: any, name: string) =>
    event.headers?.[name] ?? event.headers?.[name.toLowerCase()],
  getMethod: (event: any) => event.method ?? "GET",
  getQuery: (event: any) => event.query ?? {},
  setResponseHeader: (...a: any[]) => setResponseHeader(...a),
}));

const consumeEmbedSessionTicket = vi.hoisted(() => vi.fn());
const setEmbedSessionCookie = vi.hoisted(() => vi.fn());
const signEmbedSessionToken = vi.hoisted(() => vi.fn(() => "signed-token"));

vi.mock("./embed-session.js", () => ({
  consumeEmbedSessionTicket: (...a: any[]) => consumeEmbedSessionTicket(...a),
  isEmbedCapabilityScope: (scope?: string) =>
    scope?.startsWith("capability:") ?? false,
  normalizeEmbedTargetPath: (path: string | null | undefined) => path ?? null,
  setEmbedSessionCookie: (...a: any[]) => setEmbedSessionCookie(...a),
  signEmbedSessionToken: (...a: any[]) => signEmbedSessionToken(...a),
}));

import { createEmbedStartRouteHandler } from "./embed-route.js";

function fakeEvent(
  method: string,
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  return {
    method,
    query,
    headers,
    res: {
      headers: {
        getSetCookie: () => [],
      },
    },
  } as any;
}

describe("createEmbedStartRouteHandler", () => {
  beforeEach(() => {
    consumeEmbedSessionTicket.mockReset();
    setEmbedSessionCookie.mockReset();
    signEmbedSessionToken.mockReset();
    signEmbedSessionToken.mockReturnValue("signed-token");
    setResponseHeader.mockReset();
  });

  it("does not consume one-time embed tickets for HEAD probes", async () => {
    const handler = createEmbedStartRouteHandler();

    const res: Response = await handler(
      fakeEvent("HEAD", { ticket: "ticket-123" }),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe(
      "require-corp",
    );
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cross-Origin-Embedder-Policy",
      "require-corp",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cross-Origin-Opener-Policy",
      "same-origin",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cross-Origin-Resource-Policy",
      "cross-origin",
    );
    expect(consumeEmbedSessionTicket).not.toHaveBeenCalled();
    expect(setEmbedSessionCookie).not.toHaveBeenCalled();
  });

  it("still consumes valid tickets on GET and redirects to the embedded target", async () => {
    consumeEmbedSessionTicket.mockResolvedValue({
      ownerEmail: "steve@example.com",
      orgId: "builder",
      targetPath: "/inbox",
      scope: "full",
      expiresAt: Date.now() + 60_000,
    });

    const handler = createEmbedStartRouteHandler();

    const res: Response = await handler(
      fakeEvent("GET", { ticket: "ticket-123" }),
    );

    expect(consumeEmbedSessionTicket).toHaveBeenCalledWith("ticket-123", {
      expectedOrgId: null,
    });
    expect(setEmbedSessionCookie).toHaveBeenCalledTimes(1);
    expect(signEmbedSessionToken).toHaveBeenCalledWith({
      ownerEmail: "steve@example.com",
      orgId: "builder",
      targetPath: "/inbox",
      scope: "full",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/inbox?embedded=1&__an_embed_token=signed-token&agentSidebar=closed",
    );
    expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe(
      "require-corp",
    );
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cross-Origin-Embedder-Policy",
      "require-corp",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cross-Origin-Opener-Policy",
      "same-origin",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cross-Origin-Resource-Policy",
      "cross-origin",
    );
  });

  it("returns a refreshable expired-session page for stale embed tickets", async () => {
    consumeEmbedSessionTicket.mockResolvedValue(null);

    const handler = createEmbedStartRouteHandler();

    const res: Response = await handler(
      fakeEvent("GET", { ticket: "expired-ticket" }),
    );
    const html = await res.text();

    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("Embedded app session expired");
    expect(html).toContain("agentNative.embedSessionExpired");
    expect(html).not.toContain("Invalid or expired embed session");
  });

  it("bounds capability token lifetime to the remaining one-time ticket lifetime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00Z"));
    consumeEmbedSessionTicket.mockResolvedValue({
      ownerEmail: "steve@example.com",
      targetPath: "/visual-edit/design_1",
      scope: "capability:visual-edit:design:design_1",
      expiresAt: Date.now() + 45_900,
    });

    try {
      const handler = createEmbedStartRouteHandler();
      const res: Response = await handler(
        fakeEvent("GET", { ticket: "ticket-123" }),
      );

      expect(res.status).toBe(302);
      expect(signEmbedSessionToken).toHaveBeenCalledWith({
        ownerEmail: "steve@example.com",
        orgId: undefined,
        targetPath: "/visual-edit/design_1",
        scope: "capability:visual-edit:design:design_1",
        ttlSeconds: 45,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("redeems a signed-out local workspace handoff without creating an account session", async () => {
    const localWorkspacePrincipal =
      "workspace+0123456789abcdef01234567@local.visual-edit.agent-native.invalid";
    consumeEmbedSessionTicket.mockResolvedValue({
      ownerEmail: localWorkspacePrincipal,
      targetPath: "/visual-edit/design_1",
      scope: "capability:visual-edit:design:design_1",
      expiresAt: Date.now() + 60_000,
    });
    const getExistingSession = vi.fn(async () => null);
    const handler = createEmbedStartRouteHandler({ getExistingSession });

    const res: Response = await handler(
      fakeEvent("GET", { ticket: "signed-out-local-ticket" }),
    );

    expect(getExistingSession).toHaveBeenCalledOnce();
    expect(consumeEmbedSessionTicket).toHaveBeenCalledWith(
      "signed-out-local-ticket",
      { expectedOrgId: null },
    );
    expect(signEmbedSessionToken).toHaveBeenCalledWith({
      ownerEmail: localWorkspacePrincipal,
      orgId: undefined,
      targetPath: "/visual-edit/design_1",
      scope: "capability:visual-edit:design:design_1",
      ttlSeconds: expect.any(Number),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/visual-edit/design_1?embedded=1&__an_embed_token=signed-token&agentSidebar=closed",
    );
  });

  it("rejects a second redemption of the same one-time ticket", async () => {
    consumeEmbedSessionTicket
      .mockResolvedValueOnce({
        ownerEmail: "steve@example.com",
        targetPath: "/visual-edit/design_1",
        scope: "capability:visual-edit:design:design_1",
        expiresAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce(null);
    const handler = createEmbedStartRouteHandler();

    const first: Response = await handler(
      fakeEvent("GET", { ticket: "ticket-123" }),
    );
    const second: Response = await handler(
      fakeEvent("GET", { ticket: "ticket-123" }),
    );

    expect(first.status).toBe(302);
    expect(second.status).toBe(401);
    expect(signEmbedSessionToken).toHaveBeenCalledTimes(1);
  });

  it("allows Claude MCP content frames to fetch embed start redirects", async () => {
    consumeEmbedSessionTicket.mockResolvedValue({
      ownerEmail: "steve@example.com",
      orgId: "builder",
      targetPath: "/inbox",
      scope: "full",
      expiresAt: Date.now() + 60_000,
    });

    const handler = createEmbedStartRouteHandler();

    const res: Response = await handler(
      fakeEvent(
        "GET",
        { ticket: "ticket-123" },
        {
          origin:
            "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
        },
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
    );
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("Location");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it.each([
    "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
    "https://claude.ai",
    "https://design.agent-native.com",
    "https://shakira-professor-conscious-frederick-trycloudflare-com.web-sandbox.oaiusercontent.com",
  ])(
    "returns the signed app route directly for %s transplant fetches",
    async (origin) => {
      consumeEmbedSessionTicket.mockResolvedValue({
        ownerEmail: "steve@example.com",
        orgId: "builder",
        targetPath: "/inbox",
        scope: "full",
        expiresAt: Date.now() + 60_000,
      });

      const handler = createEmbedStartRouteHandler();

      const res: Response = await handler(
        fakeEvent(
          "GET",
          { ticket: "ticket-123", __an_mcp_chat_bridge: "1" },
          {
            accept: "application/json",
            origin,
            "x-agent-native-embed-transplant": "1",
          },
        ),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
        "X-Agent-Native-Embed-Transplant",
      );
      await expect(res.json()).resolves.toEqual({
        location:
          "/inbox?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1&agentSidebar=closed",
      });
    },
  );

  it("allows opaque sandboxed MCP app frames to fetch embed start redirects", async () => {
    consumeEmbedSessionTicket.mockResolvedValue({
      ownerEmail: "steve@example.com",
      orgId: "builder",
      targetPath: "/inbox",
      scope: "full",
      expiresAt: Date.now() + 60_000,
    });

    const handler = createEmbedStartRouteHandler();

    const res: Response = await handler(
      fakeEvent("GET", { ticket: "ticket-123" }, { origin: "null" }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("null");
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("Location");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("preserves the MCP chat bridge flag on the signed app route", async () => {
    consumeEmbedSessionTicket.mockResolvedValue({
      ownerEmail: "steve@example.com",
      orgId: "builder",
      targetPath: "/inbox",
      scope: "full",
      expiresAt: Date.now() + 60_000,
    });

    const handler = createEmbedStartRouteHandler();

    const res: Response = await handler(
      fakeEvent("GET", {
        ticket: "ticket-123",
        __an_mcp_chat_bridge: "1",
      }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/inbox?embedded=1&__an_embed_token=signed-token&__an_mcp_chat_bridge=1&agentSidebar=closed",
    );
  });
});
