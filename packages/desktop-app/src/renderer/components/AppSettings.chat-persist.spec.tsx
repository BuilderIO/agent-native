// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readDesktopChatPreferences,
  writeDesktopChatPreferences,
} from "../lib/desktop-chat-preferences.js";
import AppSettings from "./AppSettings.js";

vi.mock("@agent-native/toolkit/app/agent-page/AgentTabsPage", () => ({
  ConnectionsTab: () => null,
}));

vi.mock("./CodeProviderSettings", () => ({
  CodeProviderSettings: () => null,
}));

vi.mock("./UpdateIndicator.js", () => ({
  useUpdateStatus: () => ({ state: "idle" }),
}));

describe("AppSettings reset chat when switching apps toggle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    writeDesktopChatPreferences({ resetChatOnAppSwitch: false });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("electronAPI", {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders the toggle off by default and persists changes", async () => {
    await act(async () => {
      root.render(
        <AppSettings
          apps={[]}
          onClose={vi.fn()}
          onAppsChanged={vi.fn()}
          initialTab="general"
        />,
      );
      await Promise.resolve();
    });

    const toggle = container.querySelector(
      '[aria-label="Reset chat when switching apps"]',
    ) as HTMLElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(readDesktopChatPreferences().resetChatOnAppSwitch).toBe(false);

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(readDesktopChatPreferences().resetChatOnAppSwitch).toBe(true);
  });
});
