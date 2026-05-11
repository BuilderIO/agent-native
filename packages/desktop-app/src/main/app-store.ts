import { app } from "electron";
import fs from "fs";
import path from "path";
import { DEFAULT_APPS, type AppConfig } from "@agent-native/shared-app-config";

const STORE_FILE = "app-config.json";
const FRAME_STORE_FILE = "frame-config.json";

/** Settings for the local dev frame */
export interface FrameSettings {
  /** Whether the frame is enabled */
  enabled: boolean;
  /** Load frame from localhost (dev) or production URL (prod) */
  mode: "dev" | "prod";
  /** Production URL for the frame (if deployed) */
  prodUrl?: string;
}

function defaultFrameSettings(): FrameSettings {
  return {
    enabled: true,
    mode: app.isPackaged ? "prod" : "dev",
  };
}

function defaultApps(): AppConfig[] {
  return DEFAULT_APPS.map((def) => ({
    ...def,
    mode: app.isPackaged ? (def.mode ?? "prod") : "dev",
  }));
}

function canonicalizeDefaultApp(appConfig: AppConfig, def: AppConfig) {
  // Preserve everything the user can edit in the settings dialog. Only
  // structural fields the user can't edit (id, icon, isBuiltIn, placeholder)
  // and template-canonical metadata (color) come from `def`. Without this,
  // every restart wipes user-edited devUrl/url/name/etc. back to defaults.
  return {
    ...def,
    enabled: appConfig.enabled ?? def.enabled,
    mode: appConfig.mode ?? def.mode,
    name: appConfig.name || def.name,
    description: appConfig.description || def.description,
    url: appConfig.url ?? def.url,
    devUrl: appConfig.devUrl ?? def.devUrl,
    devCommand: appConfig.devCommand ?? def.devCommand,
    devPort: appConfig.devPort || def.devPort,
  };
}

function getFrameStorePath(): string {
  return path.join(app.getPath("userData"), FRAME_STORE_FILE);
}

export function loadFrameSettings(): FrameSettings {
  try {
    const raw = fs.readFileSync(getFrameStorePath(), "utf-8");
    return { ...defaultFrameSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultFrameSettings();
  }
}

export function saveFrameSettings(
  settings: Partial<FrameSettings>,
): FrameSettings {
  const current = loadFrameSettings();
  const updated = { ...current, ...settings };
  fs.writeFileSync(
    getFrameStorePath(),
    JSON.stringify(updated, null, 2),
    "utf-8",
  );
  return updated;
}

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
    const defaults = defaultApps();
    const defaultsById = new Map(defaults.map((d) => [d.id, d]));
    const persistedIds = new Set(apps.map((a) => a.id));

    // Remove stale built-in apps that no longer exist in DEFAULT_APPS
    const before = apps.length;
    apps = apps.filter((a) => !a.isBuiltIn || defaultsById.has(a.id));
    if (apps.length !== before) migrated = true;

    // Add new built-in apps that aren't in the persisted config
    for (const def of defaults) {
      if (!persistedIds.has(def.id)) {
        apps.push({ ...def });
        migrated = true;
      }
    }

    for (let i = 0; i < apps.length; i++) {
      const app = apps[i];
      // Migrate legacy useCliHarness field → mode
      if ((app as any).useCliHarness !== undefined) {
        app.mode = (app as any).useCliHarness ? "dev" : "prod";
        delete (app as any).useCliHarness;
        migrated = true;
      }
      if (app.mode === undefined) {
        app.mode = "prod";
        migrated = true;
      }

      // Sync any app whose id matches a default back to canonical built-in
      // metadata. Older persisted configs could keep stale placeholder/URL
      // fields and leave apps such as Starter or Dispatch non-rendering.
      const def = defaultsById.get(app.id);
      if (def) {
        const canonical = canonicalizeDefaultApp(app, def);
        if (JSON.stringify(app) !== JSON.stringify(canonical)) {
          apps[i] = canonical;
          migrated = true;
        }
      }
    }
    if (migrated) saveApps(apps);
    return apps;
  } catch {
    // First launch or corrupted — seed with defaults
    const apps = defaultApps();
    saveApps(apps);
    return apps;
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
  const apps = defaultApps();
  saveApps(apps);
  return apps;
}
