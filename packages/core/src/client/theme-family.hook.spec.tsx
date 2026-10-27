// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  appId: "sample-app",
  appConfig: {
    themeFamily: {
      families: ["original", "agent-native"] as const,
      defaultFamily: "original" as const,
    },
  },
  appStateVersion: 0,
  readClientAppState: vi.fn(async () => ({ family: "agent-native" })),
  query: {
    data: {
      family: "original",
      source: "default",
      appId: "sample-app",
    },
    isError: false,
    isSuccess: true,
    error: undefined,
    refetch: vi.fn(),
  },
  mutation: { mutateAsync: vi.fn() },
}));

vi.mock("./app-config.js", () => ({
  injectedAgentNativeAppId: () => deps.appId,
  injectedAgentNativeConfig: () => deps.appConfig,
}));
vi.mock("./application-state.js", () => ({
  readClientAppState: deps.readClientAppState,
}));
vi.mock("./use-action.js", () => ({
  useActionMutation: () => deps.mutation,
  useActionQuery: () => deps.query,
}));
vi.mock("./use-change-version.js", () => ({
  useChangeVersion: () => deps.appStateVersion,
}));

import {
  THEME_FAMILY_ATTRIBUTE,
  THEME_FAMILY_STATUS_ATTRIBUTE,
} from "../appearance/theme-family.js";
import { useThemeFamily, type ThemeFamilyHook } from "./theme-family.js";

