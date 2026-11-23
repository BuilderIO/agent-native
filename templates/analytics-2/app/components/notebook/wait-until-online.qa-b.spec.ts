// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { waitUntilOnline } from "./wait-until-online";

afterEach(() => vi.restoreAllMocks());

describe("waiting for the network before a run starts", () => {
  it("resolves at once while online", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await expect(waitUntilOnline()).resolves.toBeUndefined();
  });

  it("stays pending while offline and resolves when the browser reconnects", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    let settled = false;
    const waiting = waitUntilOnline().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    window.dispatchEvent(new Event("online"));
    await waiting;
    expect(settled).toBe(true);
  });
});
