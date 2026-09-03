import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        },
      ),
    },
    handlers,
  };
});

vi.mock("electron", () => ({
  ipcMain: electronState.ipcMain,
}));

const appStoreState = vi.hoisted(() => ({
  saveDesktopAppPreferences: vi.fn(),
}));

vi.mock("../app-store", () => appStoreState);

import { IPC } from "@shared/ipc-channels";

import { registerAppsIpc, type AppsIpcDeps } from "./apps.js";

describe("APPS_UPDATE_CREATION_SETTINGS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronState.handlers.clear();
  });

  function register(overrides: Partial<AppsIpcDeps> = {}) {
    const deps: AppsIpcDeps = {
      getManagedDesktopAppIds: vi.fn(() => []),
      stopManagedDesktopApp: vi.fn(),
      refreshDesktopShortcutBindings: vi.fn(),
      chooseLocalAppFolder: vi.fn(),
      desktopAppCreationSettings: vi.fn(() => ({
        appsRoot: "/Users/steve/apps",
      })),
      normalizeDesktopAppsRoot: vi.fn(() => null),
      createDesktopAppFromPrompt: vi.fn(),
      prepareDesktopAppForLocalCodeChange: vi.fn(),
      showDesktopAppContextMenu: vi.fn(),
      ...overrides,
    };
    registerAppsIpc(deps);
    const handler = electronState.handlers.get(
      IPC.APPS_UPDATE_CREATION_SETTINGS,
    );
    if (!handler) throw new Error("handler not registered");
    return handler;
  }

  it("returns ok:false with an error when the root is rejected, not the stale settings alone", async () => {
    const handler = register({
      desktopAppCreationSettings: vi.fn(() => ({
        appsRoot: "/Users/steve/apps",
      })),
      normalizeDesktopAppsRoot: vi.fn(() => null),
    });

    const result = await handler({}, { appsRoot: "/" });

    expect(result).toEqual({
      ok: false,
      error: expect.any(String),
      settings: { appsRoot: "/Users/steve/apps" },
    });
    // The rejected input must never surface as the saved root.
    expect(
      (result as { settings: { appsRoot: string } }).settings.appsRoot,
    ).not.toBe("/");
    expect(appStoreState.saveDesktopAppPreferences).not.toHaveBeenCalled();
  });

  it("returns ok:true and persists the normalized root when it is accepted", async () => {
    const handler = register({
      desktopAppCreationSettings: vi.fn(() => ({
        appsRoot: "/Users/steve/apps",
      })),
      normalizeDesktopAppsRoot: vi.fn(() => "/Users/steve/new-apps"),
    });

    const result = await handler({}, { appsRoot: "/Users/steve/new-apps" });

    expect(result).toEqual({
      ok: true,
      settings: { appsRoot: "/Users/steve/new-apps" },
    });
    expect(appStoreState.saveDesktopAppPreferences).toHaveBeenCalledWith({
      appsRoot: "/Users/steve/new-apps",
    });
  });
});
