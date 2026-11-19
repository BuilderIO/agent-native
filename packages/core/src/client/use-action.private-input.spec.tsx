import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  type UseMutationResult,
} from "@tanstack/react-query";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRIVATE_ACTION_SCOPE_HEADER } from "../shared/private-action-scope.js";
import {
  currentPrivateActionScope,
  recordSessionIdentity,
} from "./session-identity.js";
import {
  useActionMutation,
  forgetUiActionCapability,
  type PrivateActionMutationOptions,
  type PrivateActionMutationResult,
} from "./use-action.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./analytics.js", () => ({
  trackEvent: vi.fn(),
  trackSessionStatus: vi.fn(),
}));
vi.mock("./recorder.js", () => ({
  recordActionStart: vi.fn(() => () => {}),
  startRecorder: vi.fn(),
}));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
import { trackEvent } from "./analytics.js";
import { recordActionStart } from "./recorder.js";

const ACTION = "do-private-thing";
const SECRET = "RAW-SECRET-6f1c0a3e-DO-NOT-LEAK";
type Variables = { secret: string };
const RAW_VARIABLES: Variables = { secret: SECRET };

/* -------------------------------------------------------------------------- */
/* fetch interception                                                          */
/* -------------------------------------------------------------------------- */

interface FetchCall {
  url: string;
  method: string;
  body: BodyInit | null | undefined;
  signal: AbortSignal | undefined;
  init: RequestInit | undefined;
}

type Route = (
  call: FetchCall,
) => Response | undefined | Promise<Response | undefined>;

let calls: FetchCall[] = [];
let routes: Route[] = [];

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === "string") return body;
  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    return body.toString();
  }
  return "";
}

function actionPosts(): FetchCall[] {
  return calls.filter(
    (call) => call.method === "POST" && bodyText(call.body).includes(SECRET),
  );
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installFetch(): void {
  calls = [];
  routes = [
    // Default capability/mint endpoint: anything that does not carry the
    // private payload resolves to an empty capability response.
    (call) =>
      bodyText(call.body).includes(SECRET) ? undefined : jsonResponse({}),
  ];

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      typeof Request !== "undefined" && input instanceof Request
        ? input
        : undefined;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (request as Request).url;
    const call: FetchCall = {
      url,
      method: String(init?.method ?? request?.method ?? "GET").toUpperCase(),
      body: init?.body ?? undefined,
      signal: init?.signal ?? request?.signal ?? undefined,
      init,
    };
    calls.push(call);
    for (const route of routes) {
      const response = await route(call);
      if (response) return response;
    }
    throw new Error(`Unrouted fetch: ${call.method} ${url}`);
  });

  vi.stubGlobal("fetch", impl);
}

function routeAction(d: Deferred<Response>, honorAbort = true): Route {
  return (call) => {
    if (!bodyText(call.body).includes(SECRET)) return undefined;
    const signal = call.signal;
    if (!honorAbort || !signal) return d.promise;
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      d.promise.then(
        (response) => {
          signal.removeEventListener("abort", onAbort);
          resolve(response);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  };
}

function routeDeferredMint(mint: Deferred<Response>): Route {
  return (call) =>
    bodyText(call.body).includes(SECRET) ? undefined : mint.promise;
}

/* -------------------------------------------------------------------------- */
/* leak inspection helpers                                                     */
/* -------------------------------------------------------------------------- */

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, item) => {
        if (item instanceof Error) return `${item.name}:${item.message}`;
        if (typeof item === "bigint") return item.toString();
        if (typeof item === "object" && item !== null) {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
        }
        return item;
      }) ?? ""
    );
  } catch {
    return String(value);
  }
}

function cacheSnapshot(client: QueryClient): unknown {
  return {
    queries: client
      .getQueryCache()
      .getAll()
      .map((query) => query.state),
    mutations: client
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state),
  };
}

function expectSanitized(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  const err = error as Error;
  expect(err.message).toBe("Private action failed.");
  expect(err.message).not.toContain(SECRET);
  expect(safeStringify(err)).not.toContain(SECRET);
}

