import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProviderApiRuntime,
  defaultProviderApiCredentialResolver,
  type ProviderApiCredentialLookupOptions,
} from "./index.js";
import { resetProviderQuotaStateForTests } from "./quota-governor.js";

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher: vi.fn(async () => ({ dispatch: vi.fn() })),
  isBlockedExtensionUrlWithDns: vi.fn(async () => false),
}));
const workspaceResolve = vi.hoisted(() => vi.fn());
const legacyResolve = vi.hoisted(() => vi.fn());
vi.mock("../workspace-connections/credentials.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../workspace-connections/credentials.js")
  >()),
  resolveWorkspaceConnectionCredentialForApp: workspaceResolve,
}));
vi.mock("../credentials/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credentials/index.js")>()),
  resolveCredentialDetailed: legacyResolve,
}));

function credential(issuer: string) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    type: "service_account",
    client_email: issuer,
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  });
}
beforeEach(() => {
  resetProviderQuotaStateForTests();
  workspaceResolve.mockReset();
  legacyResolve.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("service-account exact source identity", () => {
  it("keeps two connections distinct, reauthorizes cached tokens and invalidates rotated credentials", async () => {
    const values = new Map([
      ["source-a", credential("first@example.test")],
      ["source-b", credential("second@example.test")],
    ]);
    const seen: ProviderApiCredentialLookupOptions[] = [],
      authorizations: string[] = [];
    let tokenExchanges = 0;
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === "https://oauth2.googleapis.com/token") {
          tokenExchanges++;
          const assertion = new URLSearchParams(
            init?.body as URLSearchParams,
          ).get("assertion");
          const payload = JSON.parse(
            Buffer.from(
              String(assertion).split(".")[1] ?? "",
              "base64url",
            ).toString(),
          ) as { iss: string };
          return new Response(
            JSON.stringify({
              access_token: `credential-for-${payload.iss}`,
              expires_in: 3600,
            }),
            { status: 200 },
          );
        }
        authorizations.push(
          (init?.headers as Record<string, string>).Authorization ?? "",
        );
        return new Response(JSON.stringify({ datasets: [] }), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const runtime = createProviderApiRuntime({
      appId: "source-isolation-app",
      providerIds: ["bigquery"],
      getCredentialContext: () => ({
        userEmail: "member@example.test",
        orgId: "source-org",
        credentialScope: "org",
      }),
      resolveCredential: async (lookup) => {
        seen.push(lookup);
        const value = lookup.connectionId
          ? values.get(lookup.connectionId)
          : undefined;
        return value && lookup.connectionId
          ? {
              key: lookup.key,
              value,
              source: "workspace_connection",
              provider: "bigquery",
              connectionId: lookup.connectionId,
              scope: "org",
              scopeId: "source-org",
            }
          : null;
      },
    });
    const run = (connectionId: string) =>
      runtime.executeRequest({
        provider: "bigquery",
        connectionId,
        method: "GET",
        path: "/projects/test-project/datasets",
      });
    const first = await run("source-a");
    const second = await run("source-b");
    expect(first).toMatchObject({
      request: {
        credentialSources: [
          {
            source: "workspace_connection",
            connectionId: "source-a",
            scope: "org",
            scopeId: "source-org",
          },
        ],
      },
    });
    expect(second).toMatchObject({
      request: {
        credentialSources: [
          { source: "workspace_connection", connectionId: "source-b" },
        ],
      },
    });
    await run("source-a");
    expect(authorizations).toEqual([
      "Bearer credential-for-first@example.test",
      "Bearer credential-for-second@example.test",
      "Bearer credential-for-first@example.test",
    ]);
    expect(tokenExchanges).toBe(2);
    expect(
      seen
        .filter((x) => x.key === "GOOGLE_APPLICATION_CREDENTIALS_JSON")
        .map((x) => [x.provider, x.workspaceProvider, x.connectionId]),
    ).toEqual([
      ["bigquery", "bigquery", "source-a"],
      ["bigquery", "bigquery", "source-b"],
      ["bigquery", "bigquery", "source-a"],
    ]);
    values.delete("source-a");
    await expect(run("source-a")).rejects.toThrow(
      "The selected service account credential is not available.",
    );
    expect(authorizations).toHaveLength(3);
    expect(tokenExchanges).toBe(2);
    values.set("source-b", credential("rotated@example.test"));
    await run("source-b");
    expect(authorizations.at(-1)).toBe(
      "Bearer credential-for-rotated@example.test",
    );
    expect(tokenExchanges).toBe(3);
  });
  it("never substitutes legacy org credentials when an explicit workspace source is unavailable", async () => {
    workspaceResolve.mockResolvedValue({
      available: false,
      status: "not_available",
    });
    legacyResolve.mockResolvedValue({
      value: "legacy-source-credential",
      scope: "org",
      scopeId: "source-org",
    });
    await expect(
      defaultProviderApiCredentialResolver({
        appId: "source-isolation-app",
        provider: "bigquery",
        workspaceProvider: "bigquery",
        key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        connectionId: "missing-source",
        ctx: { userEmail: "member@example.test", orgId: "source-org" },
        localCredentialSource: "app_local",
      }),
    ).rejects.toThrow("selected workspace connection is not available");
    expect(legacyResolve).not.toHaveBeenCalled();
  });
  it("reports a key the selected connection does not hold as absent, not as an unusable connection", async () => {
    workspaceResolve.mockResolvedValue({
      available: false,
      status: "missing_ref",
    });
    const result = await defaultProviderApiCredentialResolver({
      appId: "source-isolation-app",
      provider: "bigquery",
      workspaceProvider: "bigquery",
      key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      connectionId: "source-a",
      ctx: { userEmail: "member@example.test", orgId: "source-org" },
      localCredentialSource: "app_local",
    });
    expect(result).toBeNull();
    expect(legacyResolve).not.toHaveBeenCalled();
  });
  it.each(["app_local", "wrong-source"])(
    "rejects explicit credentials with %s provenance before HTTP",
    async (source) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const runtime = createProviderApiRuntime({
        appId: "source-rejection-app",
        providerIds: ["bigquery"],
        getCredentialContext: () => ({
          userEmail: "member@example.test",
          orgId: "source-org",
          credentialScope: "org",
        }),
        resolveCredential: async (lookup) => ({
          key: lookup.key,
          value: "unbound-source-credential",
          provider: "bigquery",
          source: source === "app_local" ? "app_local" : "workspace_connection",
          connectionId: "another-source",
          scope: "org",
          scopeId: "source-org",
        }),
      });
      await expect(
        runtime.executeRequest({
          provider: "bigquery",
          connectionId: "selected-source",
          method: "GET",
          path: "/projects/test-project/datasets",
        }),
      ).rejects.toThrow(
        "The selected service account credential is not available.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
