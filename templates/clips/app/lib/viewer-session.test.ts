import { beforeEach, describe, expect, it, vi } from "vitest";

import { getViewerSessionId } from "./viewer-session";

describe("getViewerSessionId", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: {
        store: new Map<string, string>(),
        getItem(this: any, key: string) {
          return this.store.get(key) ?? null;
        },
        setItem(this: any, key: string, value: string) {
          this.store.set(key, value);
        },
      },
      crypto: {
        randomUUID: () => "uuid-123",
      },
    } as any);
  });

  it("persists a single anonymous viewer session id in localStorage", () => {
    const first = getViewerSessionId();
    const second = getViewerSessionId();

    expect(first).toBe("uuid-123");
    expect(second).toBe("uuid-123");
    expect((window.localStorage as any).store.size).toBe(1);
  });
});
