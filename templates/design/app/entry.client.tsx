import { captureException } from "@agent-native/core/client/analytics";
import { appBasePath } from "@agent-native/core/client/api-path";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

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

hydrateRoot(document, <HydratedRouter />, {
  onRecoverableError(error, info) {
    captureException(error, {
      tags: {
        source: "react-recoverable-error",
        kind: "hydration",
      },
      extra: {
        componentStack: info.componentStack?.slice(0, 2_000),
      },
    });
  },
});
