import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHeader: vi.fn(),
  getRequestURL: vi.fn(
    () => new URL("https://design.test/builder-preview/d1/"),
  ),
  getCookie: vi.fn(),
  getSession: vi.fn(),
  verifyEmbedSessionToken: vi.fn(),
  readFusionApp: vi.fn(),
  resolveAccess: vi.fn(),
  runWithRequestContext: vi.fn(),
  select: vi.fn(),
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: mocks.runWithRequestContext,
  verifyEmbedSessionToken: mocks.verifyEmbedSessionToken,
}));

vi.mock("@agent-native/core/shared", () => ({
  EMBED_SESSION_COOKIE: "an_embed_session",
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("h3", () => ({
  defineEventHandler: <T>(handler: T) => handler,
  getCookie: mocks.getCookie,
  getHeader: mocks.getHeader,
  getRequestURL: mocks.getRequestURL,
  getRouterParam: vi.fn(),
  setResponseHeader: mocks.setResponseHeader,
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: { designs: { id: "id", data: "data" } },
}));

vi.mock("../../shared/full-app.js", async (loadOriginal) => {
  const original =
    await loadOriginal<typeof import("../../shared/full-app.js")>();
  return { ...original, readFusionApp: mocks.readFusionApp };
});

import { proxyBuilderPreview } from "./builder-preview-proxy.js";

const event = {} as never;

function linkedDesignRow() {
  mocks.select.mockReturnValue({
    from: () => ({ where: () => [{ data: {} }] }),
  });
  mocks.readFusionApp.mockReturnValue({
    source: "builder-host",
    previewUrl: "https://app.fly.dev",
  });
}

describe("builder preview proxy authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHeader.mockReturnValue(undefined);
    mocks.getCookie.mockReturnValue(undefined);
    mocks.verifyEmbedSessionToken.mockReturnValue({ ok: false });
    mocks.getSession.mockResolvedValue({ email: "a@b.com", orgId: "org" });
    mocks.resolveAccess.mockResolvedValue({ role: "owner" });
    mocks.runWithRequestContext.mockImplementation(
      (_ctx: unknown, fn: () => unknown) => fn(),
    );
    linkedDesignRow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
  });

  it("refuses a top-level navigation so container code cannot become this origin's document", async () => {
    mocks.getHeader.mockImplementation((_e: unknown, name: string) =>
      name === "sec-fetch-dest" ? "document" : undefined,
    );

    await proxyBuilderPreview(event, { designId: "d1", path: "/" });

    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still serves the frame's own subresources", async () => {
    mocks.getHeader.mockImplementation((_e: unknown, name: string) =>
      name === "sec-fetch-dest" ? "script" : undefined,
    );

    await proxyBuilderPreview(event, { designId: "d1", path: "/app.js" });

    expect(fetch).toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    mocks.getSession.mockResolvedValue(null);

    await proxyBuilderPreview(event, { designId: "d1", path: "/" });

    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not distinguish a design the caller cannot reach from one that does not exist", async () => {
    mocks.resolveAccess.mockResolvedValue(null);

    await proxyBuilderPreview(event, { designId: "d1", path: "/" });

    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("proxies for a caller who holds access", async () => {
    await proxyBuilderPreview(event, { designId: "d1", path: "/" });

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://app.fly.dev/"),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("serves the embedded canvas, whose token is scoped to this design but signed against the design page", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.getCookie.mockReturnValue("embed-token");
    mocks.verifyEmbedSessionToken.mockReturnValue({
      ok: true,
      claims: { scope: "builder-host:design:d1" },
    });

    await proxyBuilderPreview(event, { designId: "d1", path: "/" });

    expect(fetch).toHaveBeenCalled();
    expect(mocks.setResponseStatus).not.toHaveBeenCalledWith(event, 401);
  });

  it("does not let a token scoped to one design proxy another", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.getCookie.mockReturnValue("embed-token");
    mocks.verifyEmbedSessionToken.mockReturnValue({
      ok: true,
      claims: { scope: "builder-host:design:other" },
    });

    await proxyBuilderPreview(event, { designId: "d1", path: "/" });

    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
