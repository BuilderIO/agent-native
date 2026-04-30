import type { AppConfig } from "@agent-native/shared-app-config";

declare const __DEV__: boolean | undefined;

/** Return devUrl in dev mode, production url otherwise. */
export function getAppUrl(app: AppConfig): string {
  if (typeof __DEV__ !== "undefined" && __DEV__ && app.devUrl) {
    return app.devUrl;
  }
  return app.url;
}
