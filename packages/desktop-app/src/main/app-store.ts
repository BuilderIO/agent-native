import { app } from "electron";
import fs from "fs";
import path from "path";
import { DEFAULT_APPS, type AppConfig } from "@agent-native/shared-app-config";

const STORE_FILE = "app-config.json";

function getStorePath(): string {
  return path.join(app.getPath("userData"), STORE_FILE);
}

export function loadApps(): AppConfig[] {
  try {
    const raw = fs.readFileSync(getStorePath(), "utf-8");
    const apps = JSON.parse(raw) as AppConfig[];
    // Migrate: default useCliHarness to true for existing configs
    let migrated = false;
    for (const app of apps) {
      if (app.useCliHarness === undefined) {
        app.useCliHarness = true;
        migrated = true;
      }
    }
    if (migrated) saveApps(apps);
    return apps;
  } catch {
    // First launch or corrupted — seed with defaults
    saveApps(DEFAULT_APPS);
    return DEFAULT_APPS;
  }
}

export function saveApps(apps: AppConfig[]): void {
  fs.writeFileSync(getStorePath(), JSON.stringify(apps, null, 2), "utf-8");
}

export function addApp(newApp: AppConfig): AppConfig[] {
  const apps = loadApps();
  apps.push(newApp);
  saveApps(apps);
  return apps;
}

export function removeApp(id: string): AppConfig[] {
  const apps = loadApps().filter((a) => a.id !== id);
  saveApps(apps);
  return apps;
}

export function updateApp(
  id: string,
  updates: Partial<AppConfig>,
): AppConfig[] {
  const apps = loadApps();
  const idx = apps.findIndex((a) => a.id === id);
  if (idx !== -1) {
    apps[idx] = { ...apps[idx], ...updates };
    saveApps(apps);
  }
  return apps;
}

export function resetToDefaults(): AppConfig[] {
  saveApps(DEFAULT_APPS);
  return DEFAULT_APPS;
}
