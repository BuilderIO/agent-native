// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useHref, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSettingsShortcutHint,
  isSettingsRoutePath,
  isSettingsShortcutEvent,
  openSettingsPage,
  SettingsShortcut,
} from "./use-settings-shortcut.js";

function pressSettingsShortcut(
  target: EventTarget = document.body,
  init: KeyboardEventInit = { metaKey: true },
) {
  const event = new KeyboardEvent("keydown", {
    key: ",",
    code: "Comma",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("isSettingsShortcutEvent", () => {
  const base = {
    key: ",",
    code: "Comma",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  };

  it("matches Cmd+, and Ctrl+, from either key representation", () => {
    expect(isSettingsShortcutEvent({ ...base, metaKey: true })).toBe(true);
    expect(isSettingsShortcutEvent({ ...base, ctrlKey: true })).toBe(true);
    expect(
      isSettingsShortcutEvent({ ...base, key: "Unidentified", ctrlKey: true }),
    ).toBe(true);
  });

  it("ignores a bare comma and other modifier combinations", () => {
    expect(isSettingsShortcutEvent(base)).toBe(false);
    expect(
      isSettingsShortcutEvent({ ...base, metaKey: true, shiftKey: true }),
    ).toBe(false);
    expect(
      isSettingsShortcutEvent({ ...base, metaKey: true, altKey: true }),
    ).toBe(false);
    expect(
      isSettingsShortcutEvent({
        ...base,
        key: "k",
        code: "KeyK",
        metaKey: true,
      }),
    ).toBe(false);
  });
});

describe("settings shortcut helpers", () => {
  it("recognizes the Settings route and its sub-pages only", () => {
    expect(isSettingsRoutePath("/settings")).toBe(true);
    expect(isSettingsRoutePath("/settings/integrations")).toBe(true);
    expect(isSettingsRoutePath("/settings-archive")).toBe(false);
    expect(isSettingsRoutePath("/home")).toBe(false);
  });

  it("formats the hint for each platform", () => {
    expect(getSettingsShortcutHint(true)).toBe("⌘,");
    expect(getSettingsShortcutHint(false)).toBe("Ctrl+,");
  });
});

describe("useSettingsShortcut", () => {
  let container: HTMLDivElement;
  let root: Root;
  let pathname = "";
  let browserPath = "";
  let locationKeys = new Set<string>();

  function LocationProbe() {
    const location = useLocation();
    pathname = location.pathname;
    browserPath = useHref(location.pathname);
    locationKeys.add(location.key);
    return null;
  }

  function renderAt(path: string, instances = 1, basename?: string) {
    act(() => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: [path], basename },
          ...Array.from({ length: instances }, (_, index) =>
            React.createElement(SettingsShortcut, { key: index }),
          ),
          React.createElement(LocationProbe),
        ),
      );
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    pathname = "";
    browserPath = "";
    locationKeys = new Set();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens Settings from any page and claims the key", () => {
    renderAt("/home");

    const event = pressSettingsShortcut();

    expect(event.defaultPrevented).toBe(true);
    expect(pathname).toBe("/settings/account");
  });

  it("works while focus is in an input", () => {
    renderAt("/deck/1");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = pressSettingsShortcut(input, { ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(pathname).toBe("/settings/account");
  });

  it("claims the key but stays put on a Settings route", () => {
    renderAt("/settings/integrations");

    const event = pressSettingsShortcut();

    expect(event.defaultPrevented).toBe(true);
    expect(pathname).toBe("/settings/integrations");
  });

  it("leaves unrelated shortcuts alone", () => {
    renderAt("/home");

    const event = pressSettingsShortcut(document.body, {
      metaKey: true,
      shiftKey: true,
    });

    expect(event.defaultPrevented).toBe(false);
    expect(pathname).toBe("/home");
  });

  it("adds the app base path of a workspace mount once", () => {
    window.history.replaceState(null, "", "/dispatch/_agent-native/poll");
    renderAt("/dispatch/overview", 1, "/dispatch");

    pressSettingsShortcut();

    expect(pathname).toBe("/settings/account");
    expect(browserPath).toBe("/dispatch/settings/account");
  });

  it("stays put on a Settings route of a workspace mount", () => {
    window.history.replaceState(null, "", "/dispatch/_agent-native/poll");
    renderAt("/dispatch/settings/integrations", 1, "/dispatch");
    const keysBefore = locationKeys.size;

    const event = pressSettingsShortcut();

    expect(event.defaultPrevented).toBe(true);
    expect(pathname).toBe("/settings/integrations");
    expect(browserPath).toBe("/dispatch/settings/integrations");
    expect(locationKeys.size).toBe(keysBefore);
  });

  it("navigates once when mounted twice", () => {
    renderAt("/home", 2);

    pressSettingsShortcut();

    expect(pathname).toBe("/settings/account");
    expect(locationKeys.size).toBe(2);
  });

  it("routes openSettingsPage through the router, naming a page", () => {
    renderAt("/home");
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => undefined);

    act(() => openSettingsPage("integrations"));

    expect(pathname).toBe("/settings/integrations");
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("openSettingsPage without a mounted shortcut", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the Settings page directly instead of doing nothing", () => {
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => undefined);

    openSettingsPage();

    expect(assign).toHaveBeenCalledWith("/settings/account");
  });

  it("keeps the app base path of a workspace mount in the direct load", () => {
    window.history.replaceState(null, "", "/dispatch/_agent-native/poll");
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => undefined);

    try {
      openSettingsPage("integrations");
    } finally {
      window.history.replaceState(null, "", "/");
    }

    expect(assign).toHaveBeenCalledWith("/dispatch/settings/integrations");
  });
});
