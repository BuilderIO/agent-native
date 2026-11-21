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

export function getManifestActions(app: object): readonly string[] {
  return manifestActions.get(app) ?? [];
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
