import fs from "fs";
import { randomUUID } from "node:crypto";
import path from "path";

import {
  DESKTOP_DEFAULT_APPS,
  TEMPLATE_APPS,
  sortDesktopApps,
  type AppConfig,
  type FrameSettings,
} from "@shared/app-registry";
import {
  normalizeDesktopShortcutAccelerator,
  type DesktopShortcutBehavior,
  type DesktopShortcutBinding,
  type DesktopShortcutUpsertRequest,
} from "@shared/desktop-shortcuts";
import type {
  CodeAgentProviderCredentialKey,
  CodeAgentProviderSettings,
  CodeAgentProviderSettingsUpdate,
  CodeAgentProviderStatus,
} from "@shared/ipc-channels";
import { app, safeStorage } from "electron";

const STORE_FILE = "app-config.json";
const FRAME_STORE_FILE = "frame-config.json";
const REMOTE_CONNECTOR_STORE_FILE = "remote-connector-config.json";
const CODE_AGENT_PROVIDER_STORE_FILE = "code-agent-providers.json";
const SHORTCUT_STORE_FILE = "shortcut-config.json";
const DESKTOP_APP_PREFERENCES_STORE_FILE = "desktop-app-preferences.json";
const REMOVED_DESKTOP_APP_IDS = new Set(["starter"]);

type StoredSecret =
  | { encoding: "local-file-v1"; value: string; updatedAt?: string }
  | { encoding: "safeStorage-v1"; value: string; updatedAt?: string }
  | { encoding: "plain"; value: string; updatedAt?: string };

interface CodeAgentProviderStore {
  version: 1;
  credentials: Partial<Record<CodeAgentProviderCredentialKey, StoredSecret>>;
}

export interface CodeAgentProviderCredentialApplyResult {
  ok: boolean;
  settings: CodeAgentProviderSettings;
  appliedKeys: CodeAgentProviderCredentialKey[];
  failedKeys: CodeAgentProviderCredentialKey[];
  error?: string;
}

const CODE_AGENT_PROVIDER_DEFINITIONS: Array<{
  id: CodeAgentProviderStatus["id"];
  label: string;
  keys: CodeAgentProviderCredentialKey[];
}> = [
  {
    id: "builder",
    label: "Builder.io",
    keys: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keys: ["ANTHROPIC_API_KEY"],
  },
  {
    id: "openai",
    label: "OpenAI",
    keys: ["OPENAI_API_KEY"],
  },
  {
    id: "google",
    label: "Gemini",
    keys: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  },
];

const CODE_AGENT_PROVIDER_KEYS = CODE_AGENT_PROVIDER_DEFINITIONS.flatMap(
  (provider) => provider.keys,
);

export type { FrameSettings };

export interface RemoteConnectorSettings {
  enabled: boolean;
}

export interface DesktopAppPreferences {
  appsRoot: string;
  managedAppIds: string[];
  appOrder: string[];
}

interface ShortcutStore {
  version: 1;
  bindings: DesktopShortcutBinding[];
}

function defaultFrameSettings(): FrameSettings {
  return {
    enabled: true,
    showCodeTab: true,
    mode: app.isPackaged ? "prod" : "dev",
  };
}

function defaultRemoteConnectorSettings(): RemoteConnectorSettings {
  return {
    enabled: false,
  };
}

function defaultApps(): AppConfig[] {
  return DESKTOP_DEFAULT_APPS.map((def) => ({
    ...def,
    mode:
      app.isPackaged || def.id === "dispatch" ? (def.mode ?? "prod") : "dev",
  }));
}

