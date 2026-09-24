import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const startMock = vi.hoisted(() => vi.fn());
const finishMock = vi.hoisted(() => vi.fn());
const readMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const revokeMock = vi.hoisted(() => vi.fn());
const getAccessTokenMock = vi.hoisted(() => vi.fn());
const markReconnectMock = vi.hoisted(() => vi.fn());
const validateIssuerMock = vi.hoisted(() => vi.fn());
const getRawTokensMock = vi.hoisted(() => vi.fn());
const resolveOrgMock = vi.hoisted(() => vi.fn());
const connectionStateMock = vi.hoisted(() => vi.fn());
const savePersonalLinkMock = vi.hoisted(() => vi.fn());
const resolveLegacyMock = vi.hoisted(() => vi.fn());
const fingerprintMock = vi.hoisted(() => vi.fn());
const proofSnapshotMock = vi.hoisted(() => vi.fn());
const deleteProofMock = vi.hoisted(() => vi.fn());

vi.mock("../mcp-client/oauth-client.js", () => ({
  startMcpOAuthAuthorization: startMock,
  finishMcpOAuthAuthorization: finishMock,
  readMcpOAuthCredentials: readMock,
  saveMcpOAuthCredentials: saveMock,
  revokeMcpOAuthCredentials: revokeMock,
  getMcpOAuthAccessToken: getAccessTokenMock,
  getMcpOAuthConnectionState: connectionStateMock,
  markMcpOAuthReconnectRequired: markReconnectMock,
  validateMcpOAuthCallbackIssuer: validateIssuerMock,
}));

vi.mock("../oauth-tokens/store.js", () => ({
  getOAuthTokens: getRawTokensMock,
  saveOAuthTokens: savePersonalLinkMock,
  getOAuthTokenSnapshot: proofSnapshotMock,
  deleteOAuthTokensIfRevision: deleteProofMock,
}));

vi.mock("./credential-provider.js", () => ({
  resolveBuilderCredentialsDetailed: resolveLegacyMock,
  builderCredentialFingerprint: fingerprintMock,
}));

vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: resolveOrgMock,
}));

import {
  BUILDER_OAUTH_ISSUER,
  BUILDER_OAUTH_RESOURCE,
  BUILDER_OAUTH_SCOPE,
  BUILDER_OAUTH_SCOPES,
  attestProvisionedBuilderAccount,
  deleteBuilderOAuthSession,
  exchangeBuilderOAuthAuthorization,
  finishBuilderOAuthAuthorization,
  getBuilderOAuthConnectionScope,
  getBuilderOAuthStoredScope,
  getBuilderOAuthSession,
  hasBuilderOAuthSession,
  markBuilderOAuthReconnectRequired,
  resolveBuilderOAuthRequestAccess,
  resolvePersonalBuilderAccountAccess,
  prepareBuilderAccountDisconnect,
  saveBuilderOAuthCredentials,
  startBuilderOAuthAuthorization,
} from "./builder-oauth.js";

const ownerEmail = "alice@example.com";
const DEFAULT_ORG = "org-default";

const BASE_KEY = "builder-general-resource-v1";
function perOrgKey(orgId: string): string {
  const digest = createHash("sha256").update(orgId).digest("hex");
  return `${BASE_KEY}:o:${digest}`;
}

function perUserKey(email: string): string {
  const digest = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return `${BASE_KEY}:u:${digest}`;
}

