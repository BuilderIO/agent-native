import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetProviderCallCensusForTests } from "./call-census.js";
import { createProviderApiRuntime } from "./index.js";
import { resetProviderQuotaStateForTests } from "./quota-governor.js";

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher: vi.fn(async () => ({ dispatch: vi.fn() })),
  isBlockedExtensionUrlWithDns: vi.fn(async () => false),
}));

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

let counter = 0;
function fixture(credential?: Record<string, unknown> | string) {
  // A distinct identity per test keeps the module-level token cache from
  // carrying a token from one case into the next.
  const email = `exchange-${(counter += 1)}@example.test`;
  const value =
    typeof credential === "string"
      ? credential
      : JSON.stringify({
          type: "service_account",
          client_email: email,
          private_key: PEM,
          ...credential,
        });
  const runtime = createProviderApiRuntime({
    appId: "token-exchange-fixture",
    providerIds: ["bigquery"],
    getCredentialContext: () => ({
      userEmail: "member@example.test",
      orgId: "exchange-fixture-org",
      credentialScope: "org",
    }),
    resolveCredential: async (lookup) => ({
      key: lookup.key,
      value,
      source: "workspace_connection",
      provider: "bigquery",
      connectionId: "exchange-fixture-source",
      scope: "org",
      scopeId: "exchange-fixture-org",
    }),
  });
  const run = () =>
    runtime.executeRequest({
      provider: "bigquery",
      connectionId: "exchange-fixture-source",
      method: "GET",
      path: "/projects/test-project/datasets",
    });
  return { run, email };
}

function stubFetch(token: () => Response) {
  const exchanges: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/token")) {
        exchanges.push({ url: String(url), init });
        return token();
      }
      return new Response(JSON.stringify({ datasets: [] }));
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return exchanges;
}

const ok = (body: Record<string, unknown>) => () =>
  new Response(JSON.stringify(body));

