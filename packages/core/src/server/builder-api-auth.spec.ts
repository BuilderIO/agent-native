import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canAuthorizeBuilderApiRequest,
  hasBuilderApiCredentialCustody,
  resolveBuilderApiAuthorization,
} from "./builder-api-auth.js";

const getBuilderOAuthSessionMock = vi.hoisted(() => vi.fn());
const hasBuilderOAuthSessionMock = vi.hoisted(() => vi.fn());
const resolveBuilderPrivateKeyMock = vi.hoisted(() => vi.fn());
const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getRequestOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock("./builder-oauth.js", () => ({
  getBuilderOAuthSession: getBuilderOAuthSessionMock,
  hasBuilderOAuthSession: hasBuilderOAuthSessionMock,
}));
vi.mock("./credential-provider.js", () => ({
  resolveBuilderPrivateKey: resolveBuilderPrivateKeyMock,
}));
vi.mock("./request-context.js", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
  getRequestOrgId: getRequestOrgIdMock,
}));

const ASSETS_WRITE = "builder:assets:write";

beforeEach(() => {
  vi.clearAllMocks();
  getRequestUserEmailMock.mockReturnValue("user@example.com");
  getRequestOrgIdMock.mockReturnValue(undefined);
  hasBuilderOAuthSessionMock.mockResolvedValue(false);
  getBuilderOAuthSessionMock.mockResolvedValue(null);
  resolveBuilderPrivateKeyMock.mockResolvedValue(null);
});

describe("resolveBuilderApiAuthorization", () => {
  it("uses the OAuth token when the grant carries the required scope", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue({
      accessToken: "<OAUTH_TOKEN_EXAMPLE>",
      scopes: ["builder:ai:invoke", ASSETS_WRITE],
    });
    resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-legacy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).resolves.toBe(
      "Bearer <OAUTH_TOKEN_EXAMPLE>",
    );
    // OAuth wins outright — the legacy key is never even consulted.
    expect(resolveBuilderPrivateKeyMock).not.toHaveBeenCalled();
  });

  it("names the missing scope instead of falling back to a legacy key", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue({
      accessToken: "<OAUTH_TOKEN_EXAMPLE>",
      scopes: ["builder:ai:invoke"],
    });
    resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-legacy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).rejects.toThrow(
      /needs re-authorizing to grant builder:assets:write/,
    );
    // Falling back here would let a deploy-level key act for a user who never
    // authorized it.
    expect(resolveBuilderPrivateKeyMock).not.toHaveBeenCalled();
  });

  it("asks for re-authorization when custody exists but no session resolves", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue(null);
    resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-legacy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).rejects.toThrow(
      /access expired/,
    );
  });

  it("uses the legacy private key when there is no OAuth grant", async () => {
    resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-legacy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).resolves.toBe(
      "Bearer bpk-legacy",
    );
  });

  it("reports not connected when neither credential kind answers", async () => {
    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).rejects.toThrow(
      /not connected/,
    );
  });

  // The grant is org-scoped, so a recording that finalizes after the user
  // switched active org must still authorize against its own org.
  it("binds the lookup to the request organization, not the active one", async () => {
    getRequestOrgIdMock.mockReturnValue("org-recording");
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue({
      accessToken: "<OAUTH_TOKEN_EXAMPLE>",
      scopes: ["builder:ai:invoke", ASSETS_WRITE],
    });

    await resolveBuilderApiAuthorization(ASSETS_WRITE);

    expect(hasBuilderOAuthSessionMock).toHaveBeenCalledWith(
      "user@example.com",
      "org-recording",
    );
    expect(getBuilderOAuthSessionMock).toHaveBeenCalledWith(
      "user@example.com",
      "org-recording",
    );
  });

  it("skips the OAuth lookup with no request owner", async () => {
    getRequestUserEmailMock.mockReturnValue(undefined);
    resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-deploy");

    await expect(resolveBuilderApiAuthorization(ASSETS_WRITE)).resolves.toBe(
      "Bearer bpk-deploy",
    );
    expect(hasBuilderOAuthSessionMock).not.toHaveBeenCalled();
  });
});

describe("canAuthorizeBuilderApiRequest", () => {
  it("requires the requested scope for OAuth credentials", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    getBuilderOAuthSessionMock.mockResolvedValue({
      accessToken: "<OAUTH_TOKEN_EXAMPLE>",
      scopes: ["builder:ai:invoke"],
    });

    await expect(canAuthorizeBuilderApiRequest(ASSETS_WRITE)).resolves.toBe(
      false,
    );
  });

  it("accepts a legacy private key", async () => {
    resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-legacy");

    await expect(canAuthorizeBuilderApiRequest(ASSETS_WRITE)).resolves.toBe(
      true,
    );
  });
});

describe("hasBuilderApiCredentialCustody", () => {
  // The reported bug: storage gates only knew about private keys, so every
  // OAuth-only connection was treated as having no storage at all.
  it("counts an OAuth grant with no private key as connected", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);
    resolveBuilderPrivateKeyMock.mockResolvedValue(null);

    await expect(hasBuilderApiCredentialCustody()).resolves.toBe(true);
  });

  it("counts a narrow OAuth grant as connected so the upload path can explain", async () => {
    hasBuilderOAuthSessionMock.mockResolvedValue(true);

    await expect(hasBuilderApiCredentialCustody()).resolves.toBe(true);
    expect(resolveBuilderPrivateKeyMock).not.toHaveBeenCalled();
  });

  it("counts a legacy private key as connected", async () => {
    resolveBuilderPrivateKeyMock.mockResolvedValue("bpk-legacy");

    await expect(hasBuilderApiCredentialCustody()).resolves.toBe(true);
  });

  it("is false when nothing is connected", async () => {
    await expect(hasBuilderApiCredentialCustody()).resolves.toBe(false);
  });
});