function canonicalizeDefaultApp(appConfig: AppConfig, def: AppConfig) {
  const shouldBackfillProdUrl = !appConfig.url?.trim() && Boolean(def.url);

  // Preserve everything the user can edit in the settings dialog. Only
  // structural fields the user can't edit (id, icon, isBuiltIn, placeholder)
  // and template-canonical metadata (color) come from `def`. Without this,
  // every restart wipes user-edited devUrl/url/name/etc. back to defaults.
  return {
    ...def,
    enabled: appConfig.enabled ?? def.enabled,
    mode: shouldBackfillProdUrl
      ? (def.mode ?? "prod")
      : (appConfig.mode ?? def.mode),
    name: appConfig.name || def.name,
    description: appConfig.description || def.description,
    url: shouldBackfillProdUrl ? def.url : (appConfig.url ?? def.url),
    devUrl: appConfig.devUrl ?? def.devUrl,
    devCommand: appConfig.devCommand ?? def.devCommand,
    localPath: appConfig.localPath,
    devPort: appConfig.devPort || def.devPort,
  };
}

function canonicalizeTemplateApp(appConfig: AppConfig, def: AppConfig) {
  const shouldBackfillProdUrl = !appConfig.url?.trim() && Boolean(def.url);
  const shouldBackfillDevUrl = !appConfig.devUrl?.trim() && Boolean(def.devUrl);

  return {
    ...appConfig,
    icon: appConfig.icon || def.icon,
    color: appConfig.color ?? def.color,
    colorRgb: appConfig.colorRgb ?? def.colorRgb,
    mode: shouldBackfillProdUrl
      ? (def.mode ?? "prod")
      : (appConfig.mode ?? def.mode),
    name: appConfig.name || def.name,
    description: appConfig.description || def.description,
    url: shouldBackfillProdUrl ? def.url : (appConfig.url ?? def.url),
    devUrl: shouldBackfillDevUrl
      ? def.devUrl
      : (appConfig.devUrl ?? def.devUrl),
    devCommand: appConfig.devCommand ?? def.devCommand,
    localPath: appConfig.localPath,
    devPort: appConfig.devPort || def.devPort,
  };
}

function getFrameStorePath(): string {
  return path.join(app.getPath("userData"), FRAME_STORE_FILE);
}

function getRemoteConnectorStorePath(): string {
  return path.join(app.getPath("userData"), REMOTE_CONNECTOR_STORE_FILE);
}

function getCodeAgentProviderStorePath(): string {
  return path.join(app.getPath("userData"), CODE_AGENT_PROVIDER_STORE_FILE);
}

function getShortcutStorePath(): string {
  return path.join(app.getPath("userData"), SHORTCUT_STORE_FILE);
}

function getDesktopAppPreferencesStorePath(): string {
  return path.join(app.getPath("userData"), DESKTOP_APP_PREFERENCES_STORE_FILE);
}

function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
  options?: { mode?: number },
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    const writeOptions =
      options?.mode === undefined
        ? "utf-8"
        : { encoding: "utf-8" as const, mode: options.mode };
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), writeOptions);
    fs.renameSync(tempPath, filePath);
    if (options?.mode !== undefined) {
      try {
        fs.chmodSync(filePath, options.mode);
      } catch {
        // Best effort: the file still lives inside Electron's userData directory.
      }
    }
  } catch (err) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failures for a temp file in userData.
    }
    throw err;
  }
}

function defaultCodeAgentProviderStore(): CodeAgentProviderStore {
  return { version: 1, credentials: {} };
}

function loadCodeAgentProviderStore(): CodeAgentProviderStore {
  try {
    const raw = JSON.parse(
      fs.readFileSync(getCodeAgentProviderStorePath(), "utf-8"),
    ) as Partial<CodeAgentProviderStore>;
    return {
      version: 1,
      credentials:
        raw.credentials && typeof raw.credentials === "object"
          ? raw.credentials
          : {},
    };
  } catch {
    return defaultCodeAgentProviderStore();
  }
}

function saveCodeAgentProviderStore(store: CodeAgentProviderStore): void {
  writeJsonFileAtomic(getCodeAgentProviderStorePath(), store, { mode: 0o600 });
}

function defaultShortcutStore(): ShortcutStore {
  return { version: 1, bindings: [] };
}

function sanitizeShortcutBehavior(behavior: unknown): DesktopShortcutBehavior {
  return behavior === "show" ? "show" : "toggle";
}

