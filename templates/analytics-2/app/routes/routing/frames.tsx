import { Suspense, type ReactNode } from "react";

import { lazyRoute } from "@/components/workspace/lazy-route";

import type { ResolvedRoute, RoutingContext } from "./registry";

const PublishedProjectPage = lazyRoute(
  () => import("@/components/published/PublishedProjectPage"),
);

const ContextStudioPage = lazyRoute(() =>
  import("@/components/context/ContextStudioPage").then((module) => ({
    default: module.ContextStudioPage,
  })),
);

export interface RouteOutletContext {
  routing?: RoutingContext;
  renderPage?: (route: ResolvedRoute) => ReactNode;
  renderFrame?: (route: ResolvedRoute, content: ReactNode) => ReactNode;
}

export function RouteFrame({
  route,
  children,
}: {
  route: ResolvedRoute;
  children?: ReactNode;
}) {
  if (
    route.frame === "redirect" ||
    route.frame === "server" ||
    route.frame === "asset"
  )
    return null;
  if (route.frame === "published-app") {
    // The published app route is a reader's page: the project's cells, rendered,
    // with no editing chrome. Before this it resolved to an empty frame and the
    // route painted nothing at all.
    return (
      <Suspense fallback={<div data-route-frame="published-app" />}>
        <PublishedProjectPage route={route} />
      </Suspense>
    );
  }
  if (route.frame === "context-studio") {
    return (
      <Suspense fallback={null}>
        <ContextStudioPage route={route} />
      </Suspense>
    );
  }
  if (route.frame === "settings") {
    return (
      <div
        data-route-frame="settings"
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          width: "100%",
          height: "100%",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            display: "flex",
            flex: "1 1 auto",
            width: "100%",
            overflow: "hidden",
          }}
        >
          <main
            style={{
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              width: "100%",
              minHeight: 0,
              padding: "40px",
              overflow: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                flex: "1 1 auto",
                flexDirection: "column",
                gap: 30,
                width: "100%",
                maxWidth: 1000,
                margin: "0 auto",
              }}
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    );
  }
  return (
    <div
      data-route-frame={route.frame}
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        width: "100%",
        height: "100%",
        minHeight: "100vh",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}
