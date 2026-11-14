import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  grants: new Map<string, Record<string, unknown>>(),
  refresh: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@modelcontextprotocol/client")>()),
  refreshAuthorization: fixtures.refresh,
}));
vi.mock("../oauth-tokens/store.js", () => ({
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
vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  mutateSetting: async (_key: string, update: (value: null) => unknown) =>
    update(null),
}));
vi.mock(
  "../server/personal-provider-key-policy.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/personal-provider-key-policy.js")
    >()),
    isPersonalProviderKeyUseRestricted: async () => false,
    readOrgMemberRole: async () => "member",
  }),
);
vi.mock("../server/credential-provider.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/credential-provider.js")
  >()),
  resolveBuilderCredential: async () => null,
}));
vi.mock("../server/auth.js", () => ({
  getSession: async () => ({ email: "alice@example.com", orgId: "org-1" }),
}));
vi.mock("../application-state/store.js", () => ({
  appStateGet: async () => null,
  appStatePut: async () => undefined,
}));
vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: async () => [],
}));

import {
  listFileUploadProviders,
  unregisterFileUploadProvider,
} from "../file-upload/registry.js";
import {
  BUILDER_OAUTH_ISSUER,
  BUILDER_OAUTH_RESOURCE,
  BUILDER_OAUTH_SCOPES,
} from "../server/builder-oauth.js";
import { registerDefaultOnboardingSteps } from "./default-steps.js";
import { createOnboardingPlugin } from "./plugin.js";
import {
  __resetOnboardingRegistry,
  listOnboardingSteps,
  registerOnboardingStep,
} from "./registry.js";

function grant(expiresAt: number) {
  return {
    serverUrl: BUILDER_OAUTH_RESOURCE,
    clientInformation: {
      client_id: "test-client",
      issuer: BUILDER_OAUTH_ISSUER,
    },
    discoveryState: {
      authorizationServerUrl: BUILDER_OAUTH_ISSUER,
      authorizationServerMetadata: { issuer: BUILDER_OAUTH_ISSUER },
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

async function summary() {
  const nitroApp = {
    h3: {
      "~middleware": [] as Array<
        (event: unknown, next: () => Promise<unknown>) => Promise<unknown>
      >,
    },
  };
  await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);
  const url = "https://app.test/_agent-native/onboarding/summary";
  const event = {
    method: "GET",
    url: new URL(url),
    path: new URL(url).pathname,
    context: {},
    req: new Request(url),
    res: { status: 200, headers: new Headers() },
    node: {
      req: {
        method: "GET",
        url: new URL(url).pathname,
        headers: { host: "app.test" },
      },
      res: { statusCode: 200, setHeader() {} },
    },
  };
  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    return middleware ? middleware(event, next) : undefined;
  };
  const body = await next();
  return { status: event.res.status, body };
}

registerDefaultOnboardingSteps();
const storageStep = listOnboardingSteps().find(
  (step) => step.id === "file-storage",
);
if (!storageStep)
  throw new Error("Default file storage onboarding step is missing");

describe("Builder refresh in onboarding summary", () => {
  beforeEach(() => {
    __resetOnboardingRegistry();
    registerOnboardingStep(storageStep);
    for (const provider of listFileUploadProviders())
      unregisterFileUploadProvider(provider.id);
    fixtures.grants.clear();
    fixtures.refresh
      .mockReset()
      .mockRejectedValue(new Error("authorization server unavailable"));
  });

  it("returns a retryable failure for an expired grant when refresh is unavailable", async () => {
    fixtures.grants.set("user:alice@example.com", grant(Date.now() - 1));
    const result = await summary();
    expect(fixtures.refresh).toHaveBeenCalled();
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: "Internal server error" });
  });

  it("reports missing storage when no grant exists", async () => {
    const result = await summary();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      steps: [{ id: "file-storage", complete: false }],
    });
    expect(fixtures.refresh).not.toHaveBeenCalled();
  });

  it("uses an available organization grant when personal refresh fails", async () => {
    fixtures.grants.set("user:alice@example.com", grant(Date.now() - 1));
    fixtures.grants.set("org:org-1", grant(Date.now() + 3_600_000));
    const result = await summary();
    expect(fixtures.refresh).toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      steps: [{ id: "file-storage", complete: true }],
    });
  });
});
