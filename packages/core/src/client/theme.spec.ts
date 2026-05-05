// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getThemeInitScript } from "./theme.js";

function setPrefersDark(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && prefersDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function runThemeScript(script: string) {
  new Function(script)();
}

describe("getThemeInitScript", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("resolves system theme before the app mounts", () => {
    setPrefersDark(true);

    runThemeScript(getThemeInitScript());

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe(null);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("lets an explicit stored theme override the browser preference", () => {
    setPrefersDark(true);
    window.localStorage.setItem("theme", "light");

    runThemeScript(getThemeInitScript());

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("uses the configured default when there is no stored theme", () => {
    setPrefersDark(false);

    runThemeScript(getThemeInitScript("dark"));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("falls back from stored system when system themes are disabled", () => {
    setPrefersDark(false);
    window.localStorage.setItem("theme", "system");

    runThemeScript(getThemeInitScript("dark", false));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("normalizes legacy auto storage before next-themes reads it", () => {
    setPrefersDark(true);
    window.localStorage.setItem("theme", "auto");

    runThemeScript(getThemeInitScript());

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("theme")).toBe("system");
  });

  it("removes invalid stored themes so the provider can use the default", () => {
    setPrefersDark(false);
    window.localStorage.setItem("theme", "sepia");

    runThemeScript(getThemeInitScript("dark"));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("theme")).toBe(null);
  });
});
