import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => {
  let value: Record<string, unknown> | null = null;
  return {
    reset: () => {
      value = null;
    },
    set: (next: Record<string, unknown>) => {
      value = next;
    },
    getSetting: vi.fn(async () => value),
    mutateSetting: vi.fn(
      async (
        _key: string,
        updater: (
          current: Record<string, unknown> | null,
        ) => Record<string, unknown> | Promise<Record<string, unknown>>,
      ) => {
        value = await updater(value);
        return value;
      },
    ),
    putSetting: vi.fn(async (_key: string, next: Record<string, unknown>) => {
      value = next;
    }),
  };
});

vi.mock("@agent-native/core/settings", () => settings);

import {
  getGithubStarCount,
  resetGithubStarCountCacheForTests,
} from "./github-star-count.server";

describe("getGithubStarCount", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    settings.reset();
    settings.getSetting.mockClear();
    settings.mutateSetting.mockClear();
    settings.putSetting.mockClear();
    resetGithubStarCountCacheForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the star count from a successful response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ stargazers_count: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(await getGithubStarCount()).toBe(42);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not throw when the request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock;

    expect(await getGithubStarCount()).toBeNull();
    expect(await getGithubStarCount()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the response is not ok", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));

    expect(await getGithubStarCount()).toBeNull();
  });

  it.each([
    {
      name: "Retry-After",
      headers: () => ({ "retry-after": "120" }),
    },
    {
      name: "X-RateLimit-Reset",
      headers: () => ({
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 120),
      }),
    },
  ])("honors the GitHub $name retry deadline", async ({ headers }) => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(null, { status: 429, headers: headers() }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stargazers_count: 11 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    global.fetch = fetchMock;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T17:00:00.000Z"));

    expect(await getGithubStarCount()).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(await getGithubStarCount()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    expect(await getGithubStarCount()).toBe(11);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves cached value without refetching within the fresh window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ stargazers_count: 7 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock;

    expect(await getGithubStarCount()).toBe(7);
    expect(await getGithubStarCount()).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves the persisted value without refetching within the fresh window", async () => {
    settings.set({
      count: 19,
      fetchedAt: Date.now(),
      retryAt: null,
      refreshUntil: null,
    });
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    expect(await getGithubStarCount()).toBe(19);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the persisted value during a GitHub rate-limit retry window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T17:00:00.000Z"));
    settings.set({
      count: 19,
      fetchedAt: 0,
      retryAt: null,
      refreshUntil: null,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "retry-after": "120" },
      }),
    );
    global.fetch = fetchMock;

    expect(await getGithubStarCount()).toBe(19);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resetGithubStarCountCacheForTests();

    expect(await getGithubStarCount()).toBe(19);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves the stale value when a background refresh fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stargazers_count: 7 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    global.fetch = fetchMock;

    expect(await getGithubStarCount()).toBe(7);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5 * 60_000);

    expect(await getGithubStarCount()).toBe(7);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await getGithubStarCount()).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent requests into a single upstream fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ stargazers_count: 5 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock;

    const [a, b] = await Promise.all([
      getGithubStarCount(),
      getGithubStarCount(),
    ]);

    expect(a).toBe(5);
    expect(b).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
