import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("clipsDeviceId", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an id on first use, stores it, and reuses it", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const { clipsDeviceId } = await import("./device-id");

    const first = clipsDeviceId();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(storage.values.get("clips:device-id")).toBe(first);
    expect(clipsDeviceId()).toBe(first);
  });

  it("keeps a stored id across module loads", async () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({ "clips:device-id": "device-from-last-launch" }),
    );
    const { clipsDeviceId } = await import("./device-id");

    expect(clipsDeviceId()).toBe("device-from-last-launch");
  });

  it("replaces a blank stored id", async () => {
    const storage = fakeStorage({ "clips:device-id": "   " });
    vi.stubGlobal("localStorage", storage);
    const { clipsDeviceId } = await import("./device-id");

    const id = clipsDeviceId();

    expect(id.trim()).toBe(id);
    expect(id).not.toBe("   ");
    expect(storage.values.get("clips:device-id")).toBe(id);
  });

  it("falls back to one in-memory id when storage cannot be read", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
    });
    const { clipsDeviceId } = await import("./device-id");

    const first = clipsDeviceId();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(clipsDeviceId()).toBe(first);
  });

  it("stays stable when reads work but writes are refused", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    const { clipsDeviceId } = await import("./device-id");

    // A fresh random id per call would make every request look like another device.
    expect(clipsDeviceId()).toBe(clipsDeviceId());
  });
});
