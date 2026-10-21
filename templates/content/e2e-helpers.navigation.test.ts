import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";

import type { BrowserContext, Page } from "@playwright/test";
import { expect, it, vi } from "vitest";

vi.mock("@playwright/test", async () => {
  const vitest = await import("vitest");
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
        poll: (read: () => unknown, options?: { message?: string }) => ({
          toEqual: (value: unknown) =>
            vitest.vi.waitFor(
              async () =>
                vitest.expect(await read(), options?.message).toEqual(value),
              { timeout: 1000, interval: 1 },
            ),
        }),
      },
    ),
  };
});

import { Markers, observeIntegrity, TabSet } from "./e2e/helpers";

const body = "Synthetic fixture body";

class FixturePage extends EventEmitter {
  closed = false;
  goto = vi.fn(async () => {});
  reload = vi.fn(async () => {});
  bringToFront = vi.fn(async () => {});
  evaluate = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.closed = true;
  });
  isClosed = () => this.closed;
  locator = () => ({
    innerText: async () => body,
    getAttribute: () => "true",
  });
  request = {
    get: async () => ({
      ok: () => true,
      status: () => 200,
      text: async () => JSON.stringify({ content: body, bodyRevision: 3 }),
    }),
  };
}

class FixtureContext extends EventEmitter {
  addInitScript = async () => {};
  exposeBinding = async () => {};
  route = async () => {};
  newPage = async () => new FixturePage();
  newCDPSession = async () =>
    Object.assign(new EventEmitter(), { send: vi.fn(async () => {}) });
}

async function fixture(navigation: "reload" | "close") {
  const context = new FixtureContext();
  const tabs = await TabSet.create(context as unknown as BrowserContext);
  const first = new FixturePage();
  const second = new FixturePage();
  await tabs.open("A", "fixture", first as unknown as Page);
  await tabs.open("B", "fixture", second as unknown as Page);
  const request = {
    url: () => "http://fixture.invalid/_agent-native/actions/update-document",
    method: () => "POST",
    postData: () => null,
    frame: () => ({ page: () => second }),
  };
  const response = {
    request: () => request,
    status: () => 200,
    ok: () => true,
    text: async () => JSON.stringify({ content: body }),
  };
  const started = Promise.withResolvers<void>();
  first[navigation].mockImplementation(async () => {
    if (navigation === "close") first.closed = true;
    context.emit("request", request);
    started.resolve();
  });
  return {
    tabs,
    first,
    second,
    started: started.promise,
    complete: () => context.emit("response", response),
    observe: () =>
      observeIntegrity(
        tabs,
        new FixturePage() as unknown as Page,
        "fixture",
        new Markers(),
      ),
  };
}

it.each(["reload", "close"] as const)(
  "waits for B's late save before its integrity %s when it starts during A's navigation",
  async (navigation) => {
    const run = await fixture(navigation);
    const observation = run.observe();
    await run.started;
    // Completion stays explicitly held across the helper's next event-loop turn.
    await setImmediate();
    try {
      expect(run.first[navigation]).toHaveBeenCalledTimes(1);
      expect(run.second[navigation]).not.toHaveBeenCalled();
    } finally {
      run.complete();
      await observation;
    }
    expect(run.second[navigation]).toHaveBeenCalledTimes(1);
    await expect(run.tabs.quiet()).resolves.toBeUndefined();
  },
);

it("fails an incomplete observation without navigating B or clearing its pending save", async () => {
  const run = await fixture("reload");
  await expect(run.observe()).rejects.toThrow(
    "saves still in flight after the scenario ended",
  );
  expect(run.second.reload).not.toHaveBeenCalled();
  await expect(run.tabs.quiet()).rejects.toThrow(
    "saves still in flight after the scenario ended",
  );
});
