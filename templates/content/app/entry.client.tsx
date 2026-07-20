import { appBasePath } from "@agent-native/core/client/api-path";
import {
  installRouteChunkRecovery,
  stripBuildCompatibilityCacheBuster,
} from "@agent-native/core/client/route-chunk-recovery";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

installRouteChunkRecovery();

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
