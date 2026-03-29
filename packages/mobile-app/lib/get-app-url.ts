import type { AppConfig } from "@agent-native/shared-app-config";

/** Return devUrl in dev mode, production url otherwise. */
export function getAppUrl(app: AppConfig): string {
  // @ts-expect-error — __DEV__ is a React Native global
  if (__DEV__ && app.devUrl) return app.devUrl;
  return app.url;
}
