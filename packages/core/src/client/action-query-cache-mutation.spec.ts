// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTION_CACHE_FLUSH_EVENT,
  advanceMutationEpoch,
  readMutationEpoch,
  requestActionCacheFlush,
} from "./action-query-cache-mutation.js";

const KEY = "agent-native.action-query-cache.mutation-epoch";

describe("action query cache mutation epoch", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("reads null before any epoch was written", () => {
    expect(readMutationEpoch()).toBeNull();
  });

  it("advances to a fresh epoch that later reads return", () => {
    expect(advanceMutationEpoch()).toBe(true);
    const first = readMutationEpoch();
    expect(first).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    expect(window.localStorage.getItem(KEY)).toBe(first);

    expect(advanceMutationEpoch()).toBe(true);
    const second = readMutationEpoch();
    expect(second).not.toBe(first);
  });

  it("reports unreadable storage as undefined, not as no epoch", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readMutationEpoch()).toBeUndefined();
  });

  it("reports a write that throws as not advanced", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(advanceMutationEpoch()).toBe(false);
  });

  it("treats a windowless runtime as having no epoch to read or advance", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    vi.stubGlobal("window", undefined);
    try {
      expect(readMutationEpoch()).toBeNull();
      expect(advanceMutationEpoch()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reports a write that did not stick as not advanced", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    expect(advanceMutationEpoch()).toBe(false);
  });

  it("carries the settled epoch on the flush event, and none when not given", () => {
    const details: unknown[] = [];
    const listen = (event: Event) =>
      details.push((event as CustomEvent).detail);
    window.addEventListener(ACTION_CACHE_FLUSH_EVENT, listen);
    try {
      requestActionCacheFlush("epoch-1");
      requestActionCacheFlush();
    } finally {
      window.removeEventListener(ACTION_CACHE_FLUSH_EVENT, listen);
    }
    expect(details).toEqual([{ settledEpoch: "epoch-1" }, {}]);
  });
});
