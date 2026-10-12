import { configureClientRouterBasename } from "@agent-native/core/client/api-path";
import { installRouteChunkRecovery } from "@agent-native/core/client/route-chunk-recovery";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { preloadDocBlocksContent } from "./components/doc-block-renderer";
import { installAppLinkAttribution } from "./components/marketing-attribution";

installRouteChunkRecovery();
// Before hydration, so an app link followed while the page loads still
// carries the visitor's source.
installAppLinkAttribution();

configureClientRouterBasename();

async function hydrate() {
  if (document.documentElement.dataset.docBlocks === "true") {
    try {
      await preloadDocBlocksContent();
    } catch (error) {
      console.error("Docs visual block renderer failed to preload", error);
    }
  }

  hydrateRoot(document, <HydratedRouter />);
}

void hydrate();
