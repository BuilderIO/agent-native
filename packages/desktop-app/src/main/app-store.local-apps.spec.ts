import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "@shared/app-registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => electronState.userData,
  },
}));

import {
  addApp,
  isDesktopManagedApp,
  loadApps,
  markDesktopManagedApp,
  rememberLocalAppAutoName,
  removeApp,
  syncLocalAppNamesFromPackages,
  updateApp,
} from "./app-store";

function localApp(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    id: "local-weather-ab12cd34",
    name: "Weather app",
    icon: "Code",
    description: "make me a new app that tells me the weather",
    url: "",
    devPort: 5181,
    devUrl: "http://localhost:5181",
    devCommand: "pnpm exec agent-native dev --port 5181 --host 127.0.0.1",
    localPath: "/tmp/apps/weather",
    isBuiltIn: false,
    enabled: true,
    mode: "dev",
    ...overrides,
  };
}

describe("Desktop-built local apps in the sidebar", () => {
  beforeEach(() => {
    electronState.userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-native-local-apps-"),
    );
  });

  afterEach(() => {
    fs.rmSync(electronState.userData, { recursive: true, force: true });
  });

  it("keeps a registered local app, its dev server config and managed flag across a restart", () => {
    loadApps();
    addApp(localApp());
    markDesktopManagedApp("local-weather-ab12cd34", "/tmp/apps");

    vi.resetModules();
    const reloaded = loadApps().find(
      (candidate) => candidate.id === "local-weather-ab12cd34",
    );
    expect(reloaded).toMatchObject({
      mode: "dev",
      devUrl: "http://localhost:5181",
      localPath: "/tmp/apps/weather",
      enabled: true,
      isBuiltIn: false,
    });
    expect(isDesktopManagedApp("local-weather-ab12cd34")).toBe(true);
  });

  it("forgets the managed flag when the app is removed", () => {
    loadApps();
    addApp(localApp());
    markDesktopManagedApp("local-weather-ab12cd34", "/tmp/apps");
    removeApp("local-weather-ab12cd34");
    expect(isDesktopManagedApp("local-weather-ab12cd34")).toBe(false);
    expect(
      loadApps().some((candidate) => candidate.id === "local-weather-ab12cd34"),
    ).toBe(false);
  });

  it("adopts the name the coding agent writes to package.json", () => {
    loadApps();
    addApp(localApp());
    rememberLocalAppAutoName("local-weather-ab12cd34", "Weather app");

    expect(syncLocalAppNamesFromPackages(() => null)).toBe(false);
    expect(syncLocalAppNamesFromPackages(() => "Skies")).toBe(true);
    expect(
      loadApps().find((candidate) => candidate.id === "local-weather-ab12cd34")
        ?.name,
    ).toBe("Skies");

    expect(syncLocalAppNamesFromPackages(() => "Skies Weather")).toBe(true);
    expect(
      loadApps().find((candidate) => candidate.id === "local-weather-ab12cd34")
        ?.name,
    ).toBe("Skies Weather");
  });

  it("never replaces a name the person chose", () => {
    loadApps();
    addApp(localApp());
    rememberLocalAppAutoName("local-weather-ab12cd34", "Weather app");
    updateApp("local-weather-ab12cd34", { name: "My Forecast" });

    expect(syncLocalAppNamesFromPackages(() => "Skies")).toBe(false);
    expect(
      loadApps().find((candidate) => candidate.id === "local-weather-ab12cd34")
        ?.name,
    ).toBe("My Forecast");
  });
});
