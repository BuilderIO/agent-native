import type { ShellRoute } from "./shell-contract";

/** The parts of React Router's browser manifest the shell worker reads. */
export interface ReactRouterManifestRoute {
  id: string;
  parentId?: string;
  path?: string;
  index?: boolean;
  module?: string;
  imports?: string[];
  css?: string[];
}

export interface ReactRouterManifest {
  version: string;
  url?: string;
  entry: { module: string; imports?: string[] };
  routes: Record<string, ReactRouterManifestRoute>;
}

/**
 * Routes behind Content's `_app` layout: the signed-in app. Public pages
 * (`/p/:id`), the sign-in landing and short links stay network-only.
 */
export function isContentAppRoute(routeId: string): boolean {
  return routeId === "routes/_app" || routeId.startsWith("routes/_app.");
}

function fullPattern(
  route: ReactRouterManifestRoute,
  routes: Record<string, ReactRouterManifestRoute>,
): string {
  const parts: string[] = [];
  for (
    let current: ReactRouterManifestRoute | undefined = route;
    current;
    current = current.parentId ? routes[current.parentId] : undefined
  ) {
    if (current.path) parts.unshift(current.path);
  }
  const joined = parts.join("/").split("/").filter(Boolean).join("/");
  return `/${joined}`;
}

/** Every route that can end a match, with its full URL pattern. */
export function shellRoutesFromManifest(
  manifest: Pick<ReactRouterManifest, "routes">,
  isAppRoute: (routeId: string) => boolean = isContentAppRoute,
): ShellRoute[] {
  const routes = Object.values(manifest.routes);
  const parents = new Set(
    routes
      .map((route) => route.parentId)
      .filter((id): id is string => Boolean(id)),
  );
  return routes
    .filter((route) => route.index || !parents.has(route.id))
    .map((route) => ({
      id: route.id,
      pattern: fullPattern(route, manifest.routes),
      app: isAppRoute(route.id),
    }));
}

/** The manifest itself, the entry, every route module, and their static imports and CSS. */
export function shellBootAssets(manifest: ReactRouterManifest): string[] {
  const found = new Set<string>([
    ...(manifest.url ? [manifest.url] : []),
    manifest.entry.module,
    ...(manifest.entry.imports ?? []),
  ]);
  for (const route of Object.values(manifest.routes)) {
    for (const value of Object.values(route)) {
      if (typeof value === "string" && value.startsWith("/assets/")) {
        found.add(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.startsWith("/assets/")) {
            found.add(item);
          }
        }
      }
    }
  }
  return [...found];
}