/* -------------------------------------------------------------------------- */
/* react harness                                                               */
/* -------------------------------------------------------------------------- */

interface GlobalCallbacks {
  onMutate: ReturnType<typeof vi.fn>;
  onSuccess: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onSettled: ReturnType<typeof vi.fn>;
}

function createClient(): {
  queryClient: QueryClient;
  callbacks: GlobalCallbacks;
} {
  const callbacks: GlobalCallbacks = {
    onMutate: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onSettled: vi.fn(),
  };
  const queryClient = new QueryClient({
    mutationCache: new MutationCache(callbacks as never),
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return { queryClient, callbacks };
}

interface PrivateHarness {
  queryClient: QueryClient;
  callbacks: GlobalCallbacks;
  container: HTMLElement;
  root: Root;
  readonly result: PrivateActionMutationResult<Variables>;
  snapshots: unknown[];
  stopSnapshots: () => void;
  unmount: () => Promise<void>;
}

interface NormalHarness {
  queryClient: QueryClient;
  callbacks: GlobalCallbacks;
  container: HTMLElement;
  root: Root;
  readonly result: UseMutationResult<void, Error, Variables>;
  snapshots: unknown[];
  stopSnapshots: () => void;
  unmount: () => Promise<void>;
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPrivate(
  options: Partial<PrivateActionMutationOptions> = {},
): Promise<PrivateHarness> {
  const { queryClient, callbacks } = createClient();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let current!: PrivateActionMutationResult<Variables>;

  function Probe() {
    const privateOptions = {
      privateInputs: true,
      uiOnly: true,
      retry: false,
      retryUiCapability: false,
      ...options,
    } as PrivateActionMutationOptions;
    current = useActionMutation<void, Variables>(
      ACTION as never,
      privateOptions,
    );
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });

  const snapshots: unknown[] = [];
  const unsubQuery = queryClient
    .getQueryCache()
    .subscribe((event) => snapshots.push(event));
  const unsubMutation = queryClient
    .getMutationCache()
    .subscribe((event) => snapshots.push(event));

  return {
    queryClient,
    callbacks,
    container,
    root,
    get result() {
      return current;
    },
    snapshots,
    stopSnapshots() {
      unsubQuery();
      unsubMutation();
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function renderNormal(): Promise<NormalHarness> {
  const { queryClient, callbacks } = createClient();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let current!: UseMutationResult<void, Error, Variables>;

  function Probe() {
    current = useActionMutation<void, Variables>(ACTION as never, {});
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });

  const snapshots: unknown[] = [];
  const unsubQuery = queryClient
    .getQueryCache()
    .subscribe((event) => snapshots.push(event));
  const unsubMutation = queryClient
    .getMutationCache()
    .subscribe((event) => snapshots.push(event));

  return {
    queryClient,
    callbacks,
    container,
    root,
    get result() {
      return current;
    },
    snapshots,
    stopSnapshots() {
      unsubQuery();
      unsubMutation();
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function startPrivate(
  harness: PrivateHarness,
  params: Variables,
): Promise<{ promise: Promise<void> }> {
  let promise: Promise<void> = Promise.resolve();
  await act(async () => {
    promise = harness.result.mutateAsync(params);
    promise.catch(() => {});
  });
  await tick();
  return { promise };
}

/* -------------------------------------------------------------------------- */
/* tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("private ui action mutation", () => {
  beforeEach(() => {
    (
      window as unknown as { __AGENT_NATIVE_API_ENABLED__?: boolean }
    ).__AGENT_NATIVE_API_ENABLED__ = true;
    (
      globalThis as { __AGENT_NATIVE_API_ENABLED__?: boolean }
    ).__AGENT_NATIVE_API_ENABLED__ = true;
    forgetUiActionCapability();
    recordSessionIdentity("actor", "org-a", "auth-a", "actor@example.test");
    installFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("positive control: an ordinary mutation exposes raw variables while pending and the body once settled", async () => {
    const action = deferred<Response>();
    routes.unshift(routeAction(action));
    const harness = await renderNormal();

    let promise!: Promise<unknown>;
    await act(async () => {
      promise = harness.result.mutateAsync(RAW_VARIABLES);
      promise.catch(() => {});
    });
    await tick();

    const pending = harness.queryClient.getMutationCache().getAll();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.state.status).toBe("pending");
    expect(pending[0]!.state.variables).toEqual(RAW_VARIABLES);
    expect(safeStringify(pending[0]!.state.variables)).toContain(SECRET);

    await act(async () => {
      action.resolve(jsonResponse({ echoed: "ok" }));
    });
    await tick();
    await promise;

    const settled = harness.queryClient.getMutationCache().getAll()[0]!;
    expect(settled.state.status).toBe("success");
    expect(settled.state.variables).toEqual(RAW_VARIABLES);
    expect(settled.state.data).toEqual({ echoed: "ok" });

    harness.stopSnapshots();
    await harness.unmount();
  });

  it("keeps private inputs out of every cache, snapshot and returned value while pending and settled", async () => {
    const action = deferred<Response>();
    routes.unshift(routeAction(action));
    const harness = await renderPrivate();

    const { promise } = await startPrivate(harness, RAW_VARIABLES);

    // --- pending -------------------------------------------------------
    expect(harness.result.status).toBe("pending");
    expect(harness.result.isPending).toBe(true);
    expect(harness.result.data).toBeUndefined();
    expect(harness.result.variables).toBeUndefined();
    expect(actionPosts()).toHaveLength(1);
    expect(actionPosts()[0]?.body).toBe(JSON.stringify(RAW_VARIABLES));

    expect(harness.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(harness.queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(safeStringify(cacheSnapshot(harness.queryClient))).not.toContain(
      SECRET,
    );
    expect(safeStringify(harness.snapshots)).not.toContain(SECRET);
    expect(safeStringify(harness.result)).not.toContain(SECRET);

    expect(harness.callbacks.onMutate).not.toHaveBeenCalled();
    expect(harness.callbacks.onSuccess).not.toHaveBeenCalled();
    expect(harness.callbacks.onError).not.toHaveBeenCalled();
    expect(harness.callbacks.onSettled).not.toHaveBeenCalled();

    // --- settled -------------------------------------------------------
    await act(async () => {
      action.resolve(jsonResponse({ echoed: SECRET, secret: SECRET }));
    });
    await tick();

    const settledValue = await promise;
    expect(settledValue).toBeUndefined();

    expect(harness.result.status).toBe("success");
    expect(harness.result.isSuccess).toBe(true);
    expect(harness.result.data).toBeUndefined();
    expect(harness.result.variables).toBeUndefined();

    expect(harness.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(harness.queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(safeStringify(cacheSnapshot(harness.queryClient))).not.toContain(
      SECRET,
    );
    expect(safeStringify(harness.snapshots)).not.toContain(SECRET);
    expect(safeStringify(harness.result)).not.toContain(SECRET);

    expect(harness.callbacks.onMutate).not.toHaveBeenCalled();
    expect(harness.callbacks.onSuccess).not.toHaveBeenCalled();
    expect(harness.callbacks.onError).not.toHaveBeenCalled();
    expect(harness.callbacks.onSettled).not.toHaveBeenCalled();

    harness.stopSnapshots();
    await harness.unmount();
  });

  it("blocks the action POST and resets to idle when the org changes during a deferred capability mint", async () => {
    const mint = deferred<Response>();
    routes.unshift(routeDeferredMint(mint));
    const harness = await renderPrivate();

    const { promise } = await startPrivate(harness, RAW_VARIABLES);

    expect(harness.result.isPending).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(actionPosts()).toHaveLength(0);

    await act(async () => {
      recordSessionIdentity("actor", "org-b");
    });
    await tick();

    expect(harness.result.status).toBe("idle");
    expect(harness.result.isIdle).toBe(true);

    await act(async () => {
      mint.resolve(jsonResponse({}));
    });
    await tick();
    await promise.catch(() => {});

    expect(actionPosts()).toHaveLength(0);
    expect(harness.result.isIdle).toBe(true);
    expect(safeStringify(harness.snapshots)).not.toContain(SECRET);

    harness.stopSnapshots();
    await harness.unmount();
  });

  it("aborts an in-flight action when actor/org changes and suppresses a late success", async () => {
    const onSuccess = vi.fn();
    const action = deferred<Response>();
    routes.unshift(routeAction(action, true));
    const harness = await renderPrivate({ onSuccess });

    const { promise } = await startPrivate(harness, RAW_VARIABLES);

    expect(harness.result.isPending).toBe(true);
    expect(actionPosts()).toHaveLength(1);

    await act(async () => {
      recordSessionIdentity("someone-else", "org-b");
    });
    await tick();

    expect(harness.result.isIdle).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      action.resolve(jsonResponse({ echoed: "late" }));
    });
    await tick();
    await promise.catch(() => {});

    expect(harness.result.isSuccess).toBe(false);
    expect(harness.result.isIdle).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(safeStringify(harness.snapshots)).not.toContain(SECRET);

    harness.stopSnapshots();
    await harness.unmount();
  });

  it("suppresses a late action success after reset()", async () => {
    const onSuccess = vi.fn();
    const action = deferred<Response>();
    routes.unshift(routeAction(action, false));
    const harness = await renderPrivate({ onSuccess });

    const { promise } = await startPrivate(harness, RAW_VARIABLES);
    expect(harness.result.isPending).toBe(true);

    await act(async () => {
      harness.result.reset();
    });
    await tick();
    expect(harness.result.isIdle).toBe(true);

    await act(async () => {
      action.resolve(jsonResponse({ echoed: "late" }));
    });
    await tick();
    await promise.catch(() => {});

    expect(harness.result.isSuccess).toBe(false);
    expect(harness.result.isIdle).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();

    harness.stopSnapshots();
    await harness.unmount();
  });

  it("suppresses a late action success after unmount", async () => {
    const onSuccess = vi.fn();
    const action = deferred<Response>();
    routes.unshift(routeAction(action, false));
    const harness = await renderPrivate({ onSuccess });

    const { promise } = await startPrivate(harness, RAW_VARIABLES);
    await harness.unmount();

    await act(async () => {
      action.resolve(jsonResponse({ echoed: "late" }));
    });
    await tick();
    await promise.catch(() => {});

    expect(onSuccess).not.toHaveBeenCalled();

    harness.stopSnapshots();
  });

  it("does not resend after a ui_capability_required refusal and sanitizes the refusal details", async () => {
    const onError = vi.fn();
    routes.unshift((call) =>
      bodyText(call.body).includes(SECRET)
        ? jsonResponse(
            {
              errorCode: "ui_capability_required",
              message: `refused with ${SECRET}`,
              details: { secret: SECRET },
            },
            403,
          )
        : undefined,
    );
    const harness = await renderPrivate({ onError });

    let error: unknown;
    await act(async () => {
      await harness.result.mutateAsync(RAW_VARIABLES).catch((thrown) => {
        error = thrown;
      });
    });
    await tick();

    expect(actionPosts()).toHaveLength(1);
    expectSanitized(error);
    expect(safeStringify(error)).not.toContain(SECRET);

    expect(harness.result.status).toBe("error");
    expect(harness.result.isError).toBe(true);
    expect(harness.result.data).toBeUndefined();
    expect(harness.result.variables).toBeUndefined();
    expect(safeStringify(harness.result.error)).not.toContain(SECRET);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(safeStringify(onError.mock.calls)).not.toContain(SECRET);
    expect(safeStringify(harness.snapshots)).not.toContain(SECRET);

    harness.stopSnapshots();
    await harness.unmount();
  });

  it("sanitizes a network rejection that contains secret material", async () => {
    const onError = vi.fn();
    routes.unshift((call) => {
      if (!bodyText(call.body).includes(SECRET)) return undefined;
      return Promise.reject(new Error(`network exploded with ${SECRET}`));
    });
    const harness = await renderPrivate({ onError });

    let error: unknown;
    await act(async () => {
      await harness.result.mutateAsync(RAW_VARIABLES).catch((thrown) => {
        error = thrown;
      });
    });
    await tick();

    expectSanitized(error);
    expect(safeStringify(error)).not.toContain(SECRET);
    expect(harness.result.isError).toBe(true);
    expect(safeStringify(harness.result.error)).not.toContain(SECRET);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(safeStringify(onError.mock.calls)).not.toContain(SECRET);

    harness.stopSnapshots();
    await harness.unmount();
  });

  it.each([
    ["actor", "org-b", undefined],
    ["other-actor", "org-a", undefined],
    ["actor", "org-a", "authenticated-actor"],
    [null, undefined, undefined],
  ] as const)(
    "fences a pending response after scope transition %j",
    async (identity, org, actor) => {
      const onSuccess = vi.fn();
      const action = deferred<Response>();
      routes.unshift(routeAction(action, false));
      const harness = await renderPrivate({ onSuccess });
      const { promise } = await startPrivate(harness, RAW_VARIABLES);
      await act(async () => {
        recordSessionIdentity(identity, org, actor);
        // ABA must not restore permission for the earlier invocation.
        recordSessionIdentity("actor", "org-a", "auth-a", "actor@example.test");
        action.resolve(jsonResponse({ echoed: SECRET }));
        await promise.catch(() => {});
      });
      expect(harness.result.isIdle).toBe(true);
      expect(actionPosts()[0]!.signal?.aborted).toBe(true);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(harness.queryClient.getMutationCache().getAll()).toHaveLength(0);
      harness.stopSnapshots();
      await harness.unmount();
    },
  );

  it("clears the transport body after handoff and avoids telemetry, headers, URLs and storage", async () => {
    const action = deferred<Response>();
    routes.unshift(routeAction(action, false));
    if (!window.localStorage)
      Object.defineProperty(window, "localStorage", {
        value: new Storage(),
        configurable: true,
      });
    if (!window.sessionStorage)
      Object.defineProperty(window, "sessionStorage", {
        value: new Storage(),
        configurable: true,
      });
    const localWrite = vi.spyOn(window.localStorage, "setItem");
    const sessionWrite = vi.spyOn(window.sessionStorage, "setItem");
    const harness = await renderPrivate();
    const { promise } = await startPrivate(harness, RAW_VARIABLES);
    const post = actionPosts()[0]!;
    expect(post.body).toBe(JSON.stringify(RAW_VARIABLES));
    expect(post.init?.body).toBeUndefined();
    expect(post.url).not.toContain(SECRET);
    expect(safeStringify(post.init?.headers)).not.toContain(SECRET);
    expect(recordActionStart).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
    expect(safeStringify(localWrite.mock.calls)).not.toContain(SECRET);
    expect(safeStringify(sessionWrite.mock.calls)).not.toContain(SECRET);
    await act(async () => {
      harness.result.reset();
      action.resolve(jsonResponse({}));
      await promise.catch(() => {});
    });
    expect(post.signal?.aborted).toBe(true);
    expect(post.init?.body).toBeUndefined();
    localWrite.mockRestore();
    sessionWrite.mockRestore();
    harness.stopSnapshots();
    await harness.unmount();
  });

  it("keeps sanitized errors immutable across callback mutation attempts", async () => {
    routes.unshift((call) =>
      bodyText(call.body).includes(SECRET)
        ? jsonResponse({ error: SECRET }, 403)
        : undefined,
    );
    const observed: boolean[] = [];
    const onError = vi.fn((error: Error) => {
      observed.push(Object.isFrozen(error));
      observed.push(Reflect.set(error, "message", SECRET));
      observed.push(Reflect.set(error, "details", { secret: SECRET }));
    });
    const harness = await renderPrivate({ onError });
    let failure: unknown;
    await act(async () => {
      await harness.result.mutateAsync(RAW_VARIABLES).catch((error) => {
        failure = error;
      });
    });
    expectSanitized(failure);
    expectSanitized(harness.result.error);
    expect(observed).toEqual([true, false, false]);
    expect(onError).toHaveBeenCalledTimes(1);
    harness.stopSnapshots();
    await harness.unmount();
  });

  it("does not read or expose a private response body", async () => {
    const text = vi.fn(() => Promise.reject(new Error(SECRET)));
    const response = jsonResponse({ echoed: SECRET });
    Object.defineProperty(response, "text", { value: text });
    routes.unshift((call) =>
      bodyText(call.body).includes(SECRET) ? response : undefined,
    );
    const harness = await renderPrivate();
    await act(async () => {
      await harness.result.mutateAsync(RAW_VARIABLES);
    });
    expect(text).not.toHaveBeenCalled();
    expect(harness.result.isSuccess).toBe(true);
    harness.stopSnapshots();
    await harness.unmount();
  });

  it("fences success callbacks if a synchronous sync subscriber changes scope", async () => {
    const onSuccess = vi.fn();
    const listener = () => recordSessionIdentity("other-actor", "org-b");
    window.addEventListener("agentNative:syncActivity", listener);
    routes.unshift((call) =>
      bodyText(call.body).includes(SECRET) ? jsonResponse({}) : undefined,
    );
    const harness = await renderPrivate({ onSuccess });
    try {
      await act(async () => {
        await harness.result.mutateAsync(RAW_VARIABLES).catch(() => {});
      });
      expect(onSuccess).not.toHaveBeenCalled();
      expect(harness.result.isIdle).toBe(true);
    } finally {
      window.removeEventListener("agentNative:syncActivity", listener);
      harness.stopSnapshots();
      await harness.unmount();
    }
  });

  it("sanitizes synchronous serialization failure and callback errors", async () => {
    const onError = vi.fn(() => {
      throw new Error(SECRET);
    });
    const harness = await renderPrivate({ onError });
    const params = {
      secret: SECRET,
      toJSON: () => {
        throw new Error(SECRET);
      },
    };
    let failure: unknown;
    await act(async () => {
      await harness.result.mutateAsync(params).catch((error) => {
        failure = error;
      });
    });
    expectSanitized(failure);
    expect(calls).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(harness.result.isError).toBe(true);
    harness.stopSnapshots();
    await harness.unmount();
  });

  it.each([401, 403, 409, 429, 503])(
    "never resends or trusts response details after HTTP %s",
    async (status) => {
      routes.unshift((call) =>
        bodyText(call.body).includes(SECRET)
          ? jsonResponse({ error: SECRET }, status, {
              "X-Agent-Native-Client-Mismatch": "1",
              "X-Agent-Native-Build-Id": SECRET,
              "X-Agent-Native-Client-Compatibility": SECRET,
            })
          : undefined,
      );
      const harness = await renderPrivate();
      let failure: unknown;
      await act(async () => {
        await harness.result.mutateAsync(RAW_VARIABLES).catch((error) => {
          failure = error;
        });
      });
      expectSanitized(failure);
      expect(actionPosts()).toHaveLength(1);
      expect(harness.result.isError).toBe(true);
      expect(trackEvent).not.toHaveBeenCalled();
      expect(harness.queryClient.getMutationCache().getAll()).toHaveLength(0);
      harness.stopSnapshots();
      await harness.unmount();
    },
  );

  it.each([{ uiOnly: false }, { retry: true }, { retryUiCapability: true }])(
    "fails closed for unsafe private flags %j",
    async (unsafe) => {
      const harness = await renderPrivate(
        unsafe as Partial<PrivateActionMutationOptions>,
      );
      let failure: unknown;
      await act(async () => {
        await harness.result.mutateAsync(RAW_VARIABLES).catch((error) => {
          failure = error;
        });
      });
      expectSanitized(failure);
      expect(calls).toHaveLength(0);
      expect(harness.queryClient.getMutationCache().getAll()).toHaveLength(0);
      harness.stopSnapshots();
      await harness.unmount();
    },
  );

  it.each([
    [undefined, "auth-a", "actor@example.test"],
    ["org-a", undefined, "actor@example.test"],
    ["org-a", "auth-a", undefined],
    ["", "auth-a", "actor@example.test"],
    ["org-a", " ", "actor@example.test"],
    ["org-a", "auth-a", " "],
  ] as const)(
    "rejects unknown private session scope before serialization or network",
    async (org, actor, email) => {
      recordSessionIdentity("actor", org, actor, email);
      const toJSON = vi.fn(() => RAW_VARIABLES);
      const params = { ...RAW_VARIABLES, toJSON };
      const harness = await renderPrivate();
      let failure: unknown;
      await act(async () => {
        await harness.result.mutateAsync(params).catch((error) => {
          failure = error;
        });
      });
      expectSanitized(failure);
      expect(currentPrivateActionScope()).toBeUndefined();
      expect(toJSON).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
      expect(harness.queryClient.getMutationCache().getAll()).toHaveLength(0);
      // The same mounted instance succeeds once all scope fields are known.
      routes.unshift((call) =>
        bodyText(call.body).includes(SECRET) ? jsonResponse({}) : undefined,
      );
      await act(async () => {
        recordSessionIdentity("actor", "org-a", "auth-a", "actor@example.test");
      });
      await act(async () => {
        await harness.result.mutateAsync(params);
      });
      expect(toJSON).toHaveBeenCalledTimes(1);
      expect(actionPosts()).toHaveLength(1);
      expect(harness.result.isSuccess).toBe(true);
      expect(harness.queryClient.getMutationCache().getAll()).toHaveLength(0);
      harness.stopSnapshots();
      await harness.unmount();
    },
  );

  it.each(["org-a", null])(
    "uses only normalized known session fields in fixed scope header %j",
    async (org) => {
      recordSessionIdentity("actor", org, " auth-a ", " Actor@Example.Test ");
      const action = deferred<Response>();
      routes.unshift(routeAction(action));
      const harness = await renderPrivate();
      const { promise } = await startPrivate(harness, {
        ...RAW_VARIABLES,
        email: SECRET,
        orgId: SECRET,
        authUserId: SECRET,
      } as Variables);
      const post = actionPosts()[0]!;
      const headers = new Headers(post.init?.headers);
      const encoded = headers.get(PRIVATE_ACTION_SCOPE_HEADER);
      expect(encoded).not.toBeNull();
      expect(JSON.parse(encoded!)).toEqual({
        email: "actor@example.test",
        orgId: org,
        authUserId: "auth-a",
      });
      expect(encoded).not.toContain(SECRET);
      expect(
        [...headers.keys()].filter(
          (name) =>
            name.toLowerCase() === PRIVATE_ACTION_SCOPE_HEADER.toLowerCase(),
        ),
      ).toHaveLength(1);
      expect(harness.queryClient.getMutationCache().getAll()).toHaveLength(0);
      await act(async () => {
        action.resolve(jsonResponse({}));
        await promise;
      });
      harness.stopSnapshots();
      await harness.unmount();
    },
  );

  it("roundtrips Unicode scope fields through an ASCII-only fixed header", async () => {
    recordSessionIdentity(
      "actor",
      "組織",
      "認証-actor",
      " User-試験@Example.Test ",
    );
    const action = deferred<Response>();
    routes.unshift(routeAction(action));
    const harness = await renderPrivate();
    const { promise } = await startPrivate(harness, RAW_VARIABLES);
    const encoded = new Headers(actionPosts()[0]!.init?.headers).get(
      PRIVATE_ACTION_SCOPE_HEADER,
    )!;
    expect(
      [...encoded].every((character) => character.charCodeAt(0) < 128),
    ).toBe(true);
    expect(JSON.parse(encoded)).toEqual({
      email: "user-試験@example.test",
      orgId: "組織",
      authUserId: "認証-actor",
    });
    await act(async () => {
      action.resolve(jsonResponse({}));
      await promise;
    });
    expect(harness.result.isSuccess).toBe(true);
    harness.stopSnapshots();
    await harness.unmount();
  });

  it("rejects an oversized private payload before any action POST", async () => {
    const huge = `${SECRET}${"x".repeat(129 * 1024)}`;
    const harness = await renderPrivate();

    let error: unknown;
    await act(async () => {
      await harness.result.mutateAsync({ secret: huge }).catch((thrown) => {
        error = thrown;
      });
    });
    await tick();

    expect(actionPosts()).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expectSanitized(error);
    expect(harness.result.isError).toBe(true);
    expect(safeStringify(harness.snapshots)).not.toContain(SECRET);

    harness.stopSnapshots();
    await harness.unmount();
  });

  it("rejects a concurrent private write without issuing a second action POST", async () => {
    const action = deferred<Response>();
    routes.unshift(routeAction(action));
    const harness = await renderPrivate();

    const { promise: first } = await startPrivate(harness, RAW_VARIABLES);
    expect(actionPosts()).toHaveLength(1);

    let secondError: unknown;
    await act(async () => {
      await harness.result.mutateAsync(RAW_VARIABLES).catch((thrown) => {
        secondError = thrown;
      });
    });
    await tick();

    expect(actionPosts()).toHaveLength(1);
    expectSanitized(secondError);
    expect(harness.result.isPending).toBe(true);

    await act(async () => {
      action.resolve(jsonResponse({}));
    });
    await tick();
    await first;

    expect(harness.result.isSuccess).toBe(true);
    expect(harness.result.data).toBeUndefined();
    expect(harness.result.variables).toBeUndefined();

    harness.stopSnapshots();
    await harness.unmount();
  });

  it("awaits an async onSuccess and never passes raw inputs to callbacks", async () => {
    const gate = deferred<void>();
    const seenArgs: unknown[][] = [];
    const onSuccess = vi.fn((...args: unknown[]) => {
      seenArgs.push(args);
      return gate.promise;
    });
    const action = deferred<Response>();
    routes.unshift(routeAction(action));
    const harness = await renderPrivate({ onSuccess });

    const { promise } = await startPrivate(harness, RAW_VARIABLES);

    await act(async () => {
      action.resolve(jsonResponse({ echoed: "ok" }));
    });
    await tick();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(seenArgs[0]).toEqual([]);
    expect(safeStringify(seenArgs)).not.toContain(SECRET);

    // The response settled but the async callback is still gated.
    expect(harness.result.isPending).toBe(true);
    expect(harness.result.isSuccess).toBe(false);
    expect(harness.result.data).toBeUndefined();
    expect(harness.result.variables).toBeUndefined();

    await act(async () => {
      gate.resolve();
    });
    await tick();
    await promise;

    expect(harness.result.isSuccess).toBe(true);
    expect(safeStringify(harness.snapshots)).not.toContain(SECRET);

    harness.stopSnapshots();
    await harness.unmount();
  });

  it("sanitizes errors thrown from mutation callbacks", async () => {
    const onError = vi.fn();
    const onSuccess = vi.fn(() => {
      throw new Error(`callback leaked ${SECRET}`);
    });
    const action = deferred<Response>();
    routes.unshift(routeAction(action));
    const harness = await renderPrivate({ onSuccess, onError });

    let error: unknown;
    await act(async () => {
      const completion = harness.result
        .mutateAsync(RAW_VARIABLES)
        .catch((thrown) => {
          error = thrown;
        });
      action.resolve(jsonResponse({}));
      await completion;
    });
    await tick();

    expectSanitized(error);
    expect(safeStringify(error)).not.toContain(SECRET);
    expect(harness.result.isError).toBe(true);
    expect(safeStringify(harness.result.error)).not.toContain(SECRET);
    expect(harness.result.data).toBeUndefined();
    expect(harness.result.variables).toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(safeStringify(onError.mock.calls)).not.toContain(SECRET);
    expect(actionPosts()).toHaveLength(1);
    expect(safeStringify(harness.snapshots)).not.toContain(SECRET);

    harness.stopSnapshots();
    await harness.unmount();
  });
});
