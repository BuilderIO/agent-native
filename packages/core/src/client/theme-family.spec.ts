// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  THEME_FAMILY_ATTRIBUTE,
  THEME_FAMILY_STATUS_ATTRIBUTE,
  themeFamilyStorageKey,
} from "../appearance/theme-family.js";
import { applyThemeFamily, readStoredThemeFamily } from "./theme-family.js";

describe("theme-family client helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "dark";
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.removeAttribute(THEME_FAMILY_ATTRIBUTE);
    document.documentElement.removeAttribute(THEME_FAMILY_STATUS_ATTRIBUTE);
  });

  it("distinguishes a missing, valid, and invalid stored family", () => {
    expect(readStoredThemeFamily()).toEqual({ status: "missing" });

    window.localStorage.setItem(themeFamilyStorageKey(), "original");
    expect(readStoredThemeFamily()).toEqual({
      status: "valid",
      family: "original",
    });

    window.localStorage.setItem(themeFamilyStorageKey(), "sepia");
    expect(readStoredThemeFamily()).toEqual({
      status: "invalid",
      value: "sepia",
    });
  });

  it("applies a family without changing the color-mode class or attribute", () => {
    expect(applyThemeFamily("original")).toEqual({
      family: "original",
      storageStatus: "saved",
    });

    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "original",
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.className).toBe("dark");
  });

  it("switches families without changing the page DOM", () => {
    document.body.innerHTML =
      '<main><h1>Settings</h1><button type="button">Save</button></main>';
    const bodyMarkup = document.body.innerHTML;

    expect(applyThemeFamily("agent-native").family).toBe("agent-native");
    expect(document.body.innerHTML).toBe(bodyMarkup);
    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "agent-native",
    );

    expect(applyThemeFamily("original").family).toBe("original");
    expect(document.body.innerHTML).toBe(bodyMarkup);
    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "original",
    );
  });

  it("reports unreadable storage instead of coercing it to the default", () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });

    try {
      expect(readStoredThemeFamily()).toMatchObject({ status: "unreadable" });
      expect(applyThemeFamily("original")).toEqual({
        family: "original",
        storageStatus: "unavailable",
      });
      expect(
        document.documentElement.getAttribute(THEME_FAMILY_STATUS_ATTRIBUTE),
      ).toBe("unreadable");
    } finally {
      if (storageDescriptor) {
        Object.defineProperty(window, "localStorage", storageDescriptor);
      }
      vi.restoreAllMocks();
    }
  });

  it("rejects unknown family values at runtime", () => {
    expect(() => applyThemeFamily("sepia" as never)).toThrow(
      "Unknown theme family: sepia",
    );
  });
});
