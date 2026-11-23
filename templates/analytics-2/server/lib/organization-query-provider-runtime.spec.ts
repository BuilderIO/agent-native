import { generateKeyPairSync, randomUUID } from "node:crypto";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  serviceAccount: "",
  constructors: [] as Array<Record<string, unknown>>,
  dispatcher: { dispatch: vi.fn() },
}));
vi.mock("@agent-native/core/provider-api", async (original) => {
  const actual =
    await original<typeof import("@agent-native/core/provider-api")>();
  return {
    ...actual,
    listCustomProviders: async () => [],
    createProviderApiRuntime: (
      options: Parameters<typeof actual.createProviderApiRuntime>[0],
    ) => {
      fixture.constructors.push(options as unknown as Record<string, unknown>);
      return actual.createProviderApiRuntime(options);
    },
    defaultProviderApiCredentialResolver: async (options: { key: string }) =>
      options.key === "GOOGLE_APPLICATION_CREDENTIALS_JSON"
        ? {
            key: options.key,
            value: fixture.serviceAccount,
            scope: "org",
            scopeId: "query-runtime-org",
            source: "app_secret",
            provider: "bigquery",
          }
        : null,
  };
});
vi.mock("@agent-native/core/server", async (original) => ({
  ...(await original<typeof import("@agent-native/core/server")>()),
  getCredentialContext: () => ({
    userEmail: "member@example.test",
    orgId: "query-runtime-org",
    credentialScope: "org",
  }),
}));
vi.mock("@agent-native/core/extensions/url-safety", async (original) => ({
  ...(await original<
    typeof import("@agent-native/core/extensions/url-safety")
  >()),
  isBlockedExtensionUrlWithDns: async () => false,
  createSsrfSafeDispatcher: async () => fixture.dispatcher,
}));
import {
  getAnalytics2ProviderApiRuntime,
  getAnalytics2OrganizationQueryProviderApiRuntime,
  getAnalytics2OrganizationConnectionRuntime,
} from "./provider-api.js";
const request = {
  provider: "bigquery" as const,
  method: "POST" as const,
  path: "projects/query-project/queries",
  body: {
    query: "SELECT 1",
    useLegacySql: false,
    maximumBytesBilled: "50000000000",
  },
};
beforeEach(() => {
  vi.stubEnv("AGENT_NATIVE_PROVIDER_API_QUOTA_GOVERNOR", "1");
  vi.stubEnv("AGENT_NATIVE_PROVIDER_API_MAX_ATTEMPTS", "2");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  fixture.serviceAccount = JSON.stringify({
    type: "service_account",
    project_id: "query-project",
    client_email: "query-fixture@example.test",
    private_key: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) =>
      String(url).includes("oauth2.googleapis.com")
        ? new Response(
            JSON.stringify({
              access_token: "synthetic-access",
              expires_in: 3600,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        : new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const providerCalls = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).includes("/queries"));
describe("organization query provider runtime prerequisite", () => {
  it("keeps dedicated runtime separate while preserving default and catalog runtime policies", () => {
    const ordinary = getAnalytics2ProviderApiRuntime();
    const query = getAnalytics2OrganizationQueryProviderApiRuntime();
    const catalog =
      getAnalytics2OrganizationConnectionRuntime("connection-fixture");
    expect(query).not.toBe(ordinary);
    expect(query).toBe(getAnalytics2OrganizationQueryProviderApiRuntime());
    expect(query.requestCapabilities?.singleAttemptUnsafeRequests).toBe(true);
    expect(ordinary.requestCapabilities?.singleAttemptUnsafeRequests).toBe(
      false,
    );
    expect(catalog.requestCapabilities?.singleAttemptUnsafeRequests).toBe(
      false,
    );
    expect(fixture.constructors[0]).not.toHaveProperty("unsafeRequestPolicy");
    expect(fixture.constructors[1]).toMatchObject({
      appId: "analytics-2",
      unsafeRequestPolicy: "single-attempt",
    });
    expect(fixture.constructors[0]?.appId).toBe(fixture.constructors[1]?.appId);
    expect(fixture.constructors.at(-1)).not.toHaveProperty(
      "unsafeRequestPolicy",
    );
  });
  it("makes one actual controlled query POST after a dispatcher compatibility failure", async () => {
    vi.mocked(fetch).mockImplementation(async (url: unknown) => {
      if (String(url).includes("oauth2.googleapis.com"))
        return new Response(
          JSON.stringify({
            access_token: "synthetic-access",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      throw Object.assign(new TypeError("fetch failed"), {
        cause: {
          code: "UND_ERR_INVALID_ARG",
          message: "invalid onRequestStart method",
        },
      });
    });
    await expect(
      getAnalytics2OrganizationQueryProviderApiRuntime().executeRequest(
        request,
      ),
    ).rejects.toThrow();
    expect(providerCalls()).toHaveLength(1);
  });
  it("returns quota failure after one query POST without quota redispatch", async () => {
    vi.mocked(fetch).mockImplementation(async (url: unknown) =>
      String(url).includes("oauth2.googleapis.com")
        ? new Response(
            JSON.stringify({
              access_token: "synthetic-access",
              expires_in: 3600,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        : new Response(JSON.stringify({ error: { message: "quota" } }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "0" },
          }),
    );
    const result =
      await getAnalytics2OrganizationQueryProviderApiRuntime().executeRequest(
        request,
      );
    expect(result).toMatchObject({ response: { status: 429, ok: false } });
    expect(providerCalls()).toHaveLength(1);
  });
  it("makes one query POST after an actual controlled AbortError", async () => {
    vi.mocked(fetch).mockImplementation(async (url: unknown) => {
      if (String(url).includes("oauth2.googleapis.com"))
        return new Response(
          JSON.stringify({
            access_token: "synthetic-access",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      throw new DOMException("Controlled request timeout", "AbortError");
    });
    await expect(
      getAnalytics2OrganizationQueryProviderApiRuntime().executeRequest({
        ...request,
        body: { ...request.body },
      }),
    ).rejects.toThrow();
    expect(providerCalls()).toHaveLength(1);
  });

  it("serializes identical unsafe POSTs on one quota while each runtime keeps its own retry policy", async () => {
    let releaseFirst: ((response: Response) => void) | undefined;
    let attempts = 0;
    const common = {
      ...request,
      maxBytes: 4_000_000,
      body: { ...request.body, query: `SELECT '${randomUUID()}'` },
    };
    vi.mocked(fetch).mockImplementation(async (url: unknown) => {
      if (String(url).includes("oauth2.googleapis.com"))
        return new Response(
          JSON.stringify({
            access_token: "synthetic-access",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      attempts++;
      if (attempts === 1)
        return new Promise<Response>((resolve) => {
          releaseFirst = resolve;
        });
      return new Response("{}", {
        status: attempts === 2 ? 200 : 429,
        headers: { "content-type": "application/json", "retry-after": "0" },
      });
    });
    const ordinary = getAnalytics2ProviderApiRuntime().executeRequest(common);
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));
    const dedicated =
      getAnalytics2OrganizationQueryProviderApiRuntime().executeRequest(common);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(providerCalls()).toHaveLength(1);
    releaseFirst?.(
      new Response("{}", {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "0" },
      }),
    );
    const [ordinaryResult, dedicatedResult] = await Promise.all([
      ordinary,
      dedicated,
    ]);
    expect(ordinaryResult).toMatchObject({ response: { status: 200 } });
    expect(dedicatedResult).toMatchObject({ response: { status: 429 } });
    expect(providerCalls()).toHaveLength(3);
  });
});
