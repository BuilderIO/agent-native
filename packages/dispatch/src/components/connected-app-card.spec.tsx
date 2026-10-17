// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectedAppSummary } from "../lib/other-apps";
import { ConnectedAppCard } from "./connected-app-card";

vi.mock("./app-icon", () => ({ AppIcon: () => null }));
vi.mock("./app-open-actions", () => ({
  AppOpenActions: ({ name, href }: { name: string; href: string }) =>
    React.createElement(
      "a",
      { className: "app-open-actions__primary", href },
      name,
    ),
}));

const app: ConnectedAppSummary = {
  id: "clips",
  name: "Clips",
  url: "https://clips.agent-native.com",
  homeUrl: "https://clips.agent-native.com/home",
  source: "builtin",
};
const navigation = vi.hoisted(() => ({
  navigate: vi.fn(() => true),
  shouldOpenInTopWindow: vi.fn(() => false),
}));

vi.mock("../lib/workspace-apps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/workspace-apps")>()),
  navigateToWorkspaceApp: navigation.navigate,
  shouldOpenWorkspaceAppInTopWindow: navigation.shouldOpenInTopWindow,
}));

describe("ConnectedAppCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    navigation.navigate.mockClear();
    navigation.navigate.mockReturnValue(true);
    navigation.shouldOpenInTopWindow.mockReturnValue(false);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps a native link unless the host surface needs custom navigation", async () => {
    await act(async () => {
      root.render(<ConnectedAppCard app={app} />);
    });

    const anchor = container.querySelector<HTMLAnchorElement>(
      ".app-open-actions__primary",
    );
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toContain(
      "https://clips.agent-native.com/home",
    );
  });

  it("opens built-in app actions through the host window on primary clicks", async () => {
    navigation.shouldOpenInTopWindow.mockReturnValue(true);
    await act(async () => {
      root.render(<ConnectedAppCard app={app} />);
    });

    const anchor = container.querySelector<HTMLAnchorElement>(
      ".app-open-actions__primary",
    );
    expect(anchor).not.toBeNull();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor?.dispatchEvent(click);

    expect(navigation.navigate).toHaveBeenCalledWith(anchor?.href);
    expect(navigation.navigate.mock.calls[0][0]).toContain(
      "https://clips.agent-native.com/home",
    );
    expect(click.defaultPrevented).toBe(true);

    const modifiedClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    anchor?.dispatchEvent(modifiedClick);

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(modifiedClick.defaultPrevented).toBe(false);
  });
});
