import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";
import type { Plugin, ViteDevServer } from "vite";

/**
 * Vite plugin that serves public form pages (/f/*) via SSR in dev mode.
 * In production, the Nitro plugin handles this instead.
 */
function publicFormSSR(): Plugin {
  let server: ViteDevServer;
  return {
    name: "public-form-ssr",
    apply: "serve",
    configureServer(viteServer) {
      server = viteServer;
      // Use direct middleware (not returned) so it runs BEFORE Vite internals
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/f/")) return next();
        try {
          const mod = await server.ssrLoadModule(
            "/server/lib/public-form-ssr.ts",
          );
          const { html, status } = await mod.renderPublicFormHtml(req.url);
          res.statusCode = status;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(html);
        } catch (e) {
          console.error("[public-form-ssr]", e);
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [publicFormSSR(), reactRouter()],
});
