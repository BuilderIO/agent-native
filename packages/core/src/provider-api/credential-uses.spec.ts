import { generateKeyPairSync } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CredentialUseLedger,
  runWithCredentialUseLedger,
  type CredentialUse,
} from "../credentials/use-ledger.js";
import { isOrgShareableRun } from "../data-programs/shared-runs.js";
import type {
  ProviderApiCredentialResolver,
  ProviderApiRuntimeOptions,
} from "./index.js";

const ORG = "org-1";
const MEMBER = "ada@example.com";

const stored = vi.hoisted(
  () => new Map<string, { value: string; scope: string; scopeId: string }>(),
);

vi.mock("../credentials/index.js", async () => {
  const { recordCredentialUse } = await import("../credentials/use-ledger.js");
  return {
    assertCredentialCanReachEndpoint: vi.fn(),
    describeCredentialScopeGap: vi.fn(async () => null),
    resolveCredential: vi.fn(async (key: string) => stored.get(key)?.value),
    resolveCredentialDetailed: vi.fn(async (key: string) => {
      const credential = stored.get(key);
      recordCredentialUse({
        kind: "stored",
        key,
        scope: credential?.scope ?? null,
        scopeId: credential?.scopeId ?? null,
      });
      return credential;
    }),
  };
});

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher: vi.fn(async () => ({ dispatch: vi.fn() })),
  isBlockedExtensionUrlWithDns: vi.fn(async () => false),
}));

vi.mock("../oauth-tokens/index.js", () => ({
  deleteOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(async () => []),
  resolveOAuthTokenBundleAccess: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("../workspace-connections/store.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../workspace-connections/store.js")
  >()),
  resolveWorkspaceConnectionForApp: vi.fn(async () => ({
    available: false,
    connection: null,
    appAccess: null,
    reason: "No matching workspace connection.",
  })),
}));

vi.mock("../workspace-connections/credentials.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../workspace-connections/credentials.js")
  >()),
  resolveWorkspaceConnectionCredentialForApp: vi.fn(async () => ({
    available: false,
    value: undefined,
    provenance: null,
  })),
}));

vi.mock("../server/credential-provider.js", () => ({
  resolveSecret: vi.fn(async () => null),
}));

vi.mock("../server/request-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/request-context.js")>()),
  getCredentialContext: () => ({ userEmail: MEMBER, orgId: ORG }),
  getRequestOrgId: () => ORG,
  getRequestUserEmail: () => MEMBER,
}));

