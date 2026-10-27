import type { ScreenKind } from "@agent-native/shared-app-config";

export type { ScreenKind } from "@agent-native/shared-app-config";

export const SCREEN_REGISTRY: Record<string, ScreenKind> = {
  "mail.inbox": "remote",
  "mail.thread": "remote",
  "mail.compose": "remote",
};

export function getScreenKind(screen: string): ScreenKind {
  return SCREEN_REGISTRY[screen] ?? "remote";
}
