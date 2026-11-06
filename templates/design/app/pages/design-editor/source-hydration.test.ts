// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

import { eagerSourceIds, SourceHydration } from "./source-hydration";
import { useDesignSourceHydration } from "./use-design-source-hydration";

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
    const settled = vi.fn();
    void first.then(settled);
    finish({ content: "old", updatedAt: "1" });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(settled).not.toHaveBeenCalled();
    finish({ content: "new", updatedAt: "2" });
    await Promise.all([first, second]);
    expect(loader.get("a")).toEqual({
      status: "ready",
      content: "new",
      updatedAt: "2",
    });
  });
  it("waits for the current version when queued metadata changes", async () => {
    const finishes = new Map<
      string,
      (file: { content: string; updatedAt: string }) => void
    >();
    const read = vi.fn(
      (id: string) =>
        new Promise<{ content: string; updatedAt: string }>((resolve) =>
          finishes.set(id, resolve),
        ),
    );
    const loader = new SourceHydration(read, () => {}, 1);
    loader.sync([
      { id: "a", updatedAt: "1" },
      { id: "b", updatedAt: "1" },
    ]);
    const a = loader.request("a");
    const b = loader.request("b");
    const settled = vi.fn();
    void b.then(settled);
    await vi.waitFor(() => expect(finishes.has("a")).toBe(true));
    loader.sync([
      { id: "a", updatedAt: "1" },
      { id: "b", updatedAt: "2" },
    ]);
    finishes.get("a")?.({ content: "a", updatedAt: "1" });
    await vi.waitFor(() => expect(finishes.has("b")).toBe(true));
    expect(settled).not.toHaveBeenCalled();
    finishes.get("b")?.({ content: "current", updatedAt: "2" });
    await Promise.all([a, b]);
    expect(loader.get("b")).toEqual({
      status: "ready",
      content: "current",
      updatedAt: "2",
    });
    expect(read.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
  });

  it("settles queued leases on disposal without restarting superseded reads", async () => {
    let finish:
      | ((file: { content: string; updatedAt: string }) => void)
      | undefined;
    const read = vi.fn(
      () =>
        new Promise<{ content: string; updatedAt: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const loader = new SourceHydration(read, () => {}, 1);
    loader.sync([
      { id: "a", updatedAt: "1" },
      { id: "b", updatedAt: "1" },
    ]);
    const a = loader.request("a");
    const release = loader.lease("b");
    const b = loader.request("b");
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    loader.sync([
      { id: "a", updatedAt: "1" },
      { id: "b", updatedAt: "2" },
    ]);
    loader.dispose();
    await b;
    expect(loader.get("b").status).not.toBe("ready");
    release();
    finish?.({ content: "late", updatedAt: "1" });
    await a;
    expect(read).toHaveBeenCalledOnce();
    await loader.request("b");
    expect(read).toHaveBeenCalledOnce();
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
  it("does not read a removed source and loads the current queued version", async () => {
    let finish!: () => void;
    const read = vi.fn(async (id: string) => {
      if (id === "a")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return { content: id, updatedAt: id === "c" ? "2" : "1" };
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
    expect(read.mock.calls.map(([id]) => id)).toEqual(["a", "c"]);
    expect(loader.get("b").status).toBe("unloaded");
    expect(loader.get("c")).toEqual({
      status: "ready",
      content: "c",
      updatedAt: "2",
    });
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
  it("loads wanted previews after held sources, nearest first", async () => {
    const order: string[] = [];
    const finishes: Array<() => void> = [];
    const loader = new SourceHydration(
      (id) =>
        new Promise((resolve) => {
          finishes.push(() => {
            order.push(id);
            resolve({ content: "x", updatedAt: "1" });
          });
        }),
      () => {},
      1,
    );
    loader.sync(["far", "near", "held"].map((id) => ({ id, updatedAt: "1" })));
    loader.setWanted(["near", "far"]);
    const previews = [
      loader.request("far", "low"),
      loader.request("near", "low"),
    ];
    loader.setPinned(new Set(["held"]));
    const held = loader.request("held");
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(finishes).toHaveLength(i + 1));
      finishes[i]?.();
      await Promise.resolve();
    }
    await Promise.all([...previews, held]);
    // The first preview was already reading when the held request arrived.
    expect(order).toEqual(["far", "held", "near"]);
  });

  it("keeps wanted previews within the byte budget, nearest first, without reloading", async () => {
    const read = vi.fn(async (id: string) => ({
      content: "x".repeat(4),
      updatedAt: id,
    }));
    const loader = new SourceHydration(read, () => {}, 4, 10);
    const ids = ["held", "p0", "p1", "p2", "p3"];
    loader.sync(ids.map((id) => ({ id, updatedAt: id })));
    loader.setPinned(new Set(["held"]));
    await loader.request("held");
    const wanted = ["p0", "p1", "p2", "p3"];
    loader.setWanted(wanted);
    await Promise.all(wanted.map((id) => loader.request(id, "low")));
    // 4 held bytes + 4 for p0 leave p1 under budget; p2 and p3 are past it.
    expect(wanted.map((id) => loader.get(id).status)).toEqual([
      "ready",
      "ready",
      "unloaded",
      "unloaded",
    ]);
    expect(loader.get("held").status).toBe("ready");
    const reads = read.mock.calls.length;
    await Promise.all(wanted.map((id) => loader.request(id, "low")));
    expect(read).toHaveBeenCalledTimes(reads);

    // Panning re-ranks: a preview no longer wanted is evicted before any wanted one.
    loader.setWanted(["p3", "p0"]);
    await loader.request("p3", "low");
    expect(loader.get("p3").status).toBe("ready");
    expect(loader.get("p0").status).toBe("ready");
    expect(loader.get("p1").status).toBe("unloaded");
  });

  it("keeps a source that moves from wanted to pinned over the budget", async () => {
    const read = vi.fn(async (id: string) => ({
      content: "x".repeat(4),
      updatedAt: id,
    }));
    const loader = new SourceHydration(read, () => {}, 4, 10);
    loader.sync(["a", "b", "c"].map((id) => ({ id, updatedAt: id })));
    loader.setDemand(new Set(["a"]), ["b", "c"]);
    await Promise.all([
      loader.request("a"),
      loader.request("b", "low"),
      loader.request("c", "low"),
    ]);
    expect(loader.get("c").status).toBe("ready");
    // A preview that paints becomes pinned; for a moment it is in neither set
    // unless both change together.
    loader.setDemand(new Set(["a", "c"]), ["b"]);
    expect(["a", "b", "c"].map((id) => loader.get(id).status)).toEqual([
      "ready",
      "ready",
      "ready",
    ]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("cancels queued previews that stop being wanted", async () => {
    let finish!: () => void;
    const read = vi.fn(
      (_id: string) =>
        new Promise<{ content: string; updatedAt: string }>((resolve) => {
          finish = () => resolve({ content: "x", updatedAt: "1" });
        }),
    );
    const loader = new SourceHydration(read, () => {}, 1);
    loader.sync(["a", "b"].map((id) => ({ id, updatedAt: "1" })));
    loader.setWanted(["a", "b"]);
    const a = loader.request("a", "low");
    const b = loader.request("b", "low");
    expect(loader.get("b").status).toBe("loading");
    loader.setWanted(["a"]);
    await b;
    expect(loader.get("b").status).toBe("unloaded");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    finish();
    await a;
    expect(read.mock.calls.map(([id]) => id)).toEqual(["a"]);
  });

  it("promotes a queued preview when it is demanded", async () => {
    const finishes = new Map<string, () => void>();
    const read = vi.fn(
      (id: string) =>
        new Promise<{ content: string; updatedAt: string }>((resolve) => {
          finishes.set(id, () => resolve({ content: id, updatedAt: "1" }));
        }),
    );
    const loader = new SourceHydration(read, () => {}, 1);
    loader.sync(["busy", "a", "b"].map((id) => ({ id, updatedAt: "1" })));
    const busy = loader.request("busy");
    loader.setWanted(["a", "b"]);
    void loader.request("a", "low");
    const b = loader.request("b", "low");
    loader.setPinned(new Set(["b"]));
    void loader.request("b");
    await vi.waitFor(() => expect(finishes.has("busy")).toBe(true));
    finishes.get("busy")?.();
    await busy;
    await vi.waitFor(() => expect(finishes.has("b")).toBe(true));
    expect(finishes.has("a")).toBe(false);
    finishes.get("b")?.();
    await b;
    expect(loader.get("b").status).toBe("ready");
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

  it("keeps a held source visible while its new version loads", async () => {
    let finish!: (value: { content: string; updatedAt: string }) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce({ content: "old", updatedAt: "1" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const loader = new SourceHydration(read, () => {});
    loader.sync([{ id: "a", updatedAt: "1" }]);
    loader.setPinned(new Set(["a"]));
    await loader.request("a");
    loader.sync([{ id: "a", updatedAt: "2" }]);
    expect(loader.get("a")).toMatchObject({
      status: "ready",
      content: "old",
      refreshing: true,
    });
    const refreshed = loader.request("a");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(loader.get("a")).toMatchObject({ content: "old" });
    finish({ content: "new", updatedAt: "2" });
    await refreshed;
    expect(loader.get("a")).toEqual({
      status: "ready",
      content: "new",
      updatedAt: "2",
    });
  });

  it("accepts a read newer than its metadata as the current source", async () => {
    const loader = new SourceHydration(
      async () => ({ content: "saved again", updatedAt: "3" }),
      () => {},
    );
    loader.sync([{ id: "a", updatedAt: "2" }]);
    await loader.request("a");
    expect(loader.get("a")).toEqual({
      status: "ready",
      content: "saved again",
      updatedAt: "3",
    });
    loader.sync([{ id: "a", updatedAt: "3" }]);
    expect(loader.get("a").status).toBe("ready");
  });

  it("drops a stale source once nothing holds it", async () => {
    const loader = new SourceHydration(
      async () => ({ content: "old", updatedAt: "1" }),
      () => {},
    );
    loader.sync([{ id: "a", updatedAt: "1" }]);
    loader.setPinned(new Set(["a"]));
    await loader.request("a");
    loader.sync([{ id: "a", updatedAt: "2" }]);
    loader.setPinned(new Set());
    expect(loader.get("a").status).toBe("unloaded");
  });

  it("serves a primed source before metadata lists it, without reading", async () => {
    const read = vi.fn();
    const loader = new SourceHydration(read, () => {});
    loader.sync([{ id: "a", updatedAt: "1" }]);
    loader.prime("created", { content: "<main></main>", updatedAt: "5" });
    loader.sync([{ id: "a", updatedAt: "1" }]);
    expect(loader.get("created")).toEqual({
      status: "ready",
      content: "<main></main>",
      updatedAt: "5",
    });
    loader.sync([
      { id: "a", updatedAt: "1" },
      { id: "created", updatedAt: "5" },
    ]);
    await loader.request("created");
    expect(read).not.toHaveBeenCalled();
    loader.sync([{ id: "a", updatedAt: "1" }]);
    expect(loader.get("created").status).toBe("unloaded");
  });
});

describe("eagerSourceIds", () => {
  it("loads a small design whole and a large or unsized one on demand", () => {
    const small = [
      { id: "a", contentBytes: 1024 },
      { id: "b", contentBytes: 2048 },
    ];
    expect(eagerSourceIds(small)).toEqual(["a", "b"]);
    expect(
      eagerSourceIds([...small, { id: "c", contentBytes: 8 * 1024 * 1024 }]),
    ).toEqual([]);
    expect(eagerSourceIds([...small, { id: "c", contentBytes: null }])).toEqual(
      [],
    );
    expect(
      eagerSourceIds(
        Array.from({ length: 65 }, (_, i) => ({
          id: String(i),
          contentBytes: 1,
        })),
      ),
    ).toEqual([]);
  });
});

it("rejects a queued source lease when its editor unmounts", async () => {
  const files = ["a", "b", "c", "d", "target"].map((id) => ({
    id,
    filename: `${id}.html`,
    updatedAt: "1",
  }));
  const demands: string[] = [];
  const empty = new Set<string>();
  const releases: Array<() => void> = [];
  callAction.mockImplementation(
    (_name, args) =>
      new Promise((resolve) =>
        releases.push(() =>
          resolve({
            files: [
              { id: args.fileId, content: "<main></main>", updatedAt: "1" },
            ],
          }),
        ),
      ),
  );
  let current: ReturnType<typeof useDesignSourceHydration> | undefined;
  function Harness() {
    current = useDesignSourceHydration("design", files, demands, empty, empty);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
  const hydration = current;
  if (!hydration?.loader) throw new Error("Source loader did not mount");
  const active = files
    .slice(0, 4)
    .map((file) => hydration.loader?.request(file.id));
  let lease: Promise<() => void> | undefined;
  await act(async () => {
    lease = hydration.leaseHydratedSource("target");
  });
  const outcome = expect(lease).rejects.toThrow(
    "Screen source could not be loaded",
  );
  await act(async () => {
    root.unmount();
  });
  await outcome;
  expect(callAction).toHaveBeenCalledTimes(4);
  releases.forEach((release) => release());
  await Promise.all(active);
});

it("loads preview sources without pinning them", async () => {
  const files = ["a", "b"].map((id) => ({
    id,
    filename: `${id}.html`,
    updatedAt: "1",
  }));
  const large = "x".repeat(9 * 1024 * 1024);
  callAction.mockReset();
  callAction.mockImplementation(async (_name, args) => ({
    files: [{ id: args.fileId, content: large, updatedAt: "1" }],
  }));
  const empty = new Set<string>();
  const none: string[] = [];
  let current: ReturnType<typeof useDesignSourceHydration> | undefined;
  function Harness({ previews }: { previews: string[] }) {
    current = useDesignSourceHydration(
      "design",
      files,
      none,
      empty,
      empty,
      previews,
    );
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness, { previews: ["a"] }));
  });
  await vi.waitFor(() =>
    expect(current?.loader?.get("a").status).toBe("ready"),
  );
  expect(current?.dependencyStatusByRoot.get("a")).toBe("ready");
  await act(async () => {
    root.render(createElement(Harness, { previews: ["b"] }));
  });
  await vi.waitFor(() =>
    expect(current?.loader?.get("b").status).toBe("ready"),
  );
  // Two 9 MiB sources exceed the budget; the one no longer previewed goes.
  expect(current?.loader?.get("a").status).toBe("unloaded");
  await act(async () => root.unmount());
});
