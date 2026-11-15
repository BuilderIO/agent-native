import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetProviderCallCensusForTests } from "./call-census.js";
import { createProviderApiRuntime } from "./index.js";
import { resetProviderQuotaStateForTests } from "./quota-governor.js";

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher: vi.fn(async () => ({ dispatch: vi.fn() })),
  isBlockedExtensionUrlWithDns: vi.fn(async () => false),
}));

function fixture() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const value = JSON.stringify({
    type: "service_account",
    client_email: "cancel-fixture@example.test",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  const runtime = createProviderApiRuntime({
    appId: "token-cancellation-fixture",
    providerIds: ["bigquery"],
    getCredentialContext: () => ({
      userEmail: "member@example.test",
      orgId: "cancellation-fixture-org",
      credentialScope: "org",
    }),
    resolveCredential: async (lookup) => ({
      key: lookup.key,
      value,
      source: "workspace_connection",
      provider: "bigquery",
      connectionId: "cancellation-fixture-source",
      scope: "org",
      scopeId: "cancellation-fixture-org",
    }),
  });
  return (signal?: AbortSignal, timeoutMs?: number) =>
    runtime.executeRequest({
      provider: "bigquery",
      connectionId: "cancellation-fixture-source",
      method: "GET",
      path: "/projects/test-project/datasets",
      signal,
      timeoutMs,
    });
}
function tokenResponse() {
  return new Response(
    JSON.stringify({ access_token: "fixture-access-value", expires_in: 3600 }),
  );
}
function providerResponse() {
  return new Response(JSON.stringify({ datasets: [] }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  resetProviderQuotaStateForTests();
  resetProviderCallCensusForTests();
});
afterEach(() => {
  resetProviderCallCensusForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("service-account authentication cancellation", () => {
  it("refuses an already cancelled request before token or provider HTTP", async () => {
    const run = fixture();
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/token") ? tokenResponse() : providerResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(run(AbortSignal.abort())).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cancels an in-flight token exchange once without dispatching the provider", async () => {
    const run = fixture();
    const controller = new AbortController();
    const started = deferred<AbortSignal | null | undefined>();
    const finish = deferred<Response>();
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        urls.push(String(url));
        if (!String(url).includes("/token"))
          return Promise.resolve(providerResponse());
        started.resolve(init?.signal);
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
          void finish.promise.then(resolve);
        });
      }),
    );
    const outcome = run(controller.signal).then(
      () => "fulfilled",
      () => "rejected",
    );
    const signal = await started.promise;
    controller.abort();
    finish.resolve(tokenResponse());
    expect(await outcome).toBe("rejected");
    expect(signal?.aborted).toBe(true);
    expect(urls).toEqual(["https://oauth2.googleapis.com/token"]);
  });
  it("does not publish a token cancelled during body consumption and a fresh request exchanges again", async () => {
    const run = fixture();
    const controller = new AbortController();
    let exchanges = 0;
    let providerCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (!String(url).includes("/token")) {
          providerCalls++;
          return providerResponse();
        }
        exchanges++;
        const response = tokenResponse();
        if (exchanges === 1)
          vi.spyOn(response, "json").mockImplementation(async () => {
            controller.abort();
            return {
              access_token: "cancelled-fixture-value",
              expires_in: 3600,
            };
          });
        return response;
      }),
    );
    await expect(run(controller.signal)).rejects.toThrow();
    expect(providerCalls).toBe(0);
    await expect(run()).resolves.toMatchObject({ response: { status: 200 } });
    expect(exchanges).toBe(2);
    expect(providerCalls).toBe(1);
  });
  it("bounds the token exchange by the request timeout and clears its timer", async () => {
    const run = fixture();
    vi.useFakeTimers();
    const started = deferred<AbortSignal | null | undefined>();
    const finish = deferred<Response>();
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        urls.push(String(url));
        if (!String(url).includes("/token"))
          return Promise.resolve(providerResponse());
        started.resolve(init?.signal);
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Timed out", "AbortError")),
            { once: true },
          );
          void finish.promise.then(resolve);
        });
      }),
    );
    const outcome = run(undefined, 1000).then(
      () => "fulfilled",
      () => "rejected",
    );
    const signal = await started.promise;
    await vi.advanceTimersByTimeAsync(1000);
    finish.resolve(tokenResponse());
    expect(await outcome).toBe("rejected");
    expect(signal?.aborted).toBe(true);
    expect(urls).toEqual(["https://oauth2.googleapis.com/token"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses a cancelled request even when its token is already cached", async () => {
    const run = fixture();
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/token") ? tokenResponse() : providerResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(run()).resolves.toMatchObject({ response: { status: 200 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(run(AbortSignal.abort())).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("clears the authentication timer after a successful exchange and cached use", async () => {
    const run = fixture();
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/token") ? tokenResponse() : providerResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(run(undefined, 1000)).resolves.toMatchObject({
      response: { status: 200 },
    });
    // The provider call starts the census flush interval; only auth timers are under test.
    resetProviderCallCensusForTests();
    expect(vi.getTimerCount()).toBe(0);
    await expect(run(undefined, 1000)).resolves.toMatchObject({
      response: { status: 200 },
    });
    resetProviderCallCensusForTests();
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not replay a failed authentication POST", async () => {
    const run = fixture();
    const fetchMock = vi.fn(
      async () => new Response("fixture-unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(run()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
