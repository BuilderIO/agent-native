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
    let apps = JSON.parse(raw) as AppConfig[];
    // Migrations
    let migrated = false;

    // Build a lookup of canonical built-in app defaults by id
    const defaultsById = new Map(DEFAULT_APPS.map((d) => [d.id, d]));
    const persistedIds = new Set(apps.map((a) => a.id));

    // Remove stale built-in apps that no longer exist in DEFAULT_APPS
    const before = apps.length;
    apps = apps.filter((a) => !a.isBuiltIn || defaultsById.has(a.id));
    if (apps.length !== before) migrated = true;

    // Add new built-in apps that aren't in the persisted config
    for (const def of DEFAULT_APPS) {
      if (!persistedIds.has(def.id)) {
        apps.push({ ...def });
        migrated = true;
      }
    }

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

      // Sync built-in app fields with latest defaults
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
        if (def.icon !== app.icon) {
          app.icon = def.icon;
          migrated = true;
        }
        if (def.name !== app.name) {
          app.name = def.name;
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
