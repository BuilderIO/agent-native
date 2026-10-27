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

import { THEME_FAMILY_ATTRIBUTE } from "../appearance/theme-family.js";
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
});
