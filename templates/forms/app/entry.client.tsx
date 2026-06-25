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

// useTransitions={false}: React Router wraps route-swap commits in
// React.startTransition by default. The agent navigates mid-response, while
// chat tokens are still streaming — those high-frequency urgent re-renders
// starve the low-priority transition, so the URL changes immediately
// (flushSync) but the new page doesn't actually render until the stream ends
// (10s+). The per-navigation `flushSync` option only covers the initial
// loading commit, not the async route-swap commit (react-router calls its
// final completeNavigation without flushSync for any non-hash navigation).
// Disabling transitions makes every router commit a plain setState that can't
// be starved, so navigation lands instantly. Forms has no route loaders and no
// Suspense data-fetching, so there is no pending-UI or fallback flash to lose.
hydrateRoot(document, <HydratedRouter useTransitions={false} />);
