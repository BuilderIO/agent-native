import { describe, expect, it, vi } from "vitest";

import { SourceHydration } from "./source-hydration";

describe("SourceHydration", () => {
  it("loads only requested files and distinguishes empty content from an error", async () => {
    const read = vi.fn(async (id: string) => {
      if (id === "bad") throw new Error("unavailable");
      return { content: "", updatedAt: "1" };
    });
    const loader = new SourceHydration(read, () => {});
    loader.sync(
      Array.from({ length: 500 }, (_, i) => ({
        id: String(i),
        updatedAt: "1",
      })).concat({ id: "bad", updatedAt: "1" }),
    );
    expect(loader.get("1")).toEqual({ status: "unloaded" });
    await Promise.all([loader.request("0"), loader.request("bad")]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(loader.get("0")).toEqual({
      status: "ready",
      content: "",
      updatedAt: "1",
    });
    expect(loader.get("bad").status).toBe("error");
    expect(loader.get("1").status).toBe("unloaded");
  });

  it("deduplicates concurrent demand and discards stale results", async () => {
    let finish!: (value: { content: string; updatedAt: string }) => void;
    const read = vi.fn(
      () =>
        new Promise<{ content: string; updatedAt: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const loader = new SourceHydration(read, () => {});
    loader.sync([{ id: "a", updatedAt: "1" }]);
    const first = loader.request("a");
    const second = loader.request("a");
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    loader.sync([{ id: "a", updatedAt: "2" }]);
    finish({ content: "old", updatedAt: "1" });
    await Promise.all([first, second]);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    finish({ content: "new", updatedAt: "2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loader.get("a")).toEqual({
      status: "ready",
      content: "new",
      updatedAt: "2",
    });
  });
  it("bounds concurrent reads and releases queued demand", async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const loader = new SourceHydration(
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
        return { content: "<p>ready</p>", updatedAt: "1" };
      },
      () => {},
      2,
    );
    loader.sync(
      Array.from({ length: 5 }, (_, i) => ({ id: String(i), updatedAt: "1" })),
    );
    const pending = Array.from({ length: 5 }, (_, i) =>
      loader.request(String(i)),
    );
    await Promise.resolve();
    expect(peak).toBe(2);
    while (releases.length) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(pending);
    expect(peak).toBe(2);
    expect(loader.get("4").status).toBe("ready");
  });
  it("does not read a queued source removed or changed before its turn", async () => {
    let finish!: () => void;
    const read = vi.fn(async (id: string) => {
      if (id === "a")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return { content: id, updatedAt: "1" };
    });
    const changed = vi.fn();
    const loader = new SourceHydration(read, changed, 1);
    loader.sync(["a", "b", "c"].map((id) => ({ id, updatedAt: "1" })));
    const first = loader.request("a");
    const removed = loader.request("b");
    const updated = loader.request("c");
    await Promise.resolve();
    loader.sync([
      { id: "a", updatedAt: "1" },
      { id: "c", updatedAt: "2" },
    ]);
    changed.mockClear();
    finish();
    await Promise.all([first, removed, updated]);
    expect(read.mock.calls.map(([id]) => id)).toEqual(["a"]);
    expect(loader.get("b").status).toBe("unloaded");
    expect(loader.get("c").status).toBe("unloaded");
    expect(changed).toHaveBeenCalled();
  });
  it("evicts least-recent clean source while keeping pinned source", async () => {
    const loader = new SourceHydration(
      async (id) => ({ content: id.repeat(4), updatedAt: "1" }),
      () => {},
      2,
      8,
    );
    loader.sync(["a", "b", "c"].map((id) => ({ id, updatedAt: "1" })));
    loader.setPinned(new Set(["a"]));
    await loader.request("a");
    await loader.request("b");
    await loader.request("c");
    expect(loader.get("a").status).toBe("ready");
    expect(loader.get("b").status).toBe("unloaded");
    expect(loader.get("c").status).toBe("ready");
  });
  it("retains dirty source while a newer saved version is loading", async () => {
    let finish!: (value: { content: string; updatedAt: string }) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce({ content: "", updatedAt: "1" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const loader = new SourceHydration(read, () => {});
    loader.sync([{ id: "a", updatedAt: "1" }]);
    await loader.request("a");
    loader.setDirty(new Set(["a"]));
    loader.sync([{ id: "a", updatedAt: "2" }]);
    const pending = loader.request("a");
    expect(loader.get("a")).toMatchObject({
      status: "ready",
      content: "",
      refreshing: true,
    });
    await Promise.resolve();
    finish({ content: "saved", updatedAt: "2" });
    await pending;
    expect(loader.get("a")).toEqual({
      status: "ready",
      content: "saved",
      updatedAt: "2",
    });
  });
  it("keeps a temporarily leased target available even when pinned sources exceed the cache budget", async () => {
    const changed = vi.fn();
    const loader = new SourceHydration(
      async (id) => ({ content: id.repeat(10), updatedAt: "1" }),
      changed,
      4,
      5,
    );
    loader.sync([
      { id: "a", updatedAt: "1" },
      { id: "b", updatedAt: "1" },
    ]);
    loader.setPinned(new Set(["a"]));
    await loader.request("a");
    const release = loader.lease("b");
    await loader.request("b");
    expect(loader.get("b")).toMatchObject({
      status: "ready",
      content: "bbbbbbbbbb",
    });
    changed.mockClear();
    release();
    expect(loader.get("b").status).toBe("unloaded");
    expect(changed).toHaveBeenCalledOnce();
    changed.mockClear();
    loader.setPinned(new Set(["a"]));
    expect(changed).not.toHaveBeenCalled();
  });

  it("notifies when removing a pin evicts a cached source", async () => {
    const changed = vi.fn();
    const loader = new SourceHydration(
      async () => ({ content: "oversized", updatedAt: "1" }),
      changed,
      1,
      1,
    );
    loader.sync([{ id: "a", updatedAt: "1" }]);
    loader.setPinned(new Set(["a"]));
    await loader.request("a");
    changed.mockClear();
    loader.setPinned(new Set());
    expect(loader.get("a").status).toBe("unloaded");
    expect(changed).toHaveBeenCalledOnce();
    loader.setPinned(new Set());
    expect(changed).toHaveBeenCalledOnce();
  });

  it("notifies when metadata invalidates or removes cached sources, but not for no-op syncs", async () => {
    const changed = vi.fn();
    const loader = new SourceHydration(
      async () => ({ content: "cached", updatedAt: "1" }),
      changed,
    );
    loader.sync(["a", "b"].map((id) => ({ id, updatedAt: "1" })));
    await Promise.all([loader.request("a"), loader.request("b")]);
    changed.mockClear();
    loader.sync([{ id: "a", updatedAt: "2" }]);
    expect(loader.get("a").status).toBe("unloaded");
    expect(loader.get("b").status).toBe("unloaded");
    expect(changed).toHaveBeenCalledOnce();
    loader.sync([{ id: "a", updatedAt: "2" }]);
    expect(changed).toHaveBeenCalledOnce();
  });
});
