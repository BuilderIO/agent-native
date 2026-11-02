import { EventEmitter } from "node:events";
import { compileFunction, createContext } from "node:vm";

import type { BrowserContext, Page } from "@playwright/test";
import { expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubEnv("CONTENT_LIVE_BODY_GATE", "on"));

vi.mock("@playwright/test", async () => {
  const vitest = await import("vitest");
  const poll =
    (read: () => unknown, options?: { message?: string }) =>
    (check: (actual: unknown, message?: string) => void) =>
      vitest.vi.waitFor(async () => check(await read(), options?.message), {
        timeout: 1000,
        interval: 1,
      });
  return {
    expect: Object.assign(
      (actual: unknown, message?: string) => {
        if (actual && typeof actual === "object" && "getAttribute" in actual) {
          const locator = actual as { getAttribute: (name: string) => string };
          return {
            toHaveAttribute: async (name: string, value: string) =>
              vitest.expect(locator.getAttribute(name), message).toBe(value),
          };
        }
        return vitest.expect(actual, message);
      },
      {
        poll: (read: () => unknown, options?: { message?: string }) => {
          const until = poll(read, options);
          return {
            toEqual: (value: unknown) =>
              until((actual, message) =>
                vitest.expect(actual, message).toEqual(value),
              ),
            toBeGreaterThanOrEqual: (value: number) =>
              until((actual, message) =>
                vitest.expect(actual, message).toBeGreaterThanOrEqual(value),
              ),
          };
        },
      },
    ),
  };
});

import { failNextOutboxWrite, outboxEntries, TabSet } from "./e2e/helpers";

// The keys the collab client stores unsent updates under: today's client
// writes v2, and an entry an older client left under v1 is still restored.
const DOC_ID = "outbox-fixture";
const KEY_TAIL = `${encodeURIComponent(`http://fixture.invalid\0${DOC_ID}`)}:${encodeURIComponent("ada@example.com")}:connection-1`;
const V1_KEY = `agent-native-collab-outbox-v1:${KEY_TAIL}`;
const V2_KEY = `agent-native-collab-outbox-v2:${KEY_TAIL}`;
const V2_RECORD = JSON.stringify({
  version: 2,
  updates: [{ update: "AAA=", requireLiveCopyOutcome: false }],
});
const QUIET_FAILURE =
  "a client, outbox or save answer is still pending after the scenario ended";

function fixtureStorage() {
  return class FixtureStorage {
    readonly #items = new Map<string, string>();
    get length() {
      return this.#items.size;
    }
    key(index: number): string | null {
      return [...this.#items.keys()][index] ?? null;
    }
    getItem(key: string): string | null {
      return this.#items.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
      this.#items.set(key, String(value));
    }
    removeItem(key: string): void {
      this.#items.delete(key);
    }
  };
}

class FixturePage extends EventEmitter {
  readonly Storage = fixtureStorage();
  readonly localStorage = new this.Storage();
  readonly client = createContext({
    __pendingSaves: 0,
    DOMException,
    Storage: this.Storage,
    localStorage: this.localStorage,
  });
  constructor() {
    super();
    this.client.window = this.client;
  }
  goto = vi.fn(async () => {});
  isClosed = () => false;
  locator = () => ({ getAttribute: () => "true" });
  evaluate = vi.fn(
    async (read: (argument: unknown) => unknown, argument?: unknown) =>
      compileFunction(`return (${read.toString()})(argument);`, ["argument"], {
        parsingContext: this.client,
      })(argument),
  );
}

class FixtureContext extends EventEmitter {
  addInitScript = async () => {};
  exposeBinding = async () => {};
  route = async () => {};
  newCDPSession = async () =>
    Object.assign(new EventEmitter(), { send: vi.fn(async () => {}) });
}

/** One open tab whose first collab update the server has answered. */
async function fixture() {
  const context = new FixtureContext();
  const tabs = await TabSet.create(context as unknown as BrowserContext);
  const page = new FixturePage();
  await tabs.open("A", DOC_ID, page as unknown as Page);
  const request = {
    url: () => `http://fixture.invalid/_agent-native/collab/${DOC_ID}/update`,
    method: () => "POST",
    postData: () => null,
    frame: () => ({ page: () => page }),
  };
  context.emit("request", request);
  context.emit("response", {
    request: () => request,
    status: () => 200,
    ok: () => true,
    text: async () => "{}",
  });
  return { tabs, page, asPage: page as unknown as Page };
}

it("counts the v2 outbox record today's client writes as unsent typing", async () => {
  const { tabs, page, asPage } = await fixture();
  page.localStorage.setItem(V2_KEY, V2_RECORD);

  await expect(outboxEntries(asPage, DOC_ID)).resolves.toEqual([V2_KEY]);
  await expect(tabs.waitForTypingSaved(asPage, DOC_ID)).rejects.toThrow(
    "outbox should empty once its updates are answered",
  );
  await expect(tabs.quiet()).rejects.toThrow(QUIET_FAILURE);

  page.localStorage.removeItem(V2_KEY);
  await expect(
    tabs.waitForTypingSaved(asPage, DOC_ID),
  ).resolves.toBeUndefined();
  await expect(tabs.quiet()).resolves.toBeUndefined();
});

it("still counts a v1 outbox entry an older client left", async () => {
  const { tabs, page, asPage } = await fixture();
  page.localStorage.setItem(V1_KEY, "AAA=");

  await expect(outboxEntries(asPage, DOC_ID)).resolves.toEqual([V1_KEY]);
  await expect(tabs.quiet()).rejects.toThrow(QUIET_FAILURE);
});

it("passes once nothing is waiting in the outbox", async () => {
  const { tabs, page, asPage } = await fixture();
  page.localStorage.setItem("unrelated-key", "kept");

  await expect(outboxEntries(asPage, DOC_ID)).resolves.toEqual([]);
  await expect(
    tabs.waitForTypingSaved(asPage, DOC_ID),
  ).resolves.toBeUndefined();
  await expect(tabs.quiet()).resolves.toBeUndefined();
});

it("fails the client's next v2 outbox write once", async () => {
  const { page, asPage } = await fixture();
  await failNextOutboxWrite(asPage);

  page.localStorage.setItem("unrelated-key", "kept");
  expect(page.client.__outboxSetItemFailed).toBe(false);
  expect(() => page.localStorage.setItem(V2_KEY, V2_RECORD)).toThrow(
    expect.objectContaining({ name: "QuotaExceededError" }),
  );
  expect(page.client.__outboxSetItemFailed).toBe(true);
  expect(page.localStorage.getItem(V2_KEY)).toBeNull();

  page.localStorage.setItem(V2_KEY, V2_RECORD);
  expect(page.localStorage.getItem(V2_KEY)).toBe(V2_RECORD);
});
