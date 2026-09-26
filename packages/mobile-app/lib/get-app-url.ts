import type { AppConfig } from "@agent-native/shared-app-config";

export function getAppUrl(app: AppConfig): string {
  return app.url;
}
