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

// Embed mode: mark the document so the reader flows to its content height (see
// global.css `html[data-embed]`). Set before hydration so there's no flash.
try {
  if (new URLSearchParams(window.location.search).get("embedded") === "1") {
    document.documentElement.dataset.embed = "1";
  }
} catch {
  // ignore — non-embedded contexts never set the marker
}

hydrateRoot(document, <HydratedRouter useTransitions={false} />);
