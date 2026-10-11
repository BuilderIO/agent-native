import { captureException } from "@agent-native/core/client/analytics";
import { configureClientRouterBasename } from "@agent-native/core/client/api-path";
import { installRouteChunkRecovery } from "@agent-native/core/client/route-chunk-recovery";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

installRouteChunkRecovery();

configureClientRouterBasename();

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
