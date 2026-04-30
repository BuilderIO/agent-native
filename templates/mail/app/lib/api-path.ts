import { appBasePath } from "@agent-native/core/client";

export function appApiPath(path: string): string {
  if (!path.startsWith("/api/")) return path;
  return `${appBasePath()}${path}`;
}
