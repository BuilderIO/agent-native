import type { H3Event } from "h3";

import {
  getAppBasePathFromViteEnv,
  stripAppBasePath,
} from "./app-base-path.js";
import { canonicalFrameworkPathname } from "./framework-route-prefix.js";

/**
 * The path the auth guard routes a request by: H3's canonical pathname, with
 * the app's framework route prefix mapped to `/_agent-native` and its base
 * path removed. `null` for a path the guard rejects with a 400.
 */
export function getAuthGuardPath(event: H3Event): string | null {
  const rawUrl = event.node?.req.url;
  if (rawUrl !== undefined) {
    const rawPath = rawUrl.split("?")[0] ?? "";
    // Encoded separators are opaque route-parameter data; URL parsing must
    // not change the path's structure before any public-route decision.
    if (
      !rawPath.startsWith("/") ||
      rawPath.startsWith("//") ||
      rawPath.includes("\\") ||
      new URL(`http://agent-native.invalid${rawPath}`).pathname !== rawPath
    ) {
      return null;
    }
  }
  return stripAppBasePath(
    canonicalFrameworkPathname(event.url.pathname),
    getAppBasePathFromViteEnv(),
  );
}
