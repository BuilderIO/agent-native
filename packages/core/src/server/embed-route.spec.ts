import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event.method ?? "GET",
  getQuery: (event: any) => event.query ?? {},
  setResponseHeader: vi.fn(),
}));

const consumeEmbedSessionTicket = vi.hoisted(() => vi.fn());
const setEmbedSessionCookie = vi.hoisted(() => vi.fn());

vi.mock("./embed-session.js", () => ({
  consumeEmbedSessionTicket: (...a: any[]) => consumeEmbedSessionTicket(...a),
  normalizeEmbedTargetPath: (path: string | null | undefined) => path ?? null,
  setEmbedSessionCookie: (...a: any[]) => setEmbedSessionCookie(...a),
  signEmbedSessionToken: () => "signed-token",
}));

import { createEmbedStartRouteHandler } from "./embed-route.js";

function fakeEvent(method: string, query: Record<string, string> = {}) {
  return {
    method,
    query,
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
  });

  it("does not consume one-time embed tickets for HEAD probes", async () => {
    const handler = createEmbedStartRouteHandler();

    const res: Response = await handler(
      fakeEvent("HEAD", { ticket: "ticket-123" }),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
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
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/inbox?embedded=1&__an_embed_token=signed-token&agentSidebar=closed",
    );
  });
});
