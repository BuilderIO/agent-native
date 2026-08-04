import { getAppProductionUrl } from "@agent-native/core/server";

/** Absolute URL for an in-app path, for use in emails and notifications. */
export function analyticsUrl(path: string): string {
  const base = getAppProductionUrl().replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
