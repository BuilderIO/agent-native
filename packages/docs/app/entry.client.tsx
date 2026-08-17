import { appBasePath } from "@agent-native/core/client/api-path";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { preloadDocBlocksContent } from "./components/doc-block-renderer";

const basePath = appBasePath();
if (basePath) {
  const context = (
    window as Window & { __reactRouterContext?: { basename?: string } }
  ).__reactRouterContext;
  if (context) context.basename = basePath;
}

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
