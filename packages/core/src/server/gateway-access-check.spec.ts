import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signGatewayAccessToken } from "./short-lived-token.js";

const mockResolveAccess = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (h: any) => h,
  getMethod: (e: any) => e.method ?? "GET",
  getQuery: (e: any) => e.query ?? {},
  setResponseStatus: (e: any, s: number) => {
    e.status = s;
  },
  setResponseHeader: (e: any, k: string, v: string) => {
    e.headers = e.headers ?? {};
    e.headers[k] = v;
  },
}));
vi.mock("../sharing/access.js", () => ({ resolveAccess: mockResolveAccess }));
vi.mock("./request-context.js", () => ({
  runWithRequestContext: (_ctx: any, fn: any) => fn(),
}));

const SECRET = "per-project-hmac-secret";
const CLAIMS = {
  projectId: "proj_a",
  resourceType: "document",
  resourceId: "doc-1",
  userEmail: "sharee@example.com",
  orgId: "org-1",
};

async function invoke(event: Record<string, unknown>) {
  const { createGatewayAccessCheckHandler } =
    await import("./gateway-access-check.js");
  const handler = createGatewayAccessCheckHandler() as any;
  const e = { headers: {} as Record<string, string>, ...event };
  const body = await handler(e);
  return { e, body };
}

describe("gateway access-check endpoint", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET = SECRET;
    mockResolveAccess.mockReset();
  });
  afterEach(() => {
    delete process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET;
    delete process.env.BUILDER_PROJECT_ID;
  });

  it("returns allowed:true and forwards the signed query to resolveAccess", async () => {
    mockResolveAccess.mockResolvedValue({ role: "viewer" });
    const token = signGatewayAccessToken(CLAIMS, SECRET);
    const { body } = await invoke({ query: { token } });
    expect(body).toEqual({ allowed: true });
    expect(mockResolveAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      { userEmail: "sharee@example.com", orgId: "org-1" },
      { skipResourceBody: true },
    );
  });

  it("returns allowed:false when the app denies (null)", async () => {
    mockResolveAccess.mockResolvedValue(null);
    const token = signGatewayAccessToken(CLAIMS, SECRET);
    const { body } = await invoke({ query: { token } });
    expect(body).toEqual({ allowed: false });
  });

  it("401s and skips access when the token's project id mismatches this app", async () => {
    process.env.BUILDER_PROJECT_ID = "proj_other";
    const token = signGatewayAccessToken(CLAIMS, SECRET); // projectId proj_a
    const { e } = await invoke({ query: { token } });
    expect(e.status).toBe(401);
    expect(mockResolveAccess).not.toHaveBeenCalled();
  });

  it("allows when the token's project id matches this app's", async () => {
    process.env.BUILDER_PROJECT_ID = "proj_a";
    mockResolveAccess.mockResolvedValue({ role: "viewer" });
    const token = signGatewayAccessToken(CLAIMS, SECRET);
    const { body } = await invoke({ query: { token } });
    expect(body).toEqual({ allowed: true });
  });

  it("fails closed when resolveAccess throws (unknown resource type)", async () => {
    mockResolveAccess.mockRejectedValue(
      new Error("Unknown shareable resource"),
    );
    const token = signGatewayAccessToken(CLAIMS, SECRET);
    const { body } = await invoke({ query: { token } });
    expect(body).toEqual({ allowed: false });
  });

  it("401s a token signed with the wrong key and never checks access", async () => {
    const token = signGatewayAccessToken(CLAIMS, "wrong-secret");
    const { e } = await invoke({ query: { token } });
    expect(e.status).toBe(401);
    expect(mockResolveAccess).not.toHaveBeenCalled();
  });

  it("401s a missing token", async () => {
    const { e } = await invoke({ query: {} });
    expect(e.status).toBe(401);
  });

  it("404s when no realtime secret is configured", async () => {
    delete process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET;
    const token = signGatewayAccessToken(CLAIMS, SECRET);
    const { e } = await invoke({ query: { token } });
    expect(e.status).toBe(404);
  });

  it("405s a non-GET request", async () => {
    const token = signGatewayAccessToken(CLAIMS, SECRET);
    const { e } = await invoke({ method: "POST", query: { token } });
    expect(e.status).toBe(405);
  });
});
