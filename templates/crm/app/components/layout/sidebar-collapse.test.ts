import { describe, expect, it } from "vitest";

import {
  CRM_SIDEBAR_COLLAPSE_KEY,
  readSidebarCollapsed,
  writeSidebarCollapsed,
  type CollapseStorage,
} from "./sidebar-collapse";

function memoryStorage(initial: Record<string, string> = {}): CollapseStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("sidebar collapse persistence", () => {
  it("round-trips the collapsed preference", () => {
    const storage = memoryStorage();

    writeSidebarCollapsed(storage, true);
    expect(storage.getItem(CRM_SIDEBAR_COLLAPSE_KEY)).toBe("1");
    expect(readSidebarCollapsed(storage)).toBe(true);

    writeSidebarCollapsed(storage, false);
    expect(readSidebarCollapsed(storage)).toBe(false);
  });

  it("defaults to expanded when nothing is stored", () => {
    expect(readSidebarCollapsed(memoryStorage())).toBe(false);
    expect(readSidebarCollapsed(null)).toBe(false);
  });

  it("survives a storage that throws on read or write", () => {
    const hostile: CollapseStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };

    expect(readSidebarCollapsed(hostile)).toBe(false);
    expect(() => writeSidebarCollapsed(hostile, true)).not.toThrow();
  });
});