function credentials(overrides: Record<string, unknown> = {}) {
  return {
    serverUrl: BUILDER_OAUTH_RESOURCE,
    clientInformation: {
      client_id: "<CLIENT_ID_EXAMPLE>",
      issuer: BUILDER_OAUTH_ISSUER,
    },
    discoveryState: {
      authorizationServerUrl: BUILDER_OAUTH_ISSUER,
      authorizationServerMetadata: { issuer: BUILDER_OAUTH_ISSUER },
      resourceMetadata: {
        resource: BUILDER_OAUTH_RESOURCE,
      },
    },
    tokens: {
      access_token: "<ACCESS_TOKEN_EXAMPLE>",
      refresh_token: "<REFRESH_TOKEN_EXAMPLE>",
      scope: BUILDER_OAUTH_SCOPE,
      issuer: BUILDER_OAUTH_ISSUER,
    },
    tokenExpiresAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

beforeEach(() => {
  startMock.mockReset();
  finishMock.mockReset();
  readMock.mockReset();
  saveMock.mockReset();
  revokeMock.mockReset();
  getAccessTokenMock.mockReset();
  markReconnectMock.mockReset();
  markReconnectMock.mockResolvedValue(true);
  validateIssuerMock.mockReset();
  getRawTokensMock.mockReset();
  getRawTokensMock.mockResolvedValue(null);
  resolveOrgMock.mockReset();
  // Every user belongs to an org; individual tests override the org id.
  resolveOrgMock.mockResolvedValue(DEFAULT_ORG);
  connectionStateMock.mockReset();
  connectionStateMock.mockResolvedValue({ kind: "missing" });
  savePersonalLinkMock.mockReset();
  resolveLegacyMock.mockReset();
  fingerprintMock.mockReset();
  proofSnapshotMock.mockReset();
  proofSnapshotMock.mockResolvedValue(null);
  deleteProofMock.mockReset();
});

describe("personal Builder account eligibility", () => {
  const requiredScopes = [
    "builder:designsystem:read",
    "builder:designsystem:write",
  ] as const;
  const access = (
    refresh = false,
    email = ownerEmail,
    orgId: string | null = DEFAULT_ORG,
  ) =>
    resolvePersonalBuilderAccountAccess({
      ownerEmail: email,
      orgId,
      requiredScopes,
      refresh,
    });
  const grant = () => {
    const value = credentials();
    return {
      ...value,
      tokens: { ...value.tokens, scope: requiredScopes.join(" ") },
    };
  };
  const state = (kind = "connected", value = grant()) => ({
    kind,
    credential: value,
    revision: 1,
    legacyRevision: 1,
  });
  const link = (scope: "user" | "org" = "org") => ({
    link: {
      version: 1,
      ownerEmail,
      source: "oauth",
      scope,
      scopeId: scope === "org" ? DEFAULT_ORG : ownerEmail,
      grantId: "example-grant-id",
    },
  });
  const linkedGrant = () => ({
    ...grant(),
    builderAccountLinkId: "example-grant-id",
    builderAccountOwnerEmail: ownerEmail,
  });

  it.each(["owner", "admin", "member"])(
    "attests the %s who actually completed OAuth without duplicating rotating tokens",
    async (role) => {
      await saveBuilderOAuthCredentials({
        ownerEmail,
        orgId: DEFAULT_ORG,
        role,
        credentials: grant(),
      });
      expect(saveMock).toHaveBeenCalledTimes(1);
      const saved = saveMock.mock.calls[0][0];
      expect(saved.scope).toBe(role === "member" ? "user" : "org");
      expect(savePersonalLinkMock).toHaveBeenCalledWith(
        "builder-account",
        perUserKey(ownerEmail),
        {
          link: {
            version: 1,
            ownerEmail,
            source: "oauth",
            scope: saved.scope,
            scopeId: saved.scopeId,
            grantId: saved.credentials.builderAccountLinkId,
          },
        },
        `user:${ownerEmail}`,
      );
      expect(JSON.stringify(savePersonalLinkMock.mock.calls)).not.toContain(
        "<ACCESS_TOKEN_EXAMPLE>",
      );
      expect(JSON.stringify(savePersonalLinkMock.mock.calls)).not.toContain(
        "<REFRESH_TOKEN_EXAMPLE>",
      );
    },
  );

  it("does not mint proof when saving the verified grant fails", async () => {
    saveMock.mockRejectedValueOnce(new Error("fixture store unavailable"));
    await expect(
      saveBuilderOAuthCredentials({ ownerEmail, credentials: grant() }),
    ).rejects.toThrow();
    expect(savePersonalLinkMock).not.toHaveBeenCalled();
  });

  it("refuses non-Builder credentials before minting proof", async () => {
    await expect(
      saveBuilderOAuthCredentials({
        ownerEmail,
        credentials: { ...grant(), serverUrl: "https://other.example.test" },
      }),
    ).rejects.toThrow();
    expect(saveMock).not.toHaveBeenCalled();
    expect(savePersonalLinkMock).not.toHaveBeenCalled();
  });

  it("allows the just-connected admin's exact org grant", async () => {
    getRawTokensMock.mockResolvedValue(link());
    connectionStateMock.mockResolvedValue(state("connected", linkedGrant()));
    await expect(access()).resolves.toEqual({ status: "ready" });
    expect(connectionStateMock).toHaveBeenCalledWith({
      key: perOrgKey(DEFAULT_ORG),
      scope: "org",
      scopeId: DEFAULT_ORG,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    });
    expect(getAccessTokenMock).not.toHaveBeenCalled();
  });

  it("does not let another org member inherit that admin's proof", async () => {
    getRawTokensMock.mockImplementation(async (_provider, _key, owner) =>
      owner === `user:${ownerEmail}` ? link() : null,
    );
    connectionStateMock.mockImplementation(async (options) =>
      options.scope === "org"
        ? state("connected", linkedGrant())
        : { kind: "missing" },
    );
    await expect(access(false, "bob@example.com")).resolves.toEqual({
      status: "missing",
    });
    expect(connectionStateMock).toHaveBeenCalledTimes(1);
    expect(connectionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "user", scopeId: "bob@example.com" }),
    );
    expect(resolveLegacyMock).not.toHaveBeenCalled();
    expect(resolveOrgMock).not.toHaveBeenCalled();
  });

  it("does not follow the attested org grant outside the current authenticated org", async () => {
    getRawTokensMock.mockResolvedValue(link());
    await expect(access(false, ownerEmail, "other-org")).resolves.toMatchObject(
      { status: "reconnect_required", reason: "revoked" },
    );
    expect(connectionStateMock).not.toHaveBeenCalled();
  });

  it("accepts a peer's valid replacement service grant without losing personal eligibility", async () => {
    getRawTokensMock.mockResolvedValue(link());
    connectionStateMock.mockResolvedValue(
      state("connected", {
        ...grant(),
        builderAccountLinkId: "someone-elses-grant",
        builderAccountOwnerEmail: "bob@example.com",
      }),
    );
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    await expect(access(true)).resolves.toEqual({ status: "ready" });
    expect(getAccessTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "org", scopeId: DEFAULT_ORG }),
    );
    expect(savePersonalLinkMock).not.toHaveBeenCalled();
    expect(deleteProofMock).not.toHaveBeenCalled();
  });

  it("keeps both verified admins ready through repeated peer connects without qualifying a third teammate", async () => {
    const proofs = new Map<string, unknown>();
    let activeGrant = linkedGrant();
    savePersonalLinkMock.mockImplementation(
      async (_provider, _key, tokens, owner) => {
        proofs.set(owner, tokens);
      },
    );
    saveMock.mockImplementation(async ({ credentials: value }) => {
      activeGrant = value;
    });
    getRawTokensMock.mockImplementation(
      async (_provider, _key, owner) => proofs.get(owner) ?? null,
    );
    connectionStateMock.mockImplementation(async ({ scope }) =>
      scope === "org" ? state("connected", activeGrant) : { kind: "missing" },
    );
    for (const connector of [ownerEmail, "bob@example.com", ownerEmail]) {
      await saveBuilderOAuthCredentials({
        ownerEmail: connector,
        orgId: DEFAULT_ORG,
        role: "admin",
        credentials: grant(),
      });
      await expect(access(false, ownerEmail)).resolves.toEqual({
        status: "ready",
      });
      if (proofs.has("user:bob@example.com"))
        await expect(access(false, "bob@example.com")).resolves.toEqual({
          status: "ready",
        });
      await expect(access(false, "charlie@example.com")).resolves.toEqual({
        status: "missing",
      });
    }
    expect(proofs.size).toBe(2);
    expect(saveMock).toHaveBeenCalledTimes(3);
    expect(getAccessTokenMock).not.toHaveBeenCalled();
    expect(deleteProofMock).not.toHaveBeenCalled();
  });

  it.each(["reconnect_required", "missing_scope", "wrong_resource"])(
    "still validates a peer's replacement grant: %s",
    async (problem) => {
      getRawTokensMock.mockResolvedValue(link());
      const value = {
        ...linkedGrant(),
        builderAccountOwnerEmail: "bob@example.com",
      };
      if (problem === "missing_scope")
        value.tokens.scope = "builder:designsystem:read";
      if (problem === "wrong_resource")
        value.serverUrl = "https://other.example.test";
      connectionStateMock.mockResolvedValue(
        state(problem === "reconnect_required" ? problem : "connected", value),
      );
      await expect(access()).resolves.toMatchObject(
        problem === "wrong_resource"
          ? { status: "unavailable", reason: "invalid_connection" }
          : {
              status: "reconnect_required",
              reason:
                problem === "missing_scope" ? "missing_scopes" : "revoked",
            },
      );
      expect(deleteProofMock).not.toHaveBeenCalled();
    },
  );

  it("keeps an attested but deleted grant eligible for reconnect", async () => {
    getRawTokensMock.mockResolvedValue(link("user"));
    await expect(access()).resolves.toMatchObject({
      status: "reconnect_required",
      reason: "revoked",
    });
  });

  it("recognizes a legacy personally owned Builder OAuth grant without org inference", async () => {
    connectionStateMock.mockResolvedValue(state());
    await expect(access(false, "Alice@Example.com ")).resolves.toEqual({
      status: "ready",
    });
    expect(connectionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: perUserKey(ownerEmail),
        scope: "user",
        scopeId: ownerEmail,
      }),
    );
  });

  it("does not refresh an expired but refreshable grant during status inspection", async () => {
    connectionStateMock.mockResolvedValue(state("expired"));
    await expect(access()).resolves.toEqual({ status: "ready" });
    expect(getAccessTokenMock).not.toHaveBeenCalled();
    expect(savePersonalLinkMock).not.toHaveBeenCalled();
  });

  it("automatically refreshes through the canonical resolver during assertion", async () => {
    connectionStateMock
      .mockResolvedValueOnce(state("expired"))
      .mockResolvedValueOnce(state());
    getAccessTokenMock.mockResolvedValue("<ROTATED_ACCESS_TOKEN_EXAMPLE>");
    await expect(access(true)).resolves.toEqual({ status: "ready" });
    expect(getAccessTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "user", scopeId: ownerEmail }),
    );
  });

  it("accepts a valid peer org rotation during canonical refresh", async () => {
    getRawTokensMock.mockResolvedValue(link());
    connectionStateMock
      .mockResolvedValueOnce(state("expired", linkedGrant()))
      .mockResolvedValueOnce(
        state("connected", {
          ...grant(),
          builderAccountLinkId: "replaced-during-refresh",
        }),
      );
    getAccessTokenMock.mockResolvedValue("<ROTATED_ACCESS_TOKEN_EXAMPLE>");
    await expect(access(true)).resolves.toEqual({ status: "ready" });
  });

  it("still rejects another identity replacing a personally held grant", async () => {
    getRawTokensMock.mockResolvedValue(link("user"));
    connectionStateMock
      .mockResolvedValueOnce(state("expired", linkedGrant()))
      .mockResolvedValueOnce(
        state("connected", {
          ...grant(),
          builderAccountLinkId: "replaced-during-refresh",
          builderAccountOwnerEmail: "bob@example.com",
        }),
      );
    getAccessTokenMock.mockResolvedValue("<ROTATED_ACCESS_TOKEN_EXAMPLE>");
    await expect(access(true)).resolves.toMatchObject({
      status: "reconnect_required",
      reason: "revoked",
    });
  });

  it("requests reconnect when the canonical refresh latches revocation", async () => {
    connectionStateMock
      .mockResolvedValueOnce(state("expired"))
      .mockResolvedValueOnce(state("reconnect_required"));
    getAccessTokenMock.mockResolvedValue(null);
    await expect(access(true)).resolves.toMatchObject({
      status: "reconnect_required",
      reason: "revoked",
    });
  });

  it("requests reconnect for expired unrefreshable credentials", async () => {
    const value = grant();
    connectionStateMock.mockResolvedValue(
      state("expired", {
        ...value,
        tokens: { ...value.tokens, refresh_token: "" },
      }),
    );
    await expect(access()).resolves.toMatchObject({
      status: "reconnect_required",
      reason: "expired",
    });
  });

  it("does not refresh credentials already marked for reconnect", async () => {
    connectionStateMock.mockResolvedValue(state("reconnect_required"));
    await expect(access(true)).resolves.toMatchObject({
      status: "reconnect_required",
      reason: "revoked",
    });
    expect(getAccessTokenMock).not.toHaveBeenCalled();
  });

  it("reports exactly the missing DSI scope, not missing account identity", async () => {
    const value = grant();
    connectionStateMock.mockResolvedValue(
      state("connected", {
        ...value,
        tokens: { ...value.tokens, scope: "builder:designsystem:read" },
      }),
    );
    await expect(access()).resolves.toEqual({
      status: "reconnect_required",
      reason: "missing_scopes",
      missingScopes: ["builder:designsystem:write"],
    });
  });

  it.each([
    {},
    { link: { ...link().link, ownerEmail: "someone@example.com" } },
    { link: { ...link("user").link, scopeId: "someone@example.com" } },
  ])(
    "fails closed on malformed or mismatched personal proof",
    async (value) => {
      getRawTokensMock.mockResolvedValue(value);
      await expect(access()).resolves.toEqual({
        status: "unavailable",
        reason: "invalid_connection",
      });
      expect(connectionStateMock).not.toHaveBeenCalled();
    },
  );

  it("distinguishes unreadable credential state from no connection", async () => {
    connectionStateMock.mockResolvedValue({
      kind: "malformed",
      reason: "structure",
    });
    await expect(access()).resolves.toEqual({
      status: "unavailable",
      reason: "invalid_connection",
    });
  });

  it.each(["serverUrl", "clientInformation", "discoveryState", "tokens"])(
    "rejects a broken %s binding before refresh",
    async (field) => {
      connectionStateMock.mockResolvedValue(
        state("connected", { ...grant(), [field]: undefined }),
      );
      await expect(access(true)).resolves.toEqual({
        status: "unavailable",
        reason: "invalid_connection",
      });
      expect(getAccessTokenMock).not.toHaveBeenCalled();
    },
  );

  it.each(["proof", "grant", "refresh"])(
    "sanitizes %s read failures without authorizing",
    async (source) => {
      connectionStateMock.mockResolvedValue(state());
      const failure = new Error("<SECRET_IN_UPSTREAM_ERROR_EXAMPLE>");
      if (source === "proof") getRawTokensMock.mockRejectedValue(failure);
      if (source === "grant") connectionStateMock.mockRejectedValue(failure);
      if (source === "refresh") getAccessTokenMock.mockRejectedValue(failure);
      await expect(access(true)).resolves.toEqual({
        status: "unavailable",
        reason: "store_unavailable",
      });
    },
  );

  it("records provisioning proof only for the verified provisioning identity", async () => {
    fingerprintMock.mockReturnValue("example-fingerprint");
    await attestProvisionedBuilderAccount(ownerEmail, {
      privateKey: "<PRIVATE_KEY_EXAMPLE>",
      publicKey: "<PUBLIC_KEY_EXAMPLE>",
    });
    expect(savePersonalLinkMock).toHaveBeenCalledWith(
      "builder-account",
      perUserKey(ownerEmail),
      {
        link: {
          version: 1,
          source: "provisioned",
          ownerEmail,
          credentialFingerprint: "example-fingerprint",
        },
      },
      `user:${ownerEmail}`,
    );
  });

  it.each(["user", "org", "workspace", "env", null])(
    "requires matching personal provisioning credentials, not %s inheritance",
    async (source) => {
      getRawTokensMock.mockResolvedValue({
        link: {
          version: 1,
          source: "provisioned",
          ownerEmail,
          credentialFingerprint: "example-fingerprint",
        },
      });
      resolveLegacyMock.mockResolvedValue({
        source,
        privateKey: "<PRIVATE_KEY_EXAMPLE>",
        publicKey: "<PUBLIC_KEY_EXAMPLE>",
        lookupFailed: false,
      });
      fingerprintMock.mockReturnValue("example-fingerprint");
      await expect(access()).resolves.toMatchObject({
        status: source === "user" ? "ready" : "reconnect_required",
      });
      expect(resolveLegacyMock).toHaveBeenCalledWith({
        userEmail: ownerEmail,
        orgId: null,
      });
    },
  );

  it("refuses manually replaced provisioning credentials", async () => {
    getRawTokensMock.mockResolvedValue({
      link: {
        version: 1,
        source: "provisioned",
        ownerEmail,
        credentialFingerprint: "example-fingerprint",
      },
    });
    resolveLegacyMock.mockResolvedValue({
      source: "user",
      privateKey: "<PRIVATE_KEY_EXAMPLE>",
      publicKey: "<PUBLIC_KEY_EXAMPLE>",
      lookupFailed: false,
    });
    fingerprintMock.mockReturnValue("different-fingerprint");
    await expect(access()).resolves.toMatchObject({
      status: "reconnect_required",
    });
  });
});

