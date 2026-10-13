import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BetterAuthInstance } from "./better-auth-instance.js";

const getAuthSecretMock = vi.hoisted(() => vi.fn());
const createBetterAuthSessionForEmailMock = vi.hoisted(() => vi.fn());

vi.mock("./better-auth-instance.js", () => ({
  createBetterAuthSessionForEmail: createBetterAuthSessionForEmailMock,
  getAuthSecret: getAuthSecretMock,
}));

const { getBetterAuthActionHeaders } =
  await import("./better-auth-action-headers.js");

describe("getBetterAuthActionHeaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthSecretMock.mockReturnValue("test-auth-secret");
  });

  it("preserves the original headers for a matching Better Auth session", async () => {
    const headers = new Headers({ cookie: "an.session_token=ba-cookie" });
    const getSession = vi.fn().mockResolvedValue({
      user: { email: "Alice@example.com" },
    });
    const auth = {
      api: { getSession },
    } as unknown as BetterAuthInstance;

    await expect(
      getBetterAuthActionHeaders(auth, "alice@example.com", headers),
    ).resolves.toBe(headers);

    expect(getSession).toHaveBeenCalledWith({ headers });
    expect(createBetterAuthSessionForEmailMock).not.toHaveBeenCalled();
  });

  it("bridges an authenticated legacy session with a signed Better Auth bearer", async () => {
    const headers = new Headers({ cookie: "an_session=legacy-token" });
    const getSession = vi.fn().mockResolvedValue(null);
    createBetterAuthSessionForEmailMock.mockResolvedValue({
      email: "alice@example.com",
      token: "ba-session-token",
      userId: "user-1",
    });
    const auth = {
      api: { getSession },
    } as unknown as BetterAuthInstance;

    const bridgedHeaders = await getBetterAuthActionHeaders(
      auth,
      "alice@example.com",
      headers,
    );

    const signature = crypto
      .createHmac("sha256", "test-auth-secret")
      .update("ba-session-token")
      .digest("base64url");
    expect(createBetterAuthSessionForEmailMock).toHaveBeenCalledWith(
      "alice@example.com",
    );
    expect(bridgedHeaders).not.toBe(headers);
    expect(bridgedHeaders.get("cookie")).toBe(headers.get("cookie"));
    expect(bridgedHeaders.get("authorization")).toBe(
      `Bearer ba-session-token.${signature}`,
    );
    expect(headers.get("authorization")).toBeNull();
  });

  it("fails closed when the Better Auth and framework identities differ", async () => {
    const getSession = vi.fn().mockResolvedValue({
      user: { email: "other@example.com" },
    });
    const auth = {
      api: { getSession },
    } as unknown as BetterAuthInstance;

    await expect(
      getBetterAuthActionHeaders(auth, "alice@example.com", new Headers()),
    ).rejects.toThrow("Better Auth session identity mismatch");
    expect(createBetterAuthSessionForEmailMock).not.toHaveBeenCalled();
  });
});
