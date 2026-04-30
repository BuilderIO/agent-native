import { HydratedRouter } from "react-router/dom";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { appBasePath } from "@agent-native/core/client";

const basePath = appBasePath();
if (basePath) {
  const context = (
    window as Window & { __reactRouterContext?: { basename?: string } }
  ).__reactRouterContext;
  if (context) context.basename = basePath;
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