vi.mock("../workspace-files/store.js", () => ({
  SAVE_TO_FILE_MAX_BYTES: 20 * 1024 * 1024,
  isScratchWorkspacePath: (filePath: string) => filePath.startsWith("scratch/"),
  toWorkspaceFileCard: (meta: unknown) => ({ meta }),
  writeWorkspaceFile: vi.fn(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

const { createProviderApiRuntime, resolveProviderApiCredentialUses } =
  await import("./index.js");
const { resetProviderQuotaStateForTests } = await import("./quota-governor.js");

function runtimeOptions(
  resolveCredential?: ProviderApiCredentialResolver,
): ProviderApiRuntimeOptions {
  return {
    appId: "credential-uses-test",
    providerIds: ["posthog", "stripe"],
    getCredentialContext: () => ({ userEmail: MEMBER, orgId: ORG }),
    ...(resolveCredential ? { resolveCredential } : {}),
  };
}

function setStored(key: string, scope: "org" | "user") {
  stored.set(key, {
    value: `${key.toLowerCase()}-value`,
    scope,
    scopeId: scope === "org" ? ORG : MEMBER,
  });
}

async function recordedUses(
  options: ProviderApiRuntimeOptions,
  request: Parameters<
    ReturnType<typeof createProviderApiRuntime>["executeRequest"]
  >[0],
): Promise<CredentialUse[]> {
  const ledger = new CredentialUseLedger();
  await runWithCredentialUseLedger(ledger, () =>
    createProviderApiRuntime(options).executeRequest(request),
  );
  return ledger.uses;
}

function shareable(uses: CredentialUse[]) {
  return isOrgShareableRun({
    uses,
    bridgeToolsUsed: ["provider-api-request"],
    orgId: ORG,
  });
}

function providerUses(uses: CredentialUse[]) {
  return new Set(
    uses
      .filter((use) => use.kind !== "stored" && use.kind !== "unreadable")
      .map((use) => JSON.stringify(use)),
  );
}

beforeEach(() => {
  stored.clear();
  resetProviderQuotaStateForTests();
  vi.unstubAllEnvs();
  vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "0");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

describe("provider API requests record the credentials they use", () => {
  it("records the org's own key and project for a PostHog request, which can be shared", async () => {
    setStored("POSTHOG_API_KEY", "org");
    setStored("POSTHOG_PROJECT_ID", "org");

    const uses = await recordedUses(runtimeOptions(), {
      provider: "posthog",
      path: "/api/projects/{projectId}/insights/",
    });

    expect(uses).toContainEqual({
      kind: "provider-request",
      provider: "posthog",
    });
    for (const key of ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"]) {
      expect(uses).toContainEqual({
        kind: "provider-auth",
        provider: "posthog",
        key,
        source: "app_local",
        scope: "org",
        scopeId: ORG,
        connectionId: null,
        accountId: null,
      });
    }
    expect(shareable(uses)).toBe(true);
  });

  it("records a member's own key, so the run is never shared", async () => {
    setStored("POSTHOG_API_KEY", "user");
    setStored("POSTHOG_PROJECT_ID", "org");

    const uses = await recordedUses(runtimeOptions(), {
      provider: "posthog",
      path: "/api/projects/{projectId}/insights/",
    });

    expect(uses).toContainEqual(
      expect.objectContaining({
        kind: "provider-auth",
        key: "POSTHOG_API_KEY",
        scope: "user",
        scopeId: MEMBER,
      }),
    );
    expect(shareable(uses)).toBe(false);
  });

  it("records a placeholder an app resolver read from a connection, so the run is never shared", async () => {
    setStored("POSTHOG_API_KEY", "org");
    const resolveCredential: ProviderApiCredentialResolver = async ({
      key,
      provider,
    }) =>
      key === "POSTHOG_PROJECT_ID"
        ? {
            key,
            value: "123",
            source: "workspace_connection",
            provider,
            connectionId: "conn_1",
            scope: "org",
            scopeId: ORG,
          }
        : key === "POSTHOG_API_KEY"
          ? {
              key,
              value: "org-key",
              source: "app_local",
              provider,
              scope: "org",
              scopeId: ORG,
            }
          : null;

    const uses = await recordedUses(runtimeOptions(resolveCredential), {
      provider: "posthog",
      path: "/api/projects/{projectId}/insights/",
    });

    expect(uses).toContainEqual(
      expect.objectContaining({
        kind: "provider-auth",
        key: "POSTHOG_PROJECT_ID",
        source: "workspace_connection",
        connectionId: "conn_1",
      }),
    );
    expect(shareable(uses)).toBe(false);
  });

  it("records a provider whose credentials couldn't be resolved, so a caught failure is never shared", async () => {
    const ledger = new CredentialUseLedger();

    await expect(
      runWithCredentialUseLedger(ledger, () =>
        createProviderApiRuntime(runtimeOptions()).executeRequest({
          provider: "stripe",
          path: "/customers",
        }),
      ),
    ).rejects.toThrow();

    expect(ledger.uses).toContainEqual({
      kind: "provider-unresolved",
      provider: "stripe",
    });
    expect(shareable(ledger.uses)).toBe(false);
  });

  it("records a provider the request couldn't be admitted for, so a caught error is never shared", async () => {
    const ledger = new CredentialUseLedger();
    const options: ProviderApiRuntimeOptions = {
      ...runtimeOptions(),
      getCustomProviders: async () => [],
    };

    for (const provider of ["missing-provider", "github"]) {
      await expect(
        runWithCredentialUseLedger(ledger, () =>
          createProviderApiRuntime(options).executeRequest({
            provider,
            path: "/",
          }),
        ),
      ).rejects.toThrow();
    }

    expect(ledger.uses).toEqual([
      { kind: "provider-unresolved", provider: "missing-provider" },
      { kind: "provider-unresolved", provider: "github" },
    ]);
    expect(shareable(ledger.uses)).toBe(false);
  });

  it("never looks up a person's OAuth account in a run shared with the org", async () => {
    const { listOAuthAccountsByOwner } =
      await import("../oauth-tokens/index.js");
    const options: ProviderApiRuntimeOptions = {
      ...runtimeOptions(),
      providerIds: ["gmail"],
    };
    const request = { provider: "gmail", path: "/users/me/messages" };

    vi.mocked(listOAuthAccountsByOwner).mockClear();
    await expect(
      runWithCredentialUseLedger(new CredentialUseLedger(), () =>
        createProviderApiRuntime(options).executeRequest(request),
      ),
    ).rejects.toThrow();
    expect(listOAuthAccountsByOwner).toHaveBeenCalled();

    vi.mocked(listOAuthAccountsByOwner).mockClear();
    const ledger = new CredentialUseLedger({ orgCredentialsOnly: true });
    await expect(
      runWithCredentialUseLedger(ledger, () =>
        createProviderApiRuntime(options).executeRequest(request),
      ),
    ).rejects.toThrow("a run shared with the org doesn't use");
    expect(listOAuthAccountsByOwner).not.toHaveBeenCalled();
    expect(ledger.uses).toContainEqual({
      kind: "provider-unresolved",
      provider: "gmail",
    });
    expect(shareable(ledger.uses)).toBe(false);
  });

  it("records a request that turns off the provider's own auth", async () => {
    const uses = await recordedUses(runtimeOptions(), {
      provider: "stripe",
      path: "/customers",
      auth: "none",
    });

    expect(uses).toContainEqual({ kind: "caller-auth", provider: "stripe" });
    expect(shareable(uses)).toBe(false);
  });

  it("resolves for a viewer exactly what a request with the same credentials recorded", async () => {
    setStored("POSTHOG_API_KEY", "org");
    setStored("POSTHOG_PROJECT_ID", "org");
    const options = runtimeOptions();

    const requested = await recordedUses(options, {
      provider: "posthog",
      path: "/api/projects/{projectId}/insights/",
    });
    const resolved = await resolveProviderApiCredentialUses("posthog", options);

    expect(providerUses(resolved)).toEqual(providerUses(requested));

    setStored("POSTHOG_API_KEY", "user");
    const personal = await resolveProviderApiCredentialUses("posthog", options);
    expect(providerUses(personal)).not.toEqual(providerUses(requested));
  });

  it("records a GA4 service account under gcloud, and a viewer's GA4 replay finds it there", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    stored.set("GOOGLE_APPLICATION_CREDENTIALS_JSON", {
      value: JSON.stringify({
        type: "service_account",
        client_email: "reader@example.test",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
        token_uri: "https://oauth2.googleapis.com/token",
      }),
      scope: "org",
      scopeId: ORG,
    });
    setStored("GA4_PROPERTY_ID", "org");
    vi.mocked(globalThis.fetch).mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url) === "https://oauth2.googleapis.com/token"
              ? { access_token: "ga4-token", expires_in: 3600 }
              : {},
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const options = { ...runtimeOptions(), providerIds: ["ga4"] };

    const requested = await recordedUses(options, {
      provider: "ga4",
      path: "/properties/{propertyId}/metadata",
    });
    const resolved = await resolveProviderApiCredentialUses("ga4", options);

    expect(requested).toContainEqual(
      expect.objectContaining({
        kind: "provider-auth",
        provider: "gcloud",
        key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        scope: "org",
        scopeId: ORG,
      }),
    );
    expect(shareable(requested)).toBe(true);
    expect(providerUses(resolved)).toEqual(providerUses(requested));
  });
});
