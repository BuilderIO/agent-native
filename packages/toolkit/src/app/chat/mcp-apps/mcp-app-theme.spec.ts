import { describe, expect, it, vi } from "vitest";

import { resolveMcpAppTheme } from "./mcp-app-theme.js";

function themeRoot(className: string, dataTheme: string | null) {
  return {
    classList: {
      contains: (name: string) => className.split(" ").includes(name),
    },
    getAttribute: () => dataTheme,
  } as unknown as Pick<HTMLElement, "classList" | "getAttribute">;
}

describe("resolveMcpAppTheme", () => {
  it("keeps the selected host theme when the operating system prefers another theme", () => {
    const readSystemTheme = vi.fn(() => true);
    expect(
      resolveMcpAppTheme(themeRoot("light", "light"), readSystemTheme),
    ).toBe("light");
    expect(resolveMcpAppTheme(themeRoot("dark", "dark"), readSystemTheme)).toBe(
      "dark",
    );
    expect(readSystemTheme).not.toHaveBeenCalled();
  });

  it("uses the system preference only when no selected theme is present", () => {
    expect(resolveMcpAppTheme(themeRoot("", null), () => true)).toBe("dark");
    expect(resolveMcpAppTheme(themeRoot("", null), () => false)).toBe("light");
  });
});