function sanitizeShortcutBinding(
  candidate: Partial<DesktopShortcutBinding>,
): DesktopShortcutBinding | null {
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const appId = typeof candidate.app === "string" ? candidate.app.trim() : "";
  const normalized = normalizeDesktopShortcutAccelerator(
    typeof candidate.accelerator === "string" ? candidate.accelerator : "",
  );
  if (!id || !appId || !normalized.accelerator) return null;

  const view =
    typeof candidate.view === "string" && candidate.view.trim()
      ? candidate.view.trim()
      : undefined;

  return {
    id,
    accelerator: normalized.accelerator,
    app: appId,
    view,
    behavior: sanitizeShortcutBehavior(candidate.behavior),
    enabled: candidate.enabled !== false,
  };
}

function loadShortcutStore(): ShortcutStore {
  try {
    const raw = JSON.parse(
      fs.readFileSync(getShortcutStorePath(), "utf-8"),
    ) as Partial<ShortcutStore>;
    const bindings = Array.isArray(raw.bindings)
      ? raw.bindings
          .map((binding) =>
            sanitizeShortcutBinding(binding as Partial<DesktopShortcutBinding>),
          )
          .filter((binding): binding is DesktopShortcutBinding =>
            Boolean(binding),
          )
      : [];
    return { version: 1, bindings };
  } catch {
    return defaultShortcutStore();
  }
}

function saveShortcutStore(store: ShortcutStore): void {
  writeJsonFileAtomic(getShortcutStorePath(), store);
}

function canUseSafeStorage(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encodeProviderSecret(value: string): StoredSecret {
  if (canUseSafeStorage()) {
    try {
      return {
        encoding: "safeStorage-v1",
        value: safeStorage.encryptString(value).toString("base64"),
        updatedAt: new Date().toISOString(),
      };
    } catch {
      // Fall through to the plain fallback below.
    }
  }

  return {
    encoding: "plain",
    value,
    updatedAt: new Date().toISOString(),
  };
}

function decryptProviderSecret(
  secret: StoredSecret | undefined,
): string | null {
  if (!secret?.value) return null;
  if (secret.encoding === "local-file-v1" || secret.encoding === "plain") {
    return secret.value;
  }
  if (!canUseSafeStorage()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(secret.value, "base64"));
  } catch {
    return null;
  }
}

function migrateDecryptableProviderSecrets(
  store: CodeAgentProviderStore,
  credentials: Partial<Record<CodeAgentProviderCredentialKey, string>>,
): void {
  if (!canUseSafeStorage()) return;
  let changed = false;
  for (const key of CODE_AGENT_PROVIDER_KEYS) {
    const secret = store.credentials[key];
    const value = credentials[key];
    if (!value || !secret || secret.encoding === "safeStorage-v1") continue;
    store.credentials[key] = encodeProviderSecret(value);
    changed = true;
  }
  if (changed) saveCodeAgentProviderStore(store);
}

function hasStoredProviderSecretBlob(
  secret: StoredSecret | undefined,
): boolean {
  return Boolean(secret?.value);
}

export function loadCodeAgentProviderCredentials(): Partial<
  Record<CodeAgentProviderCredentialKey, string>
> {
  const store = loadCodeAgentProviderStore();
  const credentials: Partial<Record<CodeAgentProviderCredentialKey, string>> =
    {};
  for (const key of CODE_AGENT_PROVIDER_KEYS) {
    const value = decryptProviderSecret(store.credentials[key]);
    if (value) credentials[key] = value;
  }
  migrateDecryptableProviderSecrets(store, credentials);
  return credentials;
}

export function saveCodeAgentProviderCredentials(
  updates: CodeAgentProviderSettingsUpdate,
): CodeAgentProviderSettings {
  const store = loadCodeAgentProviderStore();
  for (const key of CODE_AGENT_PROVIDER_KEYS) {
    if (!(key in updates)) continue;
    const value = updates[key]?.trim() ?? "";
    if (!value) {
      delete store.credentials[key];
    } else {
      store.credentials[key] = encodeProviderSecret(value);
    }
  }
  saveCodeAgentProviderStore(store);
  return getCodeAgentProviderSettingsStatus();
}

export function getCodeAgentProviderProcessEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const credentials = loadCodeAgentProviderCredentials();
  return {
    ...baseEnv,
    ...credentials,
  };
}

export function applyCodeAgentProviderCredentialsToEnv(): CodeAgentProviderCredentialApplyResult {
  const store = loadCodeAgentProviderStore();
  const credentials = loadCodeAgentProviderCredentials();
  const appliedKeys: CodeAgentProviderCredentialKey[] = [];
  const failedKeys: CodeAgentProviderCredentialKey[] = [];
  for (const key of CODE_AGENT_PROVIDER_KEYS) {
    if (credentials[key]) {
      appliedKeys.push(key);
    } else if (hasStoredProviderSecretBlob(store.credentials[key])) {
      failedKeys.push(key);
    }
  }
  return {
    ok: failedKeys.length === 0,
    settings: getCodeAgentProviderSettingsStatus(),
    appliedKeys,
    failedKeys,
    error:
      failedKeys.length > 0
        ? "Could not unlock one or more saved code provider keys."
        : undefined,
  };
}

export function getCodeAgentProviderSettingsStatus(): CodeAgentProviderSettings {
  const store = loadCodeAgentProviderStore();
  const providers = CODE_AGENT_PROVIDER_DEFINITIONS.map((provider) => {
    const savedKeys = provider.keys.filter((key) =>
      hasStoredProviderSecretBlob(store.credentials[key]),
    );
    const envKeys = provider.keys.filter((key) => Boolean(process.env[key]));
    const configuredKeys = provider.keys.filter(
      (key) => Boolean(process.env[key]) || savedKeys.includes(key),
    );
    const missingKeys = provider.keys.filter(
      (key) => !process.env[key] && !savedKeys.includes(key),
    );
    const configured = missingKeys.length === 0;
    const hasSaved = savedKeys.length > 0;
    const hasEnv = envKeys.some((key) => !savedKeys.includes(key));
    const source: CodeAgentProviderStatus["source"] | undefined = configured
      ? hasSaved && hasEnv
        ? "mixed"
        : hasSaved
          ? "desktop-settings"
          : "environment"
      : undefined;
    return {
      id: provider.id,
      label: provider.label,
      configured,
      configuredKeys,
      missingKeys,
      savedKeys,
      source,
    };
  });
  return {
    configured: providers.some((provider) => provider.configured),
    configuredProviders: providers
      .filter((provider) => provider.configured)
      .map((provider) => provider.label),
    providers,
    storagePath: getCodeAgentProviderStorePath(),
  };
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
  writeJsonFileAtomic(getFrameStorePath(), updated);
  return updated;
}

