/**
 * `/_agent-native/can-see` for a self-registered app.
 *
 * This endpoint is how the gateway asks the app whether a sharee may see a
 * resource-scoped event, and it fails closed. It originally read the signing
 * secret from the env var only, so on a self-registered deployment — which has
 * no such env var — it 404'd every check and shared-resource events were
 * silently dropped for exactly the apps self-registration exists to serve.
 * These tests pin the resolution order that fixed it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockProjectId = vi.hoisted(() => vi.fn());
const mockRegistered = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (h: unknown) => h,
  getMethod: () => "GET",
  getQuery: (e: { query: Record<string, string> }) => e.query ?? {},
  setResponseStatus: (e: { status?: number }, s: number) => {
    e.status = s;
  },
  setResponseHeader: () => {},
}));
vi.mock("../sharing/access.js", () => ({ resolveAccess: mockResolveAccess }));
vi.mock("./builder-browser.js", () => ({
  getBuilderBranchProjectId: mockProjectId,
}));
vi.mock("./realtime-registration.js", () => ({
  resolveRegisteredRealtimeChannel: mockRegistered,
}));

import { createGatewayAccessCheckHandler } from "./gateway-access-check.js";
import { signGatewayAccessToken } from "./short-lived-token.js";

const REGISTERED = { channelId: "rt_abc", hmacSecret: "registered-secret" };
const QUERY = {
  projectId: REGISTERED.channelId,
  resourceType: "document",
  resourceId: "doc-1",
  userEmail: "sharee@example.com",
  orgId: "org-1",
};

async function invoke(token: string) {
  const handler = createGatewayAccessCheckHandler() as unknown as (
    e: unknown,
  ) => Promise<{ allowed?: boolean; error?: string }>;
  const event = { query: { token }, status: undefined as number | undefined };
  const body = await handler(event);
  return { status: event.status, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET;
  mockProjectId.mockReturnValue("");
  mockRegistered.mockResolvedValue(REGISTERED);
  mockResolveAccess.mockResolvedValue({ id: "doc-1" });
});

describe("can-see on a self-registered app", () => {
  it("verifies a token signed with the registered secret", async () => {
    const token = signGatewayAccessToken(QUERY, REGISTERED.hmacSecret);
    const { status, body } = await invoke(token);
    expect(status).toBeUndefined();
    expect(body.allowed).toBe(true);
  });

  it("binds the registered channel, rejecting a token for another one", async () => {
    // The app knows its own channel id, so an access token minted against a
    // different channel must not verify here even with a valid signature.
    const token = signGatewayAccessToken(
      { ...QUERY, projectId: "rt_someone_else" },
      REGISTERED.hmacSecret,
    );
    const { status } = await invoke(token);
    expect(status).toBe(401);
  });

  it("404s when nothing is injected and nothing is registered", async () => {
    mockRegistered.mockResolvedValue(null);
    const { status } = await invoke("anything");
    expect(status).toBe(404);
  });

  it("stays closed when the registration lookup throws", async () => {
    mockRegistered.mockRejectedValue(new Error("db down"));
    const { status } = await invoke("anything");
    expect(status).toBe(404);
  });

  it("fails closed when the app denies access", async () => {
    mockResolveAccess.mockResolvedValue(null);
    const token = signGatewayAccessToken(QUERY, REGISTERED.hmacSecret);
    expect((await invoke(token)).body.allowed).toBe(false);
  });

  it("never self-registers for a pipeline app", async () => {
    // Same discriminator as the token mint: either half injected means the
    // pipeline owns this app and the env pair governs.
    process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET = "injected-secret";
    mockProjectId.mockReturnValue("proj_pipeline");
    const token = signGatewayAccessToken(
      { ...QUERY, projectId: "proj_pipeline" },
      "injected-secret",
    );
    const { body } = await invoke(token);
    expect(body.allowed).toBe(true);
    expect(mockRegistered).not.toHaveBeenCalled();
  });
});