function decodeJwtPayload(jwt: string) {
  return JSON.parse(
    Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

beforeEach(() => {
  resetProviderQuotaStateForTests();
  resetProviderCallCensusForTests();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  resetProviderCallCensusForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("service-account token exchange", () => {
  it("posts a signed JWT assertion for the credential's identity and scopes", async () => {
    const { run, email } = fixture();
    const exchanges = stubFetch(
      ok({ access_token: "tok-a", expires_in: 3600 }),
    );
    await run();
    expect(exchanges).toHaveLength(1);
    const { url, init } = exchanges[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    const claims = decodeJwtPayload(body.get("assertion")!);
    const now = Math.floor(Date.now() / 1000);
    expect(claims).toMatchObject({
      iss: email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
    expect(String(claims.scope)).toContain(
      "https://www.googleapis.com/auth/bigquery",
    );
  });

  it("reuses a token until 30 seconds before it expires", async () => {
    const { run } = fixture();
    const exchanges = stubFetch(
      ok({ access_token: "tok-b", expires_in: 3600 }),
    );
    await run();
    vi.setSystemTime(Date.now() + 3569_000);
    await run();
    expect(exchanges).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2_000);
    await run();
    expect(exchanges).toHaveLength(2);
  });

  it("treats a missing expires_in as one hour", async () => {
    const { run } = fixture();
    const exchanges = stubFetch(ok({ access_token: "tok-c" }));
    await run();
    vi.setSystemTime(Date.now() + 3569_000);
    await run();
    expect(exchanges).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2_000);
    await run();
    expect(exchanges).toHaveLength(2);
  });

  it("refuses to run when the key is not a service account key", async () => {
    await expect(fixture("{not json").run()).rejects.toThrow(
      "is not valid JSON",
    );
    for (const missing of [
      { client_email: "" },
      { private_key: "" },
      { client_email: "", private_key: "" },
    ]) {
      const { run } = fixture(missing);
      stubFetch(ok({ access_token: "never-used" }));
      await expect(run()).rejects.toThrow("must be a service account JSON key");
    }
  });

  it("reports the status and body of a failed exchange", async () => {
    const { run } = fixture();
    stubFetch(() => new Response("denied by policy", { status: 403 }));
    await expect(run()).rejects.toThrow(
      "Google OAuth error 403: denied by policy",
    );
  });

  it.each([
    ["an array body", () => new Response("[]")],
    ["a null body", () => new Response("null")],
    ["an error field", ok({ error: "invalid_grant", access_token: "tok" })],
    ["no access token", ok({ expires_in: 3600 })],
    ["a numeric access token", ok({ access_token: 7, expires_in: 3600 })],
    ["an empty access token", ok({ access_token: "", expires_in: 3600 })],
    [
      "a whitespace access token",
      ok({ access_token: "has space", expires_in: 3600 }),
    ],
    ["a zero lifetime", ok({ access_token: "tok", expires_in: 0 })],
    ["a negative lifetime", ok({ access_token: "tok", expires_in: -5 })],
    ["a fractional lifetime", ok({ access_token: "tok", expires_in: 1.5 })],
    ["a string lifetime", ok({ access_token: "tok", expires_in: "3600" })],
    [
      "a lifetime that overflows the clock",
      ok({ access_token: "tok", expires_in: Number.MAX_SAFE_INTEGER }),
    ],
  ])("rejects %s and caches nothing", async (_label, token) => {
    const { run } = fixture();
    const exchanges = stubFetch(token);
    await expect(run()).rejects.toThrow(
      "Google OAuth returned an invalid token response.",
    );
    await expect(run()).rejects.toThrow(
      "Google OAuth returned an invalid token response.",
    );
    expect(exchanges).toHaveLength(2);
  });

  it("accepts a token with a one second lifetime", async () => {
    const { run } = fixture();
    const exchanges = stubFetch(ok({ access_token: "tok-d", expires_in: 1 }));
    await run();
    await run();
    // 1s is inside the 30s refresh margin, so it is never reused.
    expect(exchanges).toHaveLength(2);
  });
});

describe("service-account credential lookup", () => {
  function lookupsFor(connectionId?: string) {
    const lookups: { provider: string; workspaceProvider?: string }[] = [];
    const runtime = createProviderApiRuntime({
      appId: "token-exchange-fixture",
      providerIds: ["bigquery"],
      getCredentialContext: () => ({
        userEmail: "member@example.test",
        orgId: "exchange-fixture-org",
        ...(connectionId ? { credentialScope: "org" as const } : {}),
      }),
      resolveCredential: async (lookup) => {
        lookups.push({
          provider: lookup.provider,
          workspaceProvider: lookup.workspaceProvider,
        });
        return {
          key: lookup.key,
          value: JSON.stringify({
            type: "service_account",
            client_email: `lookup-${(counter += 1)}@example.test`,
            private_key: PEM,
          }),
          source: connectionId ? "workspace_connection" : "app_local",
          provider: lookup.provider,
          ...(connectionId ? { connectionId } : {}),
        };
      },
    });
    return {
      lookups,
      run: () =>
        runtime.executeRequest({
          provider: "bigquery",
          method: "GET",
          path: "/projects/test-project/datasets",
          ...(connectionId ? { connectionId } : {}),
        }),
    };
  }

  it("keeps the gcloud credential order when no connection is selected", async () => {
    const { run, lookups } = lookupsFor();
    stubFetch(ok({ access_token: "tok-e", expires_in: 3600 }));
    await run();
    const keyLookups = lookups.filter((x) => x.provider === "gcloud");
    expect(keyLookups.length).toBeGreaterThan(0);
    expect(keyLookups.every((x) => x.workspaceProvider === undefined)).toBe(
      true,
    );
  });

  it("binds the lookup to the requesting provider once a connection is selected", async () => {
    const { run, lookups } = lookupsFor("selected-source");
    stubFetch(ok({ access_token: "tok-f", expires_in: 3600 }));
    await run();
    expect(
      lookups.some(
        (x) => x.provider === "bigquery" && x.workspaceProvider === "bigquery",
      ),
    ).toBe(true);
  });
});
