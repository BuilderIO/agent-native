import { configureClientRouterBasename } from "@agent-native/core/client/api-path";
import { installRouteChunkRecovery } from "@agent-native/core/client/route-chunk-recovery";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

installRouteChunkRecovery();

configureClientRouterBasename();

if (new URLSearchParams(window.location.search).get("embedded") === "1") {
  document.documentElement.dataset.embed = "1";
}

hydrateRoot(document, <HydratedRouter useTransitions={false} />);