export function loadRemoteConnectorSettings(): RemoteConnectorSettings {
  try {
    const raw = fs.readFileSync(getRemoteConnectorStorePath(), "utf-8");
    return { ...defaultRemoteConnectorSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultRemoteConnectorSettings();
  }
}

export function saveRemoteConnectorSettings(
  settings: Partial<RemoteConnectorSettings>,
): RemoteConnectorSettings {
  const current = loadRemoteConnectorSettings();
  const updated = { ...current, ...settings };
  writeJsonFileAtomic(getRemoteConnectorStorePath(), updated);
  return updated;
}

export function getDefaultDesktopAppsRoot(): string {
  return path.join(app.getPath("home"), "Agent Native Apps");
}

export function loadDesktopAppPreferences(): DesktopAppPreferences {
  const defaults: DesktopAppPreferences = {
    appsRoot: getDefaultDesktopAppsRoot(),
    managedAppIds: [],
    appOrder: [],
  };
  try {
    const raw = JSON.parse(
      fs.readFileSync(getDesktopAppPreferencesStorePath(), "utf-8"),
    ) as Partial<DesktopAppPreferences>;
    const appsRoot =
      typeof raw.appsRoot === "string" && raw.appsRoot.trim()
        ? path.resolve(raw.appsRoot.trim())
        : defaults.appsRoot;
    const managedAppIds = Array.isArray(raw.managedAppIds)
      ? raw.managedAppIds.filter(
          (id): id is string => typeof id === "string" && Boolean(id.trim()),
        )
      : [];
    const appOrder = Array.isArray(raw.appOrder)
      ? raw.appOrder.filter(
          (id): id is string => typeof id === "string" && Boolean(id.trim()),
        )
      : [];
    return {
      appsRoot,
      managedAppIds: [...new Set(managedAppIds)],
      appOrder: [...new Set(appOrder)],
    };
  } catch {
    return defaults;
  }
}

export function saveDesktopAppPreferences(
  settings: Partial<DesktopAppPreferences>,
): DesktopAppPreferences {
  const current = loadDesktopAppPreferences();
  const updated: DesktopAppPreferences = {
    appsRoot:
      typeof settings.appsRoot === "string" && settings.appsRoot.trim()
        ? path.resolve(settings.appsRoot.trim())
        : current.appsRoot,
    managedAppIds: [
      ...new Set(settings.managedAppIds ?? current.managedAppIds),
    ],
    appOrder: [...new Set(settings.appOrder ?? current.appOrder)],
  };
  writeJsonFileAtomic(getDesktopAppPreferencesStorePath(), updated);
  return updated;
}

export function markDesktopManagedApp(
  appId: string,
  appsRoot?: string,
): DesktopAppPreferences {
  const current = loadDesktopAppPreferences();
  return saveDesktopAppPreferences({
    appsRoot: appsRoot ?? current.appsRoot,
    managedAppIds: [...current.managedAppIds, appId],
    appOrder: current.appOrder.includes(appId)
      ? current.appOrder
      : [...current.appOrder, appId],
  });
}

export function isDesktopManagedApp(appId: string): boolean {
  return loadDesktopAppPreferences().managedAppIds.includes(appId);
}

function orderAppsForDesktop(apps: AppConfig[]): AppConfig[] {
  const customOrder = loadDesktopAppPreferences().appOrder;
  if (customOrder.length === 0) return sortDesktopApps(apps);

  const orderIndex = new Map(customOrder.map((id, index) => [id, index]));
  const fallbackIndex = new Map(apps.map((item, index) => [item.id, index]));
  return [...apps].sort((a, b) => {
    const aIndex =
      orderIndex.get(a.id) ??
      customOrder.length + (fallbackIndex.get(a.id) ?? apps.length);
    const bIndex =
      orderIndex.get(b.id) ??
      customOrder.length + (fallbackIndex.get(b.id) ?? apps.length);
    return aIndex - bIndex;
  });
}

export function loadDesktopShortcutBindings(): DesktopShortcutBinding[] {
  return loadShortcutStore().bindings;
}

export function upsertDesktopShortcutBinding(
  request: DesktopShortcutUpsertRequest,
):
  | { ok: true; binding: DesktopShortcutBinding }
  | { ok: false; error: string } {
  const normalized = normalizeDesktopShortcutAccelerator(request.accelerator);
  if (!normalized.accelerator) {
    return { ok: false, error: normalized.error ?? "Invalid shortcut." };
  }

  const appId = typeof request.app === "string" ? request.app.trim() : "";
  if (!appId) return { ok: false, error: "Choose an app." };

  const store = loadShortcutStore();
  const existingIndex = request.id
    ? store.bindings.findIndex((binding) => binding.id === request.id)
    : -1;
  const existing =
    existingIndex >= 0 ? store.bindings[existingIndex] : undefined;
  const duplicate = store.bindings.find(
    (binding) =>
      binding.id !== existing?.id &&
      binding.accelerator === normalized.accelerator,
  );
  if (duplicate) {
    return {
      ok: false,
      error: "Another binding already uses this shortcut.",
    };
  }
  const binding: DesktopShortcutBinding = {
    id: existing?.id ?? request.id ?? randomUUID(),
    accelerator: normalized.accelerator,
    app: appId,
    view: request.view?.trim() || undefined,
    behavior: sanitizeShortcutBehavior(request.behavior ?? existing?.behavior),
    enabled: request.enabled ?? existing?.enabled ?? true,
  };

  if (existingIndex >= 0) {
    store.bindings[existingIndex] = binding;
  } else {
    store.bindings.push(binding);
  }
  saveShortcutStore(store);
  return { ok: true, binding };
}

export function removeDesktopShortcutBinding(
  id: string,
): DesktopShortcutBinding[] {
  const store = loadShortcutStore();
  const bindings = store.bindings.filter((binding) => binding.id !== id);
  saveShortcutStore({ version: 1, bindings });
  return bindings;
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
    const templateAppsById = new Map(TEMPLATE_APPS.map((d) => [d.id, d]));
    const persistedIds = new Set(apps.map((a) => a.id));

    // Remove stale desktop apps that should no longer appear, then preserve
    // other first-party template ids so existing user configs can still be
    // migrated instead of disappearing.
    const before = apps.length;
    apps = apps.filter(
      (a) =>
        !REMOVED_DESKTOP_APP_IDS.has(a.id) &&
        (!a.isBuiltIn || defaultsById.has(a.id) || templateAppsById.has(a.id)),
    );
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
      const legacyApp = app as AppConfig & { useCliHarness?: unknown };
      if (legacyApp.useCliHarness !== undefined) {
        app.mode = legacyApp.useCliHarness ? "dev" : "prod";
        delete legacyApp.useCliHarness;
        migrated = true;
      }
      if (app.mode === undefined) {
        app.mode = "prod";
        migrated = true;
      }

      // Sync any app whose id matches a default back to canonical built-in
      // metadata. Older persisted configs could keep stale placeholder/URL
      // fields and leave apps such as Dispatch non-rendering.
      const def = defaultsById.get(app.id);
      if (def) {
        const canonical = canonicalizeDefaultApp(app, def);
        if (JSON.stringify(app) !== JSON.stringify(canonical)) {
          apps[i] = canonical;
          migrated = true;
        }
        continue;
      }

      // User-added or legacy entries that match a first-party template should
      // still get canonical URL backfills. This covers old desktop configs
      // where hidden-but-known templates existed with an empty production URL,
      // which otherwise falls through to the local dev frame in packaged builds
      // and renders a blank tab.
      const templateDef = templateAppsById.get(app.id);
      if (templateDef) {
        const canonical = canonicalizeTemplateApp(app, templateDef);
        if (JSON.stringify(app) !== JSON.stringify(canonical)) {
          apps[i] = canonical;
          migrated = true;
        }
      }
    }

    const orderedApps = orderAppsForDesktop(apps);
    if (orderedApps.some((app, index) => app !== apps[index])) {
      apps = orderedApps;
      migrated = true;
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
  writeJsonFileAtomic(getStorePath(), apps);
}

export function addApp(newApp: AppConfig): AppConfig[] {
  const apps = loadApps();
  apps.push(newApp);
  saveApps(apps);
  const preferences = loadDesktopAppPreferences();
  if (preferences.appOrder.length > 0) {
    saveDesktopAppPreferences({
      appOrder: [...preferences.appOrder, newApp.id],
    });
  }
  return apps;
}

export function removeApp(id: string): AppConfig[] {
  const apps = loadApps().filter((a) => a.id !== id);
  saveApps(apps);
  const preferences = loadDesktopAppPreferences();
  saveDesktopAppPreferences({
    managedAppIds: preferences.managedAppIds.filter((appId) => appId !== id),
    appOrder: preferences.appOrder.filter((appId) => appId !== id),
  });
  return apps;
}

export function reorderApp(id: string, direction: "up" | "down"): AppConfig[] {
  const apps = loadApps();
  const index = apps.findIndex((candidate) => candidate.id === id);
  if (index === -1) return apps;
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= apps.length) return apps;

  const [moved] = apps.splice(index, 1);
  apps.splice(nextIndex, 0, moved);
  saveApps(apps);
  saveDesktopAppPreferences({
    appOrder: apps.map((candidate) => candidate.id),
  });
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
  saveDesktopAppPreferences({ managedAppIds: [], appOrder: [] });
  return apps;
}
