import { describe, expect, it } from "vitest";

import { getNextTheme } from "@/lib/theme";

describe("getNextTheme", () => {
  it("uses an explicit persisted theme before a stale resolved value", () => {
    expect(getNextTheme("light", "dark")).toBe("dark");
    expect(getNextTheme("dark", "light")).toBe("light");
  });

  it("uses the resolved theme for system or missing preferences", () => {
    expect(getNextTheme("system", "dark")).toBe("light");
    expect(getNextTheme(undefined, "light")).toBe("dark");
  });
});
