import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _resetSettingsReturnPathForTests,
  readSettingsReturnPath,
  rememberSettingsReturnPath,
} from "./return-path.js";

const storage = new Map<string, string>();

function stubWindow(pathname: string) {
  vi.stubGlobal("window", {
    location: { pathname },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  storage.clear();
  _resetSettingsReturnPathForTests();
});

describe("settings return path on a mounted app", () => {
  // Escape from Settings landed on /calendar-app/calendar-app/home because the
  // remembered path already carried the mount and every reader applied it again.
  it("stores the app-local route so a reader cannot double the mount", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/calendar-app");
    stubWindow("/calendar-app/home");
    rememberSettingsReturnPath("/calendar-app/home", "?view=week");
    expect(readSettingsReturnPath()).toBe("/home?view=week");
  });

  it("ignores a settings route that carries the mount", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/calendar-app");
    stubWindow("/calendar-app/settings/calendar-accounts");
    rememberSettingsReturnPath("/calendar-app/settings/calendar-accounts");
    expect(readSettingsReturnPath()).toBeNull();
  });

  it("strips a mount an earlier build left in storage", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/calendar-app");
    stubWindow("/calendar-app/settings");
    storage.set("agent-native:settings-return-path", "/calendar-app/home");
    expect(readSettingsReturnPath()).toBe("/home");
  });

  it("leaves a root-mounted app's route as it is", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "");
    stubWindow("/library");
    rememberSettingsReturnPath("/library", "?view=grid");
    expect(readSettingsReturnPath()).toBe("/library?view=grid");
  });
});
