import { getAppConfig } from "../app-config/store.js";
import { deriveAppManifest } from "./index.js";

export const APP_MANIFEST_RESOURCE = {
  uri: "app://manifest",
  name: "App capability manifest",
  mimeType: "application/json",
};

const manifestActions = new WeakMap<object, readonly string[]>();

export function registerManifestActions(
  app: object,
  names: readonly string[],
): void {
  manifestActions.set(app, names);
}

const manifestDeniedActions = new WeakMap<object, Set<string>>();

export function registerManifestActionDenials(
  app: object,
  names: readonly string[],
): void {
  const denied = manifestDeniedActions.get(app) ?? new Set();
  for (const name of names) denied.add(name.trim());
  manifestDeniedActions.set(app, denied);
}

export function getManifestActions(app: object): readonly string[] {
  const denied = manifestDeniedActions.get(app);
  return (manifestActions.get(app) ?? []).filter((name) => !denied?.has(name));
}

export function getAppManifest(
  actionNames: readonly string[] = [],
  defaults: { id?: string; name?: string } = {},
) {
  const { app, manifest } = getAppConfig();
  return (
    manifest ??
    deriveAppManifest(
      {
        id: app.id ?? app.legacyId ?? defaults.id,
        name: app.name ?? defaults.name,
        homePath: app.homePath,
      },
      actionNames,
    )
  );
}
