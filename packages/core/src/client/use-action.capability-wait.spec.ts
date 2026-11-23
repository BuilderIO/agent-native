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
  vi.restoreAllMocks();
  vi.clearAllMocks();
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

function chainMessages(error: unknown): string {
  const messages: string[] = [];
  for (let e = error; e instanceof Error; e = e.cause) messages.push(e.message);
  return messages.join(" | ");
}

async function startWaiter(signal?: AbortSignal) {
  forgetUiActionCapability();
  recordSessionIdentity(undefined);
  const mint = stubMint();
  callAction("read-private-record", undefined, {
    method: "GET",
    uiOnly: true,
  }).catch(() => undefined);
  await vi.waitFor(() => expect(mint.mints()).toBe(1));
  recordSessionIdentity("synthetic-user-a", "org-1", "actor-a", "a@x.test");
  const call = callAction("read-private-record", undefined, {
    method: "GET",
    uiOnly: true,
    signal,
  });
  const outcome = call.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await Promise.resolve();
  return { mint, outcome };
}

function spyAbortListeners() {
  const added: { listener: unknown; once: unknown }[] = [];
  const removed: unknown[] = [];
  const add = AbortSignal.prototype.addEventListener;
  const remove = AbortSignal.prototype.removeEventListener;
  vi.spyOn(AbortSignal.prototype, "addEventListener").mockImplementation(
    function (
      this: AbortSignal,
      type: string,
      listener: never,
      opts?: AddEventListenerOptions,
    ) {
      if (type === "abort") added.push({ listener, once: opts?.once });
      return add.call(this, type, listener, opts);
    } as never,
  );
  vi.spyOn(AbortSignal.prototype, "removeEventListener").mockImplementation(
    function (
      this: AbortSignal,
      type: string,
      listener: never,
      opts?: AddEventListenerOptions,
    ) {
      if (type === "abort") removed.push(listener);
      return remove.call(this, type, listener, opts);
    } as never,
  );
  return { added, removed };
}

it("rejects a waiting call with the abort reason and never sends", async () => {
  const controller = new AbortController();
  const { mint, outcome } = await startWaiter(controller.signal);
  controller.abort();
  const result = (await outcome) as { error: unknown };
  expect(result.error).toBeInstanceOf(DOMException);
  expect((result.error as DOMException).name).toBe("AbortError");
  mint.releaseFirstMint();
  expect(mint.calls.filter((url) => url === ACTION)).toEqual([]);
});

it("rejects immediately with the reason when the signal was already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const { mint, outcome } = await startWaiter(controller.signal);
  const result = (await outcome) as { error: unknown };
  expect(result.error).toBeInstanceOf(DOMException);
  expect((result.error as DOMException).name).toBe("AbortError");
  expect(mint.calls.filter((url) => url === ACTION)).toEqual([]);
  mint.releaseFirstMint();
});

it("removes the waiter's abort listener once the mint settles without an abort", async () => {
  const controller = new AbortController();
  const spy = spyAbortListeners();
  const { mint, outcome } = await startWaiter(controller.signal);
  const once = spy.added.filter((entry) => entry.once === true);
  expect(once.length).toBeGreaterThan(0);
  mint.releaseFirstMint();
  expect(await outcome).toEqual({ value: { ok: true } });
  for (const entry of spy.added) expect(spy.removed).toContain(entry.listener);
});

it("rejects a scope-changed waiter with the identity error and sends nothing", async () => {
  const { mint, outcome } = await startWaiter();
  recordSessionIdentity("synthetic-user-a", "org-2", "actor-a", "a@x.test");
  mint.releaseFirstMint();
  const result = (await outcome) as { error: Error };
  expect(result.error).toBeInstanceOf(Error);
  const names: string[] = [];
  for (let e: unknown = result.error; e instanceof Error; e = e.cause)
    names.push(e.name);
  expect(names).toContain("UiCapabilityIdentityError");
  const chain = chainMessages(result.error);
  expect(chain).toContain(
    "The signed-in session changed while waiting for the UI capability.",
  );
  expect(chain).not.toContain("before this action was sent");
  expect(mint.calls.filter((url) => url === ACTION)).toEqual([]);
});

it("lets a waiter proceed when its session did not change", async () => {
  const { mint, outcome } = await startWaiter();
  mint.releaseFirstMint();
  expect(await outcome).toEqual({ value: { ok: true } });
  expect(mint.calls.filter((url) => url === ACTION)).toHaveLength(1);
});

async function startOwnMint() {
  forgetUiActionCapability();
  recordSessionIdentity("synthetic-user-a", "org-1", "actor-a", "a@x.test");
  const mint = stubMint();
  const call = callAction("read-private-record", undefined, {
    method: "GET",
    uiOnly: true,
  });
  const outcome = call.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.waitFor(() => expect(mint.mints()).toBe(1));
  return { mint, outcome };
}

it.each([
  ["only the organization changes", ["synthetic-user-a", "org-2"]],
  [
    "only the authenticated actor changes",
    ["synthetic-user-a", "org-1", "actor-b"],
  ],
  [
    "only the email changes",
    ["synthetic-user-a", "org-1", "actor-a", "b@x.test"],
  ],
  [
    "the user and the organization both change",
    ["synthetic-user-b", "org-2", "actor-a", "a@x.test"],
  ],
  ["the user changes", ["synthetic-user-b", "org-1", "actor-a", "a@x.test"]],
] as const)(
  "never sends an action when %s while its own mint is pending",
  async (_name, next) => {
    const { mint, outcome } = await startOwnMint();
    const args = [next[0], next[1], next[2], next[3]] as const;
    recordSessionIdentity(
      args[0],
      args[1],
      args[2] ?? "actor-a",
      args[3] ?? "a@x.test",
    );
    mint.releaseFirstMint();
    const result = (await outcome) as { error?: Error };
    expect(result.error).toBeInstanceOf(Error);
    expect(chainMessages(result.error)).toContain(
      "The signed-in user changed before this action was sent.",
    );
    expect(mint.calls.filter((url) => url === ACTION)).toEqual([]);
  },
);

it("sends the action when the session is unchanged across its own mint", async () => {
  const { mint, outcome } = await startOwnMint();
  mint.releaseFirstMint();
  expect(await outcome).toEqual({ value: { ok: true } });
  expect(mint.calls.filter((url) => url === ACTION)).toHaveLength(1);
});