describe("Builder personal proof disconnect", () => {
  const proof = {
    link: {
      version: 1,
      source: "oauth",
      ownerEmail,
      scope: "org",
      scopeId: DEFAULT_ORG,
      grantId: "example-grant-id",
    },
  };
  const snapshot = {
    tokens: proof,
    owner: `user:${ownerEmail}`,
    revision: 7,
    legacyRevision: 3,
    storageVersion: "<ENCRYPTED_PROOF_EXAMPLE>",
  };

  it.each(["succeeded", "failed"])(
    "never removes a peer's personal proof when revoking the shared grant, remote %s",
    async (remote) => {
      getRawTokensMock.mockResolvedValue({ retained: true });
      readMock.mockResolvedValue({
        ...credentials(),
        builderAccountLinkId: "example-grant-id",
        builderAccountOwnerEmail: ownerEmail,
      });
      proofSnapshotMock.mockResolvedValue(snapshot);
      revokeMock.mockResolvedValue({ local: "deleted", remote });
      await expect(
        deleteBuilderOAuthSession(
          "another-admin@example.com",
          "org",
          DEFAULT_ORG,
        ),
      ).resolves.toEqual({
        localDeleted: true,
        remoteRevoked: remote === "succeeded",
      });
      expect(proofSnapshotMock).not.toHaveBeenCalled();
      expect(deleteProofMock).not.toHaveBeenCalled();
    },
  );

  it("does not remove proof when a concurrent refresh or reconnect replaced the grant", async () => {
    getRawTokensMock.mockResolvedValue({ retained: true });
    readMock.mockResolvedValue({
      ...credentials(),
      builderAccountLinkId: "example-grant-id",
      builderAccountOwnerEmail: ownerEmail,
    });
    proofSnapshotMock.mockResolvedValue(snapshot);
    revokeMock.mockResolvedValue({ local: "replaced", remote: "succeeded" });
    await deleteBuilderOAuthSession(ownerEmail, "org", DEFAULT_ORG);
    expect(deleteProofMock).not.toHaveBeenCalled();
  });

  it("explicit caller disconnect removes only its snapshot even after a peer replaced the shared grant", async () => {
    proofSnapshotMock.mockResolvedValue(snapshot);
    const disconnect = await prepareBuilderAccountDisconnect(ownerEmail);
    getRawTokensMock.mockResolvedValue({ retained: true });
    readMock.mockResolvedValue({
      ...credentials(),
      builderAccountOwnerEmail: "bob@example.com",
    });
    revokeMock.mockResolvedValue({ local: "replaced", remote: "succeeded" });
    await deleteBuilderOAuthSession(ownerEmail, "org", DEFAULT_ORG);
    await disconnect();
    expect(deleteProofMock).toHaveBeenCalledTimes(1);
    expect(deleteProofMock).toHaveBeenCalledWith(
      "builder-account",
      perUserKey(ownerEmail),
      `user:${ownerEmail}`,
      7,
      3,
      "<ENCRYPTED_PROOF_EXAMPLE>",
    );
  });

  it("captures the revision before disconnect and never deletes by owner alone", async () => {
    proofSnapshotMock.mockResolvedValue(snapshot);
    const disconnect = await prepareBuilderAccountDisconnect(ownerEmail);
    proofSnapshotMock.mockResolvedValue({ ...snapshot, revision: 8 });
    deleteProofMock.mockResolvedValue(false);
    await disconnect();
    expect(proofSnapshotMock).toHaveBeenCalledTimes(1);
    expect(deleteProofMock).toHaveBeenCalledWith(
      "builder-account",
      perUserKey(ownerEmail),
      `user:${ownerEmail}`,
      7,
      3,
      "<ENCRYPTED_PROOF_EXAMPLE>",
    );
  });

  it("also disconnects provisioned account proof", async () => {
    proofSnapshotMock.mockResolvedValue({
      ...snapshot,
      tokens: {
        link: {
          version: 1,
          source: "provisioned",
          ownerEmail,
          credentialFingerprint: "example-fingerprint",
        },
      },
    });
    const disconnect = await prepareBuilderAccountDisconnect(ownerEmail);
    await disconnect();
    expect(deleteProofMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed if proof is unreadable rather than deleting unverified identity", async () => {
    proofSnapshotMock.mockResolvedValue({ ...snapshot, tokens: {} });
    await expect(prepareBuilderAccountDisconnect(ownerEmail)).rejects.toThrow(
      "could not be verified",
    );
    expect(deleteProofMock).not.toHaveBeenCalled();
  });
});

describe("Builder hosted user OAuth", () => {
  it("uses the exact fixed Builder contract and requests every Builder scope up front", () => {
    expect({
      issuer: BUILDER_OAUTH_ISSUER,
      resource: BUILDER_OAUTH_RESOURCE,
      scopes: BUILDER_OAUTH_SCOPES,
    }).toEqual({
      issuer: "https://mcp.builder.io",
      resource: "https://api.builder.io",
      scopes: [
        "builder:ai:invoke",
        "builder:agents:run",
        "builder:browser:connect",
        "builder:assets:write",
        "builder:projects:read",
        "builder:projects:write",
        "builder:designsystem:read",
        "builder:designsystem:write",
      ],
    });
    expect(BUILDER_OAUTH_SCOPES.join(" ")).not.toContain("offline_access");
  });

  it("starts public PKCE authorization with Builder's fixed resource and scope", async () => {
    startMock.mockResolvedValue({
      authorizationUrl: new URL("https://mcp.builder.io/oauth/authorize"),
      codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
      clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
      discoveryState: { authorizationServerUrl: BUILDER_OAUTH_ISSUER },
    });

    await expect(
      startBuilderOAuthAuthorization({
        ownerEmail,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
        state: "<STATE_EXAMPLE>",
      }),
    ).resolves.toEqual({
      authorizationUrl: "https://mcp.builder.io/oauth/authorize",
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: { authorizationServerUrl: BUILDER_OAUTH_ISSUER },
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });
    expect(startMock).toHaveBeenCalledWith({
      serverUrl: BUILDER_OAUTH_RESOURCE,
      redirectUrl: "https://app.example.com/_agent-native/builder/callback",
      state: "<STATE_EXAMPLE>",
      scope: BUILDER_OAUTH_SCOPES.join(" "),
      resourceMetadataUrl:
        "https://mcp.builder.io/.well-known/oauth-protected-resource/api",
    });
  });

  it("separates PKCE exchange from credential persistence", async () => {
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    const exchanged = await exchangeBuilderOAuthAuthorization({
      ownerEmail,
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(exchanged).toEqual(finished);
    expect(saveMock).not.toHaveBeenCalled();

    await saveBuilderOAuthCredentials({
      ownerEmail,
      orgId: DEFAULT_ORG,
      role: "owner",
      credentials: exchanged,
    });
    expect(saveMock).toHaveBeenCalledWith({
      key: perOrgKey(DEFAULT_ORG),
      scope: "org",
      scopeId: DEFAULT_ORG,
      serverUrl: BUILDER_OAUTH_RESOURCE,
      credentials: expect.objectContaining(finished),
    });
  });

  it("stores a completed grant in the explicit normalized user custody slot", async () => {
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail: "Alice@Example.com ",
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith({
      key: perUserKey(ownerEmail),
      scope: "user",
      scopeId: ownerEmail,
      serverUrl: BUILDER_OAUTH_RESOURCE,
      credentials: expect.objectContaining(finished),
    });
    expect(validateIssuerMock).toHaveBeenCalledWith(
      finished.discoveryState,
      BUILDER_OAUTH_ISSUER,
    );
    expect(finishMock).toHaveBeenCalledWith(
      expect.objectContaining({ iss: BUILDER_OAUTH_ISSUER }),
    );
  });

  // Without this the grant's scopes would have to be guessed on every later
  // read, and a new two-scope grant is indistinguishable from a legacy one.
  it("records the requested scopes when the token response omits them", async () => {
    const finished = credentials({
      tokens: {
        access_token: "<ACCESS_TOKEN_EXAMPLE>",
        issuer: BUILDER_OAUTH_ISSUER,
      },
    });
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          tokens: expect.objectContaining({
            scope: BUILDER_OAUTH_SCOPES.join(" "),
          }),
        }),
      }),
    );
  });

  it("leaves a declared scope claim untouched", async () => {
    const finished = credentials({
      tokens: {
        access_token: "<ACCESS_TOKEN_EXAMPLE>",
        scope: BUILDER_OAUTH_SCOPE,
        issuer: BUILDER_OAUTH_ISSUER,
      },
    });
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining(finished),
      }),
    );
  });

  it("does not accept a completed exchange bound to another resource", async () => {
    const finished = credentials({
      serverUrl: "https://unrelated.example.com",
    });
    finishMock.mockResolvedValue({ credentials: finished });
    await expect(
      finishBuilderOAuthAuthorization({
        ownerEmail,
        code: "<AUTHORIZATION_CODE_EXAMPLE>",
        pending: {
          codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
          clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
          discoveryState: finished.discoveryState,
          redirectUri: "https://app.example.com/_agent-native/builder/callback",
        },
      }),
    ).rejects.toThrow("another resource");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("rejects a callback issuer mismatch before exchanging the code", async () => {
    const finished = credentials();
    validateIssuerMock.mockImplementation(() => {
      throw new Error("issuer mismatch");
    });

    await expect(
      finishBuilderOAuthAuthorization({
        ownerEmail,
        code: "<AUTHORIZATION_CODE_EXAMPLE>",
        iss: "https://unrelated.example.com",
        pending: {
          codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
          clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
          discoveryState: finished.discoveryState,
          redirectUri: "https://app.example.com/_agent-native/builder/callback",
        },
      }),
    ).rejects.toThrow("issuer mismatch");
    expect(finishMock).not.toHaveBeenCalled();
  });

  it("keys token-store lookups by the caller's org", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockResolvedValue(null);
    await hasBuilderOAuthSession("Bob@Example.com");
    expect(getRawTokensMock).toHaveBeenCalledWith(
      "mcp",
      perOrgKey("org-acme"),
      "org:org-acme",
    );
  });

  it("does not fall back to the active org when the caller has no org", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");

    await expect(hasBuilderOAuthSession(ownerEmail, null)).resolves.toBe(false);
    expect(getRawTokensMock).toHaveBeenCalledTimes(1);
    expect(getRawTokensMock).toHaveBeenCalledWith(
      "mcp",
      perUserKey(ownerEmail),
      "user:alice@example.com",
    );
  });

  it("does not treat an unreadable empty token bundle as OAuth custody", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-acme" ? {} : null,
    );

    await expect(hasBuilderOAuthSession(ownerEmail)).resolves.toBe(false);
  });

  it("does not treat a non-record token bundle as OAuth custody", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockResolvedValue("not-a-token-bundle");

    await expect(hasBuilderOAuthSession(ownerEmail)).resolves.toBe(false);
  });

  it("shares one org-scoped credential across members of the same org", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-acme" ? {} : null,
    );
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(credentials());

    await getBuilderOAuthSession("alice@example.com");
    await getBuilderOAuthSession("bob@example.com");

    const keys = getAccessTokenMock.mock.calls.map((c) => c[0].key);
    expect(keys).toEqual([perOrgKey("org-acme"), perOrgKey("org-acme")]);
    expect(getAccessTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "org", scopeId: "org-acme" }),
    );
  });

  it("stores a completed grant under the org scope when the connector has an org", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      role: "owner",
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith({
      key: perOrgKey("org-acme"),
      scope: "org",
      scopeId: "org-acme",
      serverUrl: BUILDER_OAUTH_RESOURCE,
      credentials: expect.objectContaining(finished),
    });
  });

  it("keeps member OAuth credentials in personal custody", async () => {
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      orgId: "org-acme",
      role: "member",
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: perUserKey(ownerEmail),
        scope: "user",
        scopeId: ownerEmail,
      }),
    );
  });

  it("stores under the org captured at start, not the active org at callback", async () => {
    // A switched active org must not win over the org authorized at start.
    resolveOrgMock.mockResolvedValue("org-switched");
    const finished = credentials();
    finishMock.mockResolvedValue({ credentials: finished });

    await finishBuilderOAuthAuthorization({
      ownerEmail,
      orgId: "org-started",
      role: "owner",
      code: "<AUTHORIZATION_CODE_EXAMPLE>",
      iss: BUILDER_OAUTH_ISSUER,
      pending: {
        codeVerifier: "<PKCE_VERIFIER_EXAMPLE>",
        clientInformation: { client_id: "<CLIENT_ID_EXAMPLE>" },
        discoveryState: finished.discoveryState,
        redirectUri: "https://app.example.com/_agent-native/builder/callback",
      },
    });

    expect(saveMock).toHaveBeenCalledWith({
      key: perOrgKey("org-started"),
      scope: "org",
      scopeId: "org-started",
      serverUrl: BUILDER_OAUTH_RESOURCE,
      credentials: expect.objectContaining(finished),
    });
    expect(resolveOrgMock).not.toHaveBeenCalled();
  });

  it("reports the requesting user's email even when the token is org-scoped", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-acme" ? {} : null,
    );
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(credentials());

    await expect(
      resolveBuilderOAuthRequestAccess({
        ownerEmail: "Bob@Example.com",
        requiredScope: BUILDER_OAUTH_SCOPE,
      }),
    ).resolves.toMatchObject({ ownerEmail: "bob@example.com" });
  });

  it("does not return a stored access token after reconnect is required", async () => {
    // reconnect_required lives on the credential now; the generic resolver
    // returns no token for it.
    getAccessTokenMock.mockResolvedValue(null);

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
    expect(readMock).not.toHaveBeenCalled();
  });

  it("marks reconnect required for a revoked OAuth grant", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    await markBuilderOAuthReconnectRequired(ownerEmail);
    expect(markReconnectMock).toHaveBeenCalledWith({
      key: perOrgKey(DEFAULT_ORG),
      scope: "org",
      scopeId: DEFAULT_ORG,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    });
  });

  it("treats malformed Builder-owned custody as present so callers fail closed", async () => {
    getRawTokensMock.mockResolvedValue({ corrupt: true });
    readMock.mockResolvedValue(null);
    await expect(hasBuilderOAuthSession(ownerEmail)).resolves.toBe(true);
    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
  });

  it("accepts custody whose serverUrl was canonicalized with a trailing slash", async () => {
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(
      credentials({
        serverUrl: `${BUILDER_OAUTH_RESOURCE}/`,
      }),
    );
    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toMatchObject({
      accessToken: "<ACCESS_TOKEN_EXAMPLE>",
      scopes: [BUILDER_OAUTH_SCOPE],
    });
  });

  it("parses scopes for status and rejects an insufficient requested scope", async () => {
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(
      credentials({
        tokens: {
          access_token: "<ACCESS_TOKEN_EXAMPLE>",
          scope: "builder:ai:invoke builder:context:read",
          issuer: BUILDER_OAUTH_ISSUER,
        },
      }),
    );
    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toMatchObject({
      scopes: ["builder:ai:invoke", "builder:context:read"],
    });
    await expect(
      resolveBuilderOAuthRequestAccess({
        ownerEmail,
        requiredScope: "builder:assets:write",
      }),
    ).rejects.toThrow("does not grant builder:assets:write");
  });

  it("falls back to an org grant when a personal grant lacks the requested scope", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockImplementation(async (options: { scope: "user" | "org" }) =>
      options.scope === "user"
        ? credentials()
        : credentials({
            tokens: {
              access_token: "<ACCESS_TOKEN_EXAMPLE>",
              scope: BUILDER_OAUTH_SCOPES.join(" "),
              issuer: BUILDER_OAUTH_ISSUER,
            },
          }),
    );

    await expect(
      resolveBuilderOAuthRequestAccess({
        ownerEmail,
        requiredScope: "builder:assets:write",
      }),
    ).resolves.toMatchObject({ scope: "org", scopes: BUILDER_OAUTH_SCOPES });
  });

  it("reports the usable org grant when personal custody needs reconnect", async () => {
    resolveOrgMock.mockResolvedValue("org-acme");
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockImplementation(
      async (options: { scope: "user" | "org" }) =>
        options.scope === "user" ? null : "<ACCESS_TOKEN_EXAMPLE>",
    );
    readMock.mockResolvedValue(credentials());

    await expect(getBuilderOAuthConnectionScope(ownerEmail)).resolves.toBe(
      "org",
    );
  });

  it("reports stored custody for disconnect even when its token is unusable", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    getAccessTokenMock.mockResolvedValue(null);

    await expect(getBuilderOAuthStoredScope(ownerEmail)).resolves.toBe("org");
    expect(getAccessTokenMock).not.toHaveBeenCalled();
  });

  // A stored credential with no `scope` claim predates both Builder always
  // setting one and this flow recording it, so it can only be an AI-only grant.
  // Crediting it with the upload scope would trade a clear local error for an
  // opaque 403 from Builder.
  it("keeps a scope-less legacy credential AI-only", async () => {
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(
      credentials({
        tokens: {
          access_token: "<ACCESS_TOKEN_EXAMPLE>",
          issuer: BUILDER_OAUTH_ISSUER,
        },
      }),
    );

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toMatchObject({
      scopes: [BUILDER_OAUTH_SCOPE],
    });
    await expect(
      resolveBuilderOAuthRequestAccess({
        ownerEmail,
        requiredScope: "builder:assets:write",
      }),
    ).rejects.toThrow("does not grant builder:assets:write");
  });

  it("fails closed for a credential whose issuer or resource binding changed", async () => {
    getRawTokensMock.mockResolvedValue({});
    getAccessTokenMock.mockResolvedValue("<ACCESS_TOKEN_EXAMPLE>");
    readMock.mockResolvedValue(
      credentials({
        discoveryState: {
          authorizationServerUrl: "https://other.example.com",
          authorizationServerMetadata: {
            issuer: "https://other.example.com",
            authorization_endpoint: "https://other.example.com/oauth/authorize",
            token_endpoint: "https://other.example.com/oauth/token",
            registration_endpoint: "https://other.example.com/oauth/register",
            revocation_endpoint: "https://other.example.com/oauth/revoke",
          },
          resourceMetadata: {
            resource: BUILDER_OAUTH_RESOURCE,
            authorization_servers: ["https://other.example.com"],
          },
        },
      }),
    );
    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
  });

  it("delegates expiring bundles to the guarded generic OAuth refresher", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    let stored = credentials({ tokenExpiresAt: Date.now() + 1_000 });
    readMock.mockImplementation(async () => stored);
    getAccessTokenMock.mockImplementation(async () => {
      stored = credentials({
        tokens: {
          ...stored.tokens,
          access_token: "<ROTATED_ACCESS_TOKEN_EXAMPLE>",
          refresh_token: "<ROTATED_REFRESH_TOKEN_EXAMPLE>",
        },
      });
      return "<ROTATED_ACCESS_TOKEN_EXAMPLE>";
    });

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toMatchObject({
      accessToken: "<ROTATED_ACCESS_TOKEN_EXAMPLE>",
      scopes: [BUILDER_OAUTH_SCOPE],
    });
    expect(getAccessTokenMock).toHaveBeenCalledWith({
      key: perOrgKey(DEFAULT_ORG),
      scope: "org",
      scopeId: DEFAULT_ORG,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    });
  });

  it("returns no session and does not double-mark when the resolver yields no token", async () => {
    // The credential lifecycle owns reconnect latching on a failed refresh, so
    // Builder just reports no session instead of writing its own flag.
    readMock.mockResolvedValue(
      credentials({ tokenExpiresAt: Date.now() + 1_000 }),
    );
    getAccessTokenMock.mockResolvedValue(null);

    await expect(getBuilderOAuthSession(ownerEmail)).resolves.toBeNull();
    expect(markReconnectMock).not.toHaveBeenCalled();
  });

  it("revokes remotely on disconnect and always deletes local custody", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    revokeMock.mockResolvedValue({
      local: "deleted",
      remote: "succeeded",
    });

    await expect(deleteBuilderOAuthSession(ownerEmail)).resolves.toEqual({
      localDeleted: true,
      remoteRevoked: true,
    });
    expect(revokeMock).toHaveBeenCalledWith({
      key: perOrgKey(DEFAULT_ORG),
      scope: "org",
      scopeId: DEFAULT_ORG,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    });
  });

  it("deletes local custody even when Builder revocation fails", async () => {
    getRawTokensMock.mockImplementation(
      async (_provider: string, _key: string, owner: string) =>
        owner === "org:org-default" ? {} : null,
    );
    revokeMock.mockResolvedValue({
      local: "deleted",
      remote: "failed",
    });

    await expect(deleteBuilderOAuthSession(ownerEmail)).resolves.toEqual({
      localDeleted: true,
      remoteRevoked: false,
    });
    expect(revokeMock).toHaveBeenCalledTimes(1);
  });
});
