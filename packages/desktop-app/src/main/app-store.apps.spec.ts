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
    expect(apps.some((app) => app.id === "chat")).toBe(false);
    expect(apps.every((app) => app.mode === "prod")).toBe(true);
    expect(loadFrameSettings().mode).toBe("prod");
    expect(loadDesktopAppPreferences().appModeDefaultsVersion).toBe(1);
  });

  it("removes the generic chat starter from an existing desktop config", () => {
    const initialApps = loadApps();
    fs.writeFileSync(
      path.join(electronState.userData, "app-config.json"),
      JSON.stringify([
        ...initialApps,
        {
          ...initialApps[0],
          id: "chat",
          name: "Chat",
          isBuiltIn: true,
        },
      ]),
    );

    const migrated = loadApps();

    expect(migrated.some((app) => app.id === "chat")).toBe(false);
  });

  it("ignores a legacy dev frame mode", () => {
    fs.writeFileSync(
      path.join(electronState.userData, "frame-config.json"),
      JSON.stringify({ enabled: true, showCodeTab: true, mode: "dev" }),
    );

    expect(loadFrameSettings().mode).toBe("prod");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(electronState.userData, "frame-config.json"),
          "utf8",
        ),
      ).mode,
    ).toBe("prod");
  });

  it("preserves explicit built-in dev choices during defaults migration", () => {
    const initialApps = loadApps();
    const customApp = {
      ...initialApps[0],
      id: "custom-local-app",
      name: "Custom local app",
      isBuiltIn: false,
      mode: "dev" as const,
    };
    const legacyApps = [{ ...initialApps[0], mode: "dev" as const }, customApp];
    fs.writeFileSync(
      path.join(electronState.userData, "app-config.json"),
      JSON.stringify(legacyApps),
    );
    fs.rmSync(
      path.join(electronState.userData, "desktop-app-preferences.json"),
    );

    const migrated = loadApps();

    expect(migrated.find((app) => app.id === initialApps[0].id)?.mode).toBe(
      "dev",
    );
    expect(migrated.find((app) => app.id === customApp.id)?.mode).toBe("dev");
    expect(loadDesktopAppPreferences().appModeDefaultsVersion).toBe(1);
  });

  it("preserves explicit custom workspace SSO opt-in in the persisted app config", () => {
    const initialApps = loadApps();
    const customApp = {
      ...initialApps[0],
      id: "custom-workspace-app",
      name: "Custom workspace app",
      isBuiltIn: false,
      workspaceSso: true,
      mode: "prod" as const,
    };
    fs.writeFileSync(
      path.join(electronState.userData, "app-config.json"),
      JSON.stringify([customApp]),
    );

    expect(
      loadApps().find((app) => app.id === customApp.id)?.workspaceSso,
    ).toBe(true);
  });

  it("normalizes legacy harness flags before recording the mode migration", () => {
    const initialApps = loadApps();
    const legacyApps = [
      {
        ...initialApps[0],
        mode: undefined,
        useCliHarness: true,
      },
      {
        ...initialApps[1],
        mode: undefined,
        useCliHarness: false,
      },
    ];
    fs.writeFileSync(
      path.join(electronState.userData, "app-config.json"),
      JSON.stringify(legacyApps),
    );
    fs.rmSync(
      path.join(electronState.userData, "desktop-app-preferences.json"),
    );

    const migrated = loadApps();

    expect(migrated.find((app) => app.id === initialApps[0].id)?.mode).toBe(
      "dev",
    );
    expect(migrated.find((app) => app.id === initialApps[1].id)?.mode).toBe(
      "prod",
    );
    expect(loadDesktopAppPreferences().appModeDefaultsVersion).toBe(1);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(electronState.userData, "app-config.json"),
          "utf8",
        ),
      ).every((app: Record<string, unknown>) => !("useCliHarness" in app)),
    ).toBe(true);
  });
});