describe("useThemeFamily", () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;
  let current: ThemeFamilyHook | undefined;

  function Probe() {
    current = useThemeFamily();
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    document.documentElement.removeAttribute(THEME_FAMILY_ATTRIBUTE);
    deps.query.data = {
      family: "original",
      source: "default",
      appId: "sample-app",
    };
    deps.query.refetch.mockReset();
    deps.mutation.mutateAsync.mockReset();
    deps.appStateVersion = 0;
    deps.readClientAppState.mockReset();
    deps.readClientAppState.mockResolvedValue({ family: "agent-native" });
    current = undefined;
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  it("changes only the family attribute without changing application DOM", async () => {
    deps.mutation.mutateAsync.mockResolvedValue({
      family: "agent-native",
      appId: "sample-app",
    });

    function AppSurface() {
      current = useThemeFamily();
      return (
        <main>
          <h1>Workspace</h1>
          <button type="button">Open settings</button>
        </main>
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<AppSurface />));

    const before = container.innerHTML;
    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "original",
    );

    await act(async () => {
      await current?.setFamily("agent-native");
    });

    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "agent-native",
    );
    expect(container.innerHTML).toBe(before);
  });

  it("keeps the persisted family selected when app-state sync fails", async () => {
    deps.query.data = {
      family: "agent-native",
      source: "user-setting",
      appId: "sample-app",
    };
    deps.mutation.mutateAsync.mockRejectedValue(
      new Error("The theme family was saved, but app state sync failed."),
    );
    deps.query.refetch.mockResolvedValue({
      data: {
        family: "original",
        source: "user-setting",
        appId: "sample-app",
      },
      isError: false,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Probe />));

    let failure: unknown;
    await act(async () => {
      try {
        await current?.setFamily("original");
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeInstanceOf(Error);
    expect(current?.family).toBe("original");
    expect(window.localStorage.getItem("theme-family:sample-app")).toBe(
      "original",
    );
    expect(deps.query.refetch).toHaveBeenCalledOnce();
  });

  it("applies a theme-family change from app state outside Preferences", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Probe />));

    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "original",
    );

    deps.appStateVersion = 1;
    await act(async () => {
      root?.render(<Probe />);
      await Promise.resolve();
    });

    expect(deps.readClientAppState).toHaveBeenCalledWith(
      "theme-family:73_61_6d_70_6c_65_2d_61_70_70",
    );
    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "agent-native",
    );
  });

  it("keeps a URL-pinned family ahead of saved preferences and blocks changes", async () => {
    deps.query.data = {
      family: "agent-native",
      source: "user-setting",
      appId: "sample-app",
    };
    window.history.replaceState(null, "", "/?theme-family=original");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root?.render(<Probe />));

    expect(current?.family).toBe("original");
    expect(current?.isForcedByUrl).toBe(true);
    expect(current?.status).toBe("success");
    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "original",
    );

    await expect(current?.setFamily("agent-native")).rejects.toThrow(
      "pinned by the URL parameter",
    );
    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "original",
    );
    expect(deps.mutation.mutateAsync).not.toHaveBeenCalled();
    window.localStorage.setItem("theme-family:sample-app", "agent-native");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme-family:sample-app" }),
    );
    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "original",
    );
  });

  it("updates URL pins on client-side history navigation", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Probe />));

    act(() =>
      window.history.pushState(null, "", "/?theme-family=agent-native"),
    );
    expect(current?.family).toBe("agent-native");
    expect(current?.isForcedByUrl).toBe(true);
    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "agent-native",
    );

    act(() => window.history.replaceState(null, "", "/"));
    expect(window.location.search).toBe("");
    expect(current?.isForcedByUrl).toBe(false);
    expect(current?.family).toBe("original");
    expect(document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE)).toBe(
      "original",
    );
  });

  it("tracks a URL pin when navigation keeps the selected family unchanged", async () => {
    deps.mutation.mutateAsync.mockResolvedValue({
      family: "agent-native",
      appId: "sample-app",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Probe />));

    expect(current?.family).toBe("original");
    expect(current?.isForcedByUrl).toBe(false);

    act(() => window.history.replaceState(null, "", "/?theme-family=original"));
    expect(current?.family).toBe("original");
    expect(current?.isForcedByUrl).toBe(true);
    await expect(current?.setFamily("agent-native")).rejects.toThrow(
      "pinned by the URL parameter",
    );
    expect(deps.mutation.mutateAsync).not.toHaveBeenCalled();

    act(() => window.history.replaceState(null, "", "/"));
    expect(current?.isForcedByUrl).toBe(false);
    await act(async () => {
      await current?.setFamily("agent-native");
    });
    expect(deps.mutation.mutateAsync).toHaveBeenCalledWith({
      family: "agent-native",
    });
  });

  it("preserves the current family when storage becomes unreadable on navigation", async () => {
    deps.query.data = {
      family: "agent-native",
      source: "user-setting",
      appId: "sample-app",
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Probe />));

    const storageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Storage access is blocked");
      },
    });

    try {
      act(() => window.history.pushState(null, "", "/preferences"));

      expect(current?.family).toBe("agent-native");
      expect(
        document.documentElement.getAttribute(THEME_FAMILY_ATTRIBUTE),
      ).toBe("agent-native");
      expect(
        document.documentElement.getAttribute(THEME_FAMILY_STATUS_ATTRIBUTE),
      ).toBe("unreadable");
      expect(current?.storageStatus).toBe("unreadable");
    } finally {
      if (storageDescriptor) {
        Object.defineProperty(window, "localStorage", storageDescriptor);
      }
    }
  });

  it("reconciles a failed save from a missing setting to the app default", async () => {
    deps.appConfig = {
      themeFamily: {
        families: ["original", "agent-native"],
        defaultFamily: "agent-native",
      },
    };
    deps.query.data = {
      family: "original",
      source: "default",
      appId: "sample-app",
    };
    deps.mutation.mutateAsync.mockRejectedValue(new Error("save failed"));
    deps.query.refetch.mockResolvedValue({
      data: {
        family: "original",
        source: "default",
        appId: "sample-app",
      },
      isError: false,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Probe />));

    await act(async () => {
      await expect(current?.setFamily("original")).rejects.toThrow(
        "save failed",
      );
    });

    expect(current?.family).toBe("agent-native");
    expect(window.localStorage.getItem("theme-family:sample-app")).toBe(
      "agent-native",
    );
  });
});
