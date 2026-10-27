import { describe, expect, it, vi } from "vitest";

import { createOrgDirectorySuccessCache } from "./org-apps-directory-cache.js";

describe("createOrgDirectorySuccessCache", () => {
  it("coalesces same-key refreshes and isolates cache keys", async () => {
    let resolveLoad!: (value: string[]) => void;
    const load = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const cache = createOrgDirectorySuccessCache<string[]>();

    const first = cache.get("org-a|user:alice", load);
    const second = cache.get("org-a|user:alice", load);
    expect(load).toHaveBeenCalledTimes(1);
    resolveLoad(["analytics"]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      ["analytics"],
      ["analytics"],
    ]);

    await cache.get("org-a|user:bob", async () => ["mail"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches successful values until expiry and retries failures", async () => {
    let now = 1_000;
    const cache = createOrgDirectorySuccessCache<string[]>({
      ttlMs: 60,
      now: () => now,
    });
    const load = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["content"])
      .mockRejectedValueOnce(new Error("directory unavailable"))
      .mockResolvedValueOnce(["design"])
      .mockResolvedValueOnce(["design-updated"]);

    await expect(cache.get("org-a", load)).resolves.toEqual(["content"]);
    now += 59;
    await expect(cache.get("org-a", load)).resolves.toEqual(["content"]);
    now += 2;
    await expect(cache.get("org-a", load)).rejects.toThrow(
      "directory unavailable",
    );
    await expect(cache.get("org-a", load)).resolves.toEqual(["design"]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not repopulate after invalidation while a refresh is in flight", async () => {
    let resolveLoad!: (value: string[]) => void;
    const cache = createOrgDirectorySuccessCache<string[]>();
    const staleLoad = cache.get(
      "org-a",
      () =>
        new Promise<string[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    cache.clear();
    resolveLoad(["before-edit"]);
    await expect(staleLoad).resolves.toEqual(["before-edit"]);
    await expect(
      cache.get("org-a", async () => ["after-edit"]),
    ).resolves.toEqual(["after-edit"]);
  });
});
