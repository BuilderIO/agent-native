import { configureClientRouterBasename } from "@agent-native/core/client/api-path";
import {
  installRouteChunkRecovery,
  stripBuildCompatibilityCacheBuster,
} from "@agent-native/core/client/route-chunk-recovery";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { i18nCatalog } from "./i18n";

installRouteChunkRecovery();

const hydratedLocale = window.__AGENT_NATIVE_LOCALE__?.locale;
if (hydratedLocale && hydratedLocale !== "en-US") {
  try {
    await i18nCatalog.loadMessages(hydratedLocale);
  } catch {
    // coercion-ok: a missing locale chunk must not block hydration; message
    // readers fall back to en-US and the provider re-resolves the locale.
  }
}

configureClientRouterBasename();

hydrateRoot(document, <HydratedRouter />);
stripBuildCompatibilityCacheBuster();
