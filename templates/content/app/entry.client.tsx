import { appBasePath } from "@agent-native/core/client/api-path";
import {
  installRouteChunkRecovery,
  stripBuildCompatibilityCacheBuster,
} from "@agent-native/core/client/route-chunk-recovery";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { i18nCatalog } from "./i18n";

installRouteChunkRecovery();

// Locale data ships per-locale lazy chunks; only en-US is in the main bundle.
// Load the active locale's chunk before hydration so synchronous message
// readers see translated strings on the first render, matching the eager-data
// behavior this split replaced.
const hydratedLocale = window.__AGENT_NATIVE_LOCALE__?.locale;
if (hydratedLocale && hydratedLocale !== "en-US") {
  try {
    await i18nCatalog.loadMessages(hydratedLocale);
  } catch {
    // coercion-ok: a missing locale chunk must not block hydration; message
    // readers fall back to en-US and the provider re-resolves the locale.
  }
}

const basePath = appBasePath();
const pathname = window.location.pathname;
const routerBasePath =
  basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))
    ? basePath
    : "";

const context = (
  window as Window & { __reactRouterContext?: { basename?: string } }
).__reactRouterContext;
if (context) {
  context.basename = routerBasePath;
}

hydrateRoot(document, <HydratedRouter />);
stripBuildCompatibilityCacheBuster();
