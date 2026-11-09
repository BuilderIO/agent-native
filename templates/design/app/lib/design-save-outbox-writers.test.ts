import { afterEach, describe, expect, it, vi } from "vitest";

import {
  holdDesignSaveWriter,
  liveDesignSaveWriterSources,
} from "./design-save-outbox-writers";

/** The part of the Web Locks API the module uses, holding a lock until its callback settles. */
function fakeLocks() {
  const held = new Set<string>();
  return {
    held,
    locks: {
      request: vi.fn(async (name: string, callback: () => Promise<void>) => {
        held.add(name);
        try {
          await callback();
        } finally {
          held.delete(name);
        }
      }),
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
