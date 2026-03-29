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
    // Migrations
    let migrated = false;

    // Build a lookup of canonical built-in app defaults by id
    const defaultsById = new Map(DEFAULT_APPS.map((d) => [d.id, d]));

    for (const app of apps) {
      // Migrate: useCliHarness → mode
      if ((app as any).useCliHarness !== undefined) {
        app.mode = (app as any).useCliHarness ? "dev" : "prod";
        delete (app as any).useCliHarness;
        migrated = true;
      }
      if (app.mode === undefined) {
        app.mode = "prod";
        migrated = true;
      }

      // Sync built-in app URLs with latest defaults (handles domain changes)
      const def = defaultsById.get(app.id);
      if (def && app.isBuiltIn) {
        if (def.url && app.url !== def.url) {
          app.url = def.url;
          migrated = true;
        }
        if (def.devUrl && app.devUrl !== def.devUrl) {
          app.devUrl = def.devUrl;
          migrated = true;
        }
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
