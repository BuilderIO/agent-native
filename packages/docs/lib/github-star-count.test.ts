import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGithubStarCount,
  resetGithubStarCountCacheForTests,
} from "./github-star-count";

describe("getGithubStarCount", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetGithubStarCountCacheForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
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
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    expect(await getGithubStarCount()).toBeNull();
  });

  it("returns null when the response is not ok", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));

    expect(await getGithubStarCount()).toBeNull();
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
