import { afterEach, describe, expect, it, vi } from "vitest";

import {
  holdDesignSaveWriter,
  liveDesignSaveWriterSources,
  waitForDesignSaveWriterRelease,
} from "./design-save-outbox-writers";

/**
 * The part of the Web Locks API the module uses: exclusive locks that queue,
 * are held until their callback settles, and can be abandoned with a signal.
 */
function fakeLocks() {
  const held = new Set<string>();
  const queues = new Map<string, Array<() => void>>();
  return {
    held,
    locks: {
      request: vi.fn(
        (
          name: string,
          optionsOrCallback: { signal?: AbortSignal } | (() => Promise<void>),
          maybeCallback?: () => Promise<void>,
        ) => {
          const options =
            typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
          const callback =
            typeof optionsOrCallback === "function"
              ? optionsOrCallback
              : maybeCallback;
          return new Promise<void>((resolve, reject) => {
            const run = async () => {
              held.add(name);
              try {
                await callback?.();
                resolve();
              } catch (error) {
                reject(error);
              } finally {
                held.delete(name);
                queues.get(name)?.shift()?.();
              }
            };
            if (!held.has(name)) {
              void run();
              return;
            }
            const grant = () => void run();
            const queue = queues.get(name) ?? [];
            queues.set(name, queue);
            queue.push(grant);
            options.signal?.addEventListener("abort", () => {
              const index = queue.indexOf(grant);
              if (index === -1) return;
              queue.splice(index, 1);
              reject(new DOMException("The request was aborted", "AbortError"));
            });
          });
        },
      ),
      query: vi.fn(async () => ({
        held: [...held].map((name) => ({ name })),
        pending: [],
      })),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("design save writer locks", () => {
  it("lists a session while its editor holds the lock and not after release", async () => {
    const { locks } = fakeLocks();
    vi.stubGlobal("navigator", { locks });

    const release = holdDesignSaveWriter("tab-a:save:1");
    await Promise.resolve();
    expect(await liveDesignSaveWriterSources()).toEqual(
      new Set(["tab-a:save:1"]),
    );

    release();
    await vi.waitFor(async () =>
      expect(await liveDesignSaveWriterSources()).toEqual(new Set()),
    );
  });

  it("keeps different editors' sessions apart and ignores locks that are not ours", async () => {
    const { held, locks } = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    held.add("some-other-feature:lock");

    holdDesignSaveWriter("tab-a:save:1");
    holdDesignSaveWriter("tab-b:save:2");
    await Promise.resolve();

    expect(await liveDesignSaveWriterSources()).toEqual(
      new Set(["tab-a:save:1", "tab-b:save:2"]),
    );
  });

  it("holds no lock when released before the browser grants it", async () => {
    const { locks } = fakeLocks();
    vi.stubGlobal("navigator", { locks });

    holdDesignSaveWriter("tab-a:save:1")();

    await vi.waitFor(async () =>
      expect(await liveDesignSaveWriterSources()).toEqual(new Set()),
    );
  });

  it("cannot tell, and says so, when the browser has no Web Locks", async () => {
    vi.stubGlobal("navigator", {});

    expect(await liveDesignSaveWriterSources()).toBeNull();
    expect(() => holdDesignSaveWriter("tab-a:save:1")()).not.toThrow();
  });

  it("cannot tell when the browser will not list the locks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("navigator", {
      locks: { query: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    expect(await liveDesignSaveWriterSources()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns and carries on when the lock is refused", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("navigator", {
      locks: { request: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    expect(() => holdDesignSaveWriter("tab-a:save:1")).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});

describe("waiting for a save writer to close", () => {
  it("resolves at once when no editor holds the session", async () => {
    const { locks } = fakeLocks();
    vi.stubGlobal("navigator", { locks });

    await expect(
      waitForDesignSaveWriterRelease(
        "tab-a:save:1",
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });

  it("resolves only once the editor holding the session lets go", async () => {
    const { locks } = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    const release = holdDesignSaveWriter("tab-a:save:1");
    await Promise.resolve();
    const settled = vi.fn();

    const wait = waitForDesignSaveWriterRelease(
      "tab-a:save:1",
      new AbortController().signal,
    );
    void wait?.then(settled);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    release();

    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
  });

  it("gives up with an abort when the waiting tab closes first", async () => {
    const { locks } = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    holdDesignSaveWriter("tab-a:save:1");
    await Promise.resolve();
    const controller = new AbortController();

    const wait = waitForDesignSaveWriterRelease(
      "tab-a:save:1",
      controller.signal,
    );
    controller.abort();

    await expect(wait).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns null when the browser has no Web Locks", () => {
    vi.stubGlobal("navigator", {});

    expect(
      waitForDesignSaveWriterRelease(
        "tab-a:save:1",
        new AbortController().signal,
      ),
    ).toBeNull();
  });
});
