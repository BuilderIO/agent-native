import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_APPS, type AppConfig } from "@agent-native/shared-app-config";

const STORAGE_KEY = "agent-native:apps";

export async function getApps(): Promise<AppConfig[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    // First launch — seed with defaults
    await saveApps(DEFAULT_APPS);
    return DEFAULT_APPS;
  }
  return JSON.parse(raw) as AppConfig[];
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
