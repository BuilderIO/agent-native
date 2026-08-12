import type { Plugin } from "vite";

/**
 * A proxied Builder container asks for its own assets with root-absolute paths,
 * which in dev are Vite's own namespaces — it answers 404 before any server
 * route runs. Production has no Vite in front, so the route handles it there.
 */
/**
 * This app's own namespaces. A script running inside a proxied frame can reach
 * them too, and forwarding those to the container would send this app's API
 * calls to someone else's dev server.
 */
const OWN_PATH_PREFIXES = ["/builder-preview/", "/_agent-native/", "/api/"];

export function builderPreviewDevAssets(): Plugin {
  return {
    name: "agent-native:builder-preview-dev-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "";
        if (OWN_PATH_PREFIXES.some((prefix) => url.startsWith(prefix))) {
          return next();
        }
        const referer = req.headers.referer;
        if (!referer) return next();
        let refererPath: string;
        try {
          refererPath = new URL(referer).pathname;
        } catch {
          return next();
        }
        if (!refererPath.startsWith("/builder-preview/")) return next();
        const designId = refererPath.split("/")[2];
        if (!designId) return next();
        req.url = `/builder-preview/${designId}${url.startsWith("/") ? url : `/${url}`}`;
        next();
      });
    },
  };
}
