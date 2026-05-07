import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_APPS,
  TEMPLATES,
  type AppConfig,
} from "@agent-native/shared-app-config";

const STORAGE_KEY = "agent-native:apps";

function migrateApps(apps: AppConfig[]): {
  apps: AppConfig[];
  changed: boolean;
} {
  let changed = false;
  const defaultsById = new Map(DEFAULT_APPS.map((app) => [app.id, app]));
  const firstPartyIds = new Set(TEMPLATES.map((template) => template.name));

  const migrated = apps.filter((app) => {
    const isStaleFirstParty =
      firstPartyIds.has(app.id) &&
      !defaultsById.has(app.id) &&
      app.isBuiltIn !== false;
    if (isStaleFirstParty) {
      changed = true;
      return false;
    }
    return true;
  });

  const persistedIds = new Set(migrated.map((app) => app.id));
  for (const def of DEFAULT_APPS) {
    if (!persistedIds.has(def.id)) {
      migrated.push({ ...def });
      changed = true;
    }
  }

  for (const app of migrated) {
    const def = defaultsById.get(app.id);
    if (!def || app.isBuiltIn === false) continue;

    if (app.isBuiltIn !== true) {
      app.isBuiltIn = true;
      changed = true;
    }
    if (app.url !== def.url) {
      app.url = def.url;
      changed = true;
    }
    if (app.devUrl !== def.devUrl) {
      app.devUrl = def.devUrl;
      changed = true;
    }
    if (app.icon !== def.icon) {
      app.icon = def.icon;
      changed = true;
    }
    if (app.name !== def.name) {
      app.name = def.name;
      changed = true;
    }
    if (app.mode === undefined) {
      app.mode = def.mode ?? "prod";
      changed = true;
    }
  }

  return { apps: migrated, changed };
}

export async function getApps(): Promise<AppConfig[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    // First launch — seed with defaults
    await saveApps(DEFAULT_APPS);
    return DEFAULT_APPS;
  }
  const parsed = JSON.parse(raw) as AppConfig[];
  const { apps, changed } = migrateApps(parsed);
  if (changed) await saveApps(apps);
  return apps;
}

export async function saveApps(apps: AppConfig[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
}

export async function addApp(app: AppConfig): Promise<void> {
  const apps = await getApps();
  apps.push(app);
  await saveApps(apps);
}

export async function removeApp(id: string): Promise<void> {
  const apps = await getApps();
  await saveApps(apps.filter((a) => a.id !== id));
}

export async function updateApp(
  id: string,
  updates: Partial<AppConfig>,
): Promise<void> {
  const apps = await getApps();
  const idx = apps.findIndex((a) => a.id === id);
  if (idx !== -1) {
    apps[idx] = { ...apps[idx], ...updates };
    await saveApps(apps);
  }
}

export async function resetToDefaults(): Promise<void> {
  await saveApps(DEFAULT_APPS);
}
