import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  grants: new Map<string, Record<string, unknown>>(),
  refresh: vi.fn(),
  coreSource: new URL("../../../../packages/core/src", import.meta.url)
    .pathname,
}));

vi.mock(
  "../../../../packages/core/src/extensions/url-safety.js",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    ssrfSafeFetch: fixtures.refresh,
  }),
);
vi.mock("../../../../packages/core/src/oauth-tokens/store.js", () => ({
  getOAuthTokens: async (_provider: string, _key: string, owner: string) =>
    fixtures.grants.get(owner) ?? null,
  getOAuthTokenSnapshot: async (
    _provider: string,
    _key: string,
    owner: string,
  ) => {
    const tokens = fixtures.grants.get(owner);
    return tokens
      ? {
          tokens,
          owner,
          revision: 1,
          legacyRevision: 1,
          storageVersion: "test",
        }
      : null;
  },
  getOAuthTokenSnapshotForUserOwner: async () => null,
  replaceOAuthTokensIfRevision: vi.fn(),
  deleteOAuthTokensIfRevision: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));
vi.mock(
  "../../../../packages/core/src/settings/store.js",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    mutateSetting: async (_key: string, update: (value: null) => unknown) =>
      update(null),
  }),
);
vi.mock(
  "../../../../packages/core/src/server/personal-provider-key-policy.js",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    isPersonalProviderKeyUseRestricted: async () => false,
    readOrgMemberRole: async () => "member",
  }),
);
vi.mock(
  "../../../../packages/core/src/server/credential-provider.js",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    resolveBuilderCredential: async () => null,
  }),
);

vi.mock(
  "@agent-native/core/file-upload",
  () => import(`${fixtures.coreSource}/file-upload/index.js`),
);
vi.mock(
  "@agent-native/core/server/request-context",
  () => import(`${fixtures.coreSource}/server/request-context.js`),
);
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  canAuthorizeBuilderApiRequest: (
    await import(`${fixtures.coreSource}/server/builder-api-auth.js`)
  ).canAuthorizeBuilderApiRequest,
}));

import {
  listFileUploadProviders,
  registerFileUploadProvider,
  unregisterFileUploadProvider,
} from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server/request-context";

const { BUILDER_OAUTH_ISSUER, BUILDER_OAUTH_RESOURCE, BUILDER_OAUTH_SCOPES } =
  await import(`${fixtures.coreSource}/server/builder-oauth.js`);
import action from "../../actions/get-video-storage-status.js";
import { hasRequestVideoStorage } from "./video-storage.js";

function grant(expiresAt: number) {
  return {
    serverUrl: BUILDER_OAUTH_RESOURCE,
    clientInformation: {
      client_id: "test-client",
      issuer: BUILDER_OAUTH_ISSUER,
    },
    discoveryState: {
      authorizationServerUrl: BUILDER_OAUTH_ISSUER,
      authorizationServerMetadata: {
        issuer: BUILDER_OAUTH_ISSUER,
        token_endpoint: `${BUILDER_OAUTH_ISSUER}/oauth/token`,
      },
      resourceMetadata: { resource: BUILDER_OAUTH_RESOURCE },
    },
    tokens: {
      access_token: "<ACCESS_TOKEN>",
      refresh_token: "<REFRESH_TOKEN>",
      scope: BUILDER_OAUTH_SCOPES.join(" "),
      issuer: BUILDER_OAUTH_ISSUER,
    },
    tokenExpiresAt: expiresAt,
  };
}

function request<T>(fn: () => Promise<T>) {
  return runWithRequestContext(
    { userEmail: "alice@example.com", orgId: "org-1" },
    fn,
  );
}

function status() {
  return request(async () =>
    action.run({}, { caller: "http", userEmail: "alice@example.com" }),
  );
}

function customStorage() {
  registerFileUploadProvider({
    id: "custom",
    name: "Custom",
    isConfigured: () => true,
    upload: vi.fn(),
  });
}

describe("Clips storage readiness during Builder refresh", () => {
  beforeEach(() => {
    for (const provider of listFileUploadProviders())
      unregisterFileUploadProvider(provider.id);
    fixtures.grants.clear();
    fixtures.refresh
      .mockReset()
      .mockRejectedValue(new Error("authorization server unavailable"));
  });

  it("keeps aggregated onboarding readiness retryable", async () => {
    fixtures.grants.set("user:alice@example.com", grant(Date.now() - 1));
    await expect(request(() => hasRequestVideoStorage())).rejects.toMatchObject(
      {
        name: "VideoStorageStatusUnavailableError",
        statusCode: 503,
        causes: [
          expect.objectContaining({ name: "McpOAuthRefreshUnavailableError" }),
        ],
      },
    );
    expect(fixtures.refresh).toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps the action retryable with custom storage=%s",
    async (custom) => {
      if (custom) customStorage();
      fixtures.grants.set("user:alice@example.com", grant(Date.now() - 1));
      await expect(status()).rejects.toMatchObject({
        name: "McpOAuthRefreshUnavailableError",
        statusCode: 503,
      });
      expect(fixtures.refresh).toHaveBeenCalled();
    },
  );

  it("reports no storage when no grant exists", async () => {
    await expect(request(() => hasRequestVideoStorage())).resolves.toBe(false);
    await expect(status()).resolves.toMatchObject({
      configured: false,
      mode: "none",
    });
    expect(fixtures.refresh).not.toHaveBeenCalled();
  });

  it("uses a valid organization grant when personal refresh fails", async () => {
    fixtures.grants.set("user:alice@example.com", grant(Date.now() - 1));
    fixtures.grants.set("org:org-1", grant(Date.now() + 3_600_000));
    await expect(request(() => hasRequestVideoStorage())).resolves.toBe(true);
    await expect(status()).resolves.toMatchObject({
      configured: true,
      mode: "own",
    });
    expect(fixtures.refresh).toHaveBeenCalled();
  });
});
