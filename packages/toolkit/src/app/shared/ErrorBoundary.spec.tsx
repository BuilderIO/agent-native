import { describe, expect, it, vi } from "vitest";

import {
  isExpectedRouteNotFound,
  resolveErrorBoundaryThemeClass,
} from "./ErrorBoundary.js";

function themeRoot(className: string, dataTheme: string | null) {
  return {
    classList: {
      contains: (name: string) => className.split(" ").includes(name),
    },
    getAttribute: () => dataTheme,
  } as unknown as Pick<HTMLElement, "classList" | "getAttribute">;
}

describe("isExpectedRouteNotFound", () => {
  it("recognizes React Router 404 responses", () => {
    expect(
      isExpectedRouteNotFound({
        data: "missing",
        internal: true,
        status: 404,
        statusText: "Not Found",
      }),
    ).toBe(true);
  });

  it("keeps application errors reportable", () => {
    expect(isExpectedRouteNotFound(new Error("render failed"))).toBe(false);
    expect(
      isExpectedRouteNotFound({
        data: "failed",
        internal: true,
        status: 500,
        statusText: "Server Error",
      }),
    ).toBe(false);
  });
});

describe("resolveErrorBoundaryThemeClass", () => {
  it("honors an explicit data theme before storage or the system preference", () => {
    const readStoredTheme = vi.fn(() => "dark");
    const readSystemTheme = vi.fn(() => true);

    expect(
      resolveErrorBoundaryThemeClass(
        themeRoot("", "light"),
        readStoredTheme,
        readSystemTheme,
      ),
    ).toBe("light");
    expect(readStoredTheme).not.toHaveBeenCalled();
    expect(readSystemTheme).not.toHaveBeenCalled();
  });

  it("uses the system theme only when no explicit theme is selected", () => {
    const readStoredTheme = vi.fn(() => null);
    const readSystemTheme = vi.fn(() => true);

    expect(
      resolveErrorBoundaryThemeClass(
        themeRoot("", null),
        readStoredTheme,
        readSystemTheme,
      ),
    ).toBe("dark");
    expect(readSystemTheme).toHaveBeenCalledOnce();
  });
});
