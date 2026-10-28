// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getThemeFamilyInitScript } from "../appearance/theme-family.js";
import {
  applyEmbeddedThemeUpdate,
  buildEmbeddedThemeUpdate,
  getThemeInitScript,
  parseEmbeddedThemeUpdate,
} from "./theme.js";

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-appearance");
    document.documentElement.removeAttribute("data-theme-family");
    document.documentElement.removeAttribute("data-theme-family-status");
    document.documentElement.style.colorScheme = "";
  });

  it("resolves system theme before the app mounts", () => {
    setPrefersDark(true);

    runThemeScript(getThemeInitScript());

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("uses the compiled app id for the default theme-family boot script", () => {
    const configDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "__AGENT_NATIVE_CONFIG__",
    );
    Object.defineProperty(window, "__AGENT_NATIVE_CONFIG__", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal("__AGENT_NATIVE_WORKSPACE_APP_ID__", "");
    vi.stubGlobal("__AGENT_NATIVE_APP_ID__", "sample-app");
    window.localStorage.setItem("theme-family:sample-app", "original");
    setPrefersDark(true);

    try {
      runThemeScript(getThemeInitScript());

      expect(document.documentElement.getAttribute("data-theme-family")).toBe(
        "original",
      );
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    } finally {
      if (configDescriptor) {
        Object.defineProperty(
          window,
          "__AGENT_NATIVE_CONFIG__",
          configDescriptor,
        );
      } else {
        delete (window as Window & { __AGENT_NATIVE_CONFIG__?: unknown })
          .__AGENT_NATIVE_CONFIG__;
      }
    }
  });

  it("keeps the default family until an app identity is available", () => {
    const configDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "__AGENT_NATIVE_CONFIG__",
    );
    Object.defineProperty(window, "__AGENT_NATIVE_CONFIG__", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal("__AGENT_NATIVE_WORKSPACE_APP_ID__", "");
    vi.stubGlobal("__AGENT_NATIVE_APP_ID__", "");
    window.localStorage.setItem("theme-family:sample-app", "original");

    try {
      runThemeScript(getThemeInitScript());

      expect(document.documentElement.getAttribute("data-theme-family")).toBe(
        "original",
      );
      expect(
        document.documentElement.getAttribute("data-theme-family-status"),
      ).toBe("awaiting-app-setting");
    } finally {
      if (configDescriptor) {
        Object.defineProperty(
          window,
          "__AGENT_NATIVE_CONFIG__",
          configDescriptor,
        );
      } else {
        delete (window as Window & { __AGENT_NATIVE_CONFIG__?: unknown })
          .__AGENT_NATIVE_CONFIG__;
      }
    }
  });

  it("boots an opted-in app with its configured family default", () => {
    vi.stubGlobal("__AGENT_NATIVE_APP_CONFIG__", {
      themeFamily: {
        families: ["original", "agent-native"],
        defaultFamily: "agent-native",
      },
    });

    runThemeScript(getThemeInitScript());

    expect(document.documentElement.getAttribute("data-theme-family")).toBe(
      "agent-native",
    );
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

  it("inlines Vite dev recovery outside production", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(getThemeInitScript()).toContain("__an_optimize_reload");
  });

  it("omits Vite dev recovery in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(getThemeInitScript()).not.toContain("__an_optimize_reload");
  });

  it("applies a stored appearance preset on init", () => {
    setPrefersDark(false);
    window.localStorage.setItem("appearance", "ocean");

    runThemeScript(getThemeInitScript());

    expect(document.documentElement.getAttribute("data-appearance")).toBe(
      "ocean",
    );
  });

  it("clears invalid appearance values from storage", () => {
    setPrefersDark(false);
    window.localStorage.setItem("appearance", "neon-pink");

    runThemeScript(getThemeInitScript());

    expect(document.documentElement.getAttribute("data-appearance")).toBe(null);
    expect(window.localStorage.getItem("appearance")).toBe(null);
  });

  it("leaves data-appearance unset when none is stored", () => {
    setPrefersDark(false);

    runThemeScript(getThemeInitScript());

    expect(document.documentElement.getAttribute("data-appearance")).toBe(null);
  });

  it("applies the theme family without changing color mode", () => {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
    window.localStorage.setItem("theme-family:calendar", "original");

    runThemeScript(getThemeFamilyInitScript("calendar"));

    expect(document.documentElement.getAttribute("data-theme-family")).toBe(
      "original",
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("ignores Agent-Native URL overrides when the app has not opted in", () => {
    window.history.replaceState(null, "", "/?theme-family=agent-native");

    runThemeScript(getThemeFamilyInitScript("design"));

    expect(document.documentElement.getAttribute("data-theme-family")).toBe(
      "original",
    );
  });

  it("lets a registered URL family override stored preferences before app mount", () => {
    window.localStorage.setItem("theme-family:calendar", "agent-native");
    window.history.replaceState(null, "", "/?theme-family=original");

    runThemeScript(
      getThemeFamilyInitScript("calendar", {
        families: ["original", "agent-native"],
        defaultFamily: "agent-native",
      }),
    );

    expect(document.documentElement.getAttribute("data-theme-family")).toBe(
      "original",
    );
    expect(window.localStorage.getItem("theme-family:calendar")).toBe(
      "agent-native",
    );
  });

  it("does not apply another app's local cache before scoped settings load", () => {
    window.localStorage.setItem("theme-family:calendar", "original");

    runThemeScript(getThemeFamilyInitScript());

    expect(document.documentElement.getAttribute("data-theme-family")).toBe(
      "original",
    );
    expect(
      document.documentElement.getAttribute("data-theme-family-status"),
    ).toBe("awaiting-app-setting");
  });

  it("marks invalid local theme-family storage explicitly", () => {
    window.localStorage.setItem("theme-family:calendar", "sepia");

    runThemeScript(getThemeFamilyInitScript("calendar"));

    expect(document.documentElement.getAttribute("data-theme-family")).toBe(
      "original",
    );
    expect(
      document.documentElement.getAttribute("data-theme-family-status"),
    ).toBe("invalid");
    expect(window.localStorage.getItem("theme-family:calendar")).toBe("sepia");
  });

  it("keeps Vite dev recovery deterministic in browsers without process", () => {
    const originalProcess = globalThis.process;
    vi.stubGlobal("process", undefined);

    try {
      expect(getThemeInitScript()).toContain("__an_optimize_reload");
    } finally {
      vi.stubGlobal("process", originalProcess);
    }
  });

  it("installs memory storage fallbacks in sandboxed frames", () => {
    const localStorageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "sessionStorage",
    );

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });

    try {
      expect(() => runThemeScript(getThemeInitScript("dark"))).not.toThrow();
      expect(window.localStorage.getItem("theme")).toBe(null);
      window.sessionStorage.setItem("scroll", "ok");
      expect(window.sessionStorage.getItem("scroll")).toBe("ok");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    } finally {
      if (localStorageDescriptor) {
        Object.defineProperty(window, "localStorage", localStorageDescriptor);
      }
      if (sessionStorageDescriptor) {
        Object.defineProperty(
          window,
          "sessionStorage",
          sessionStorageDescriptor,
        );
      }
    }
  });
});

describe("embedded theme updates", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.cssText = "";
  });

  it("normalizes the shared theme message and applies the root mode", () => {
    const update = parseEmbeddedThemeUpdate(
      buildEmbeddedThemeUpdate("dark", {
        "--background": "0 0% 13%",
        "--not-a-theme-token": "red",
      }),
    );

    expect(update).toEqual({
      theme: "dark",
      vars: { "--background": "0 0% 13%" },
    });

    applyEmbeddedThemeUpdate(document.documentElement, update!);

    expect(document.documentElement.className).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe("0 0% 13%");
  });

  it("keeps compatibility with the legacy isDark extension payload", () => {
    expect(
      parseEmbeddedThemeUpdate({
        type: "agent-native-theme-update",
        isDark: false,
      }),
    ).toEqual({ theme: "light" });
  });

  it("rejects unrelated or incomplete cross-window messages", () => {
    expect(
      parseEmbeddedThemeUpdate({ type: "other-message", isDark: true }),
    ).toBe(null);
    expect(
      parseEmbeddedThemeUpdate({ type: "agent-native-theme-update" }),
    ).toBe(null);
  });
});
