// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
import { recordSessionIdentity } from "./session-identity.js";
import { callAction, forgetUiActionCapability } from "./use-action.js";

const MINT = "/_agent-native/ui-capability";
const ACTION = "/_agent-native/actions/read-private-record";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  recordSessionIdentity(undefined);
  forgetUiActionCapability();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("waits for the mint started before the session published, then mints for its own identity", async () => {
  forgetUiActionCapability();
  recordSessionIdentity(undefined);
  let releaseFirstMint!: () => void;
  const firstMint = new Promise<void>((r) => (releaseFirstMint = r));
  let mints = 0;
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    if (url === MINT) {
      mints += 1;
      if (mints === 1) await firstMint;
      return json({ ok: true });
    }
    return json({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);

  const early = callAction("read-private-record", undefined, {
    method: "GET",
    uiOnly: true,
  });
  early.catch(() => undefined);
  await vi.waitFor(() => expect(mints).toBe(1));

  recordSessionIdentity("synthetic-user-a");
  const late = callAction("read-private-record", undefined, {
    method: "GET",
    uiOnly: true,
  });
  await Promise.resolve();
  expect(calls.filter((url) => url === ACTION)).toEqual([]);

  releaseFirstMint();
  await expect(late).resolves.toEqual({ ok: true });

  expect(mints).toBe(2);
  const lastMint = calls.lastIndexOf(MINT);
  const lateAction = calls.lastIndexOf(ACTION);
  expect(lateAction).toBeGreaterThan(lastMint);
});

function stubMint() {
  let releaseFirstMint!: () => void;
  const firstMint = new Promise<void>((r) => (releaseFirstMint = r));
  let mints = 0;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === MINT) {
        mints += 1;
        if (mints === 1) await firstMint;
      }
      return json({ ok: true });
    }),
  );
  return { calls, releaseFirstMint, mints: () => mints };
}

it("fails a waiting call whose session scope changed instead of sending under the new scope", async () => {
  forgetUiActionCapability();
  recordSessionIdentity(undefined);
  const mint = stubMint();
  callAction("read-private-record", undefined, {
    method: "GET",
    uiOnly: true,
  }).catch(() => undefined);
  await vi.waitFor(() => expect(mint.mints()).toBe(1));

  recordSessionIdentity(
    "synthetic-user-a",
    "org-1",
    "actor-a",
    "a@example.test",
  );
  const late = callAction("read-private-record", undefined, {
    method: "GET",
    uiOnly: true,
  });
  const outcome = late.then(
    () => "sent",
    () => "rejected",
  );
  await Promise.resolve();
  recordSessionIdentity(
    "synthetic-user-a",
    "org-2",
    "actor-a",
    "a@example.test",
  );

  mint.releaseFirstMint();
  expect(await outcome).toBe("rejected");
  expect(mint.calls.filter((url) => url === ACTION)).toEqual([]);
});

it("removes a waiter's abort listener as soon as it aborts", async () => {
  forgetUiActionCapability();
  recordSessionIdentity(undefined);
  const mint = stubMint();
  callAction("read-private-record", undefined, {
    method: "GET",
    uiOnly: true,
  }).catch(() => undefined);
  await vi.waitFor(() => expect(mint.mints()).toBe(1));

  recordSessionIdentity("synthetic-user-a");
  const controller = new AbortController();
  const added: unknown[] = [];
  const removed: unknown[] = [];
  const add = AbortSignal.prototype.addEventListener;
  const remove = AbortSignal.prototype.removeEventListener;
  vi.spyOn(AbortSignal.prototype, "addEventListener").mockImplementation(
    function (this: AbortSignal, type: string, listener: never, opts?: never) {
      if (type === "abort") added.push(listener);
      return add.call(this, type, listener, undefined);
    } as never,
  );
  vi.spyOn(AbortSignal.prototype, "removeEventListener").mockImplementation(
    function (this: AbortSignal, type: string, listener: never, opts?: never) {
      if (type === "abort") removed.push(listener);
      return remove.call(this, type, listener, opts);
    } as never,
  );
  const late = callAction("read-private-record", undefined, {
    method: "GET",
    uiOnly: true,
    signal: controller.signal,
  });
  const outcome = late.then(
    () => "sent",
    () => "rejected",
  );
  await Promise.resolve();
  controller.abort();
  expect(await outcome).toBe("rejected");

  expect(added.length).toBeGreaterThan(0);
  for (const listener of added) expect(removed).toContain(listener);
  mint.releaseFirstMint();
});
