import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyRealtimeSubscribeToken } from "./short-lived-token.js";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetOrgContext = vi.hoisted(() => vi.fn());
const mockResolveProjectId = vi.hoisted(() => vi.fn());
const mockSameOrigin = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (h: any) => h,
  getMethod: (e: any) => e.method ?? "GET",
  setResponseStatus: (e: any, s: number) => {
    e.status = s;
  },
  setResponseHeader: (e: any, k: string, v: string) => {
    e.headers = e.headers ?? {};
    e.headers[k] = v;
  },
}));
vi.mock("./auth.js", () => ({ getSession: mockGetSession }));
vi.mock("../org/context.js", () => ({ getOrgContext: mockGetOrgContext }));
vi.mock("./builder-browser.js", () => ({
  resolveBuilderBranchProjectId: mockResolveProjectId,
}));
vi.mock("./request-origin.js", () => ({
  isSameOriginRequest: mockSameOrigin,
}));

const SECRET = "per-project-hmac-secret";

async function invoke(event: Record<string, unknown>) {
  const { createRealtimeTokenHandler } = await import("./realtime-token.js");
  const handler = createRealtimeTokenHandler() as any;
  const e = { headers: {} as Record<string, string>, ...event };
  const body = await handler(e);
  return { e, body };
}

describe("realtime-token mint endpoint", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET = SECRET;
    mockSameOrigin.mockReturnValue(true);
    mockGetSession.mockResolvedValue({ email: "alice@example.com" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1" });
    // Async scoped resolver — proves the endpoint uses it, not a sync env read.
    mockResolveProjectId.mockResolvedValue("proj_scoped");
  });
  afterEach(() => {
    delete process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET;
    vi.clearAllMocks();
  });

  it("mints an identity + project bound token via the async resolver", async () => {
    const { e, body } = await invoke({ method: "GET" });
    expect(mockResolveProjectId).toHaveBeenCalled();
    expect(body.token).toBeTruthy();
    expect(body.ttlSeconds).toBe(600);
    const verified = verifyRealtimeSubscribeToken(body.token, {
      projectId: "proj_scoped",
      key: SECRET,
    });
    expect(verified).toMatchObject({
      ok: true,
      projectId: "proj_scoped",
      owner: "alice@example.com",
      orgId: "org-1",
    });
  });

  it("marks every response uncacheable (private, no-store)", async () => {
    const ok = await invoke({ method: "GET" });
    expect(ok.e.headers["Cache-Control"]).toBe("private, no-store");
    // ...including early-return paths.
    mockGetSession.mockResolvedValueOnce(null);
    const unauth = await invoke({ method: "GET" });
    expect(unauth.e.status).toBe(401);
    expect(unauth.e.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("404s (client falls back to local) when no project id resolves", async () => {
    mockResolveProjectId.mockResolvedValue("");
    const { e } = await invoke({ method: "GET" });
    expect(e.status).toBe(404);
  });

  it("rejects cross-origin (403) and non-GET (405)", async () => {
    mockSameOrigin.mockReturnValue(false);
    expect((await invoke({ method: "GET" })).e.status).toBe(403);
    mockSameOrigin.mockReturnValue(true);
    expect((await invoke({ method: "POST" })).e.status).toBe(405);
  });
});
