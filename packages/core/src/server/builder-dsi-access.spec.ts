import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock("./builder-oauth.js", () => ({
  resolvePersonalBuilderAccountAccess: resolveMock,
}));

import {
  assertBuilderDsiAccess,
  BuilderDsiAccessError,
  getBuilderDsiAccess,
} from "./builder-dsi-access.js";
import { runWithRequestContext } from "./request-context.js";

const signedIn = <T>(run: () => T) =>
  runWithRequestContext(
    { userEmail: "alice@example.test", orgId: "org-example" },
    run,
  );

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ status: "missing" });
});
afterEach(() => vi.unstubAllEnvs());

describe("Builder DSI access boundary", () => {
  it("rejects ambient process identity without an authenticated request", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "alice@example.test");
    await expect(getBuilderDsiAccess()).resolves.toEqual({
      status: "unauthenticated",
      eligible: false,
    });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { userEmail: " " },
    {
      userEmail: "alice@example.test",
      authCapability: "capability:visual-edit",
    },
  ])("rejects absent and capability-only identities", async (context) => {
    await expect(
      runWithRequestContext(context, getBuilderDsiAccess),
    ).resolves.toEqual({ status: "unauthenticated", eligible: false });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("reads canonical personal status with both DSI scopes without refresh", async () => {
    resolveMock.mockResolvedValue({ status: "ready" });
    await expect(signedIn(getBuilderDsiAccess)).resolves.toEqual({
      status: "ready",
      eligible: true,
    });
    expect(resolveMock).toHaveBeenCalledWith({
      ownerEmail: "alice@example.test",
      orgId: "org-example",
      requiredScopes: [
        "builder:designsystem:read",
        "builder:designsystem:write",
      ],
      refresh: false,
    });
  });

  it("refreshes at assertion time and never trusts a cached readiness result", async () => {
    resolveMock
      .mockResolvedValueOnce({ status: "ready" })
      .mockResolvedValueOnce({
        status: "reconnect_required",
        reason: "revoked",
        missingScopes: [],
      });
    await expect(signedIn(getBuilderDsiAccess)).resolves.toMatchObject({
      status: "ready",
    });
    await expect(signedIn(assertBuilderDsiAccess)).rejects.toMatchObject({
      errorCode: "builder_dsi_reconnect_required",
      access: { eligible: true },
      statusCode: 409,
    });
    expect(resolveMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ refresh: true }),
    );
  });

  it("returns no credentials on a successful assertion", async () => {
    resolveMock.mockResolvedValue({ status: "ready" });
    await expect(signedIn(assertBuilderDsiAccess)).resolves.toEqual({
      status: "ready",
      eligible: true,
    });
  });

  it.each(["expired", "revoked", "missing_scopes"] as const)(
    "keeps account eligibility for %s reconnect",
    async (reason) => {
      resolveMock.mockResolvedValue({
        status: "reconnect_required",
        reason,
        missingScopes: ["builder:designsystem:write"],
      });
      await expect(signedIn(getBuilderDsiAccess)).resolves.toEqual({
        status: "reconnect_required",
        eligible: true,
        reason,
        missingScopes: ["builder:designsystem:write"],
      });
    },
  );

  it.each(["store_unavailable", "invalid_connection"] as const)(
    "keeps %s unknown rather than ordinary absence",
    async (reason) => {
      resolveMock.mockResolvedValue({ status: "unavailable", reason });
      await expect(signedIn(getBuilderDsiAccess)).resolves.toEqual({
        status: "unavailable",
        eligible: null,
        reason,
      });
      await expect(signedIn(assertBuilderDsiAccess)).rejects.toMatchObject({
        errorCode: "builder_dsi_unavailable",
        statusCode: 503,
      });
    },
  );

  it("denies an unlinked account with a transport-safe typed error", async () => {
    await expect(signedIn(assertBuilderDsiAccess)).rejects.toBeInstanceOf(
      BuilderDsiAccessError,
    );
    await expect(signedIn(assertBuilderDsiAccess)).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "builder_dsi_missing",
      statusCode: 403,
      details: { access: { status: "missing", eligible: false } },
    });
  });

  it("denies unauthenticated assertions before reading provider state", async () => {
    await expect(assertBuilderDsiAccess()).rejects.toMatchObject({
      errorCode: "builder_dsi_unauthenticated",
      statusCode: 401,
    });
    expect(resolveMock).not.toHaveBeenCalled();
  });
});
