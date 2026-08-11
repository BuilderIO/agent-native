import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => electronState.userData,
  },
}));

import {
  loadApps,
  loadDesktopAppPreferences,
  loadFrameSettings,
} from "./app-store";

describe("desktop app mode defaults", () => {
  beforeEach(() => {
    electronState.userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-native-app-modes-"),
    );
  });

  afterEach(() => {
    fs.rmSync(electronState.userData, { recursive: true, force: true });
  });

  it("defaults unpackaged apps and the shell to production", () => {
    const apps = loadApps();

    expect(apps.length).toBeGreaterThan(0);
    expect(apps.every((app) => app.mode === "prod")).toBe(true);
    expect(loadFrameSettings().mode).toBe("prod");
    expect(loadDesktopAppPreferences().appModeDefaultsVersion).toBe(1);
  });

  it("ignores a legacy dev frame mode", () => {
    fs.writeFileSync(
      path.join(electronState.userData, "frame-config.json"),
      JSON.stringify({ enabled: true, showCodeTab: true, mode: "dev" }),
    );

    expect(loadFrameSettings().mode).toBe("prod");
  });

  it("migrates implicit legacy dev defaults without changing custom choices", () => {
    const initialApps = loadApps();
    const customApp = {
      ...initialApps[0],
      id: "custom-local-app",
      name: "Custom local app",
      isBuiltIn: false,
      mode: "dev" as const,
    };
    const legacyApps = [
      ...initialApps.map((app) => ({ ...app, mode: "dev" as const })),
      customApp,
    ];
    fs.writeFileSync(
      path.join(electronState.userData, "app-config.json"),
      JSON.stringify(legacyApps),
    );
    fs.rmSync(
      path.join(electronState.userData, "desktop-app-preferences.json"),
    );

    const migrated = loadApps();

    expect(
      migrated
        .filter((app) => app.isBuiltIn)
        .every((app) => app.mode === "prod"),
    ).toBe(true);
    expect(migrated.find((app) => app.id === customApp.id)?.mode).toBe("dev");
  });
});
