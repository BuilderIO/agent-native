import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import { toNodeListener } from "h3";

export interface ExpressPluginOptions {
  /** Path to the module that exports createServer(). Default: "./server" */
  serverEntry?: string;
}

/**
 * Vite plugin that mounts the H3 app as middleware during dev.
 * Only active in serve mode (not during build).
 *
 * The H3 app is re-created when server files change so you don't
 * have to manually restart `pnpm dev` after editing server code.
 */
export function expressPlugin(options: ExpressPluginOptions = {}): Plugin {
  const serverEntry = options.serverEntry ?? "./server";

  return {
    name: "agent-native-express",
    apply: "serve",
    configureServer(server) {
      let app: any = null;

      async function loadApp() {
        // Invalidate the module graph so we get fresh code
        const resolved = await server.moduleGraph.resolveUrl(serverEntry);
        if (resolved) {
          const mod = server.moduleGraph.getModuleById(resolved[1]);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }

        const ssrMod = await server.ssrLoadModule(serverEntry);
        const createServer =
          ssrMod.createServer ?? ssrMod.createAppServer ?? ssrMod.default;

        if (typeof createServer !== "function") {
          throw new Error(
            `[@agent-native/core] Could not find createServer export in "${serverEntry}". ` +
              `Export a createAppServer() function that returns an H3 app or { app }.`,
          );
        }

        const result = createServer();
        // Support both { app } (new H3 style) and direct app return
        app = result?.app ?? result;
      }

      // Initial load
      const ready = loadApp();

      // Re-create the app when any server file changes
      server.watcher.on("change", (file: string) => {
        if (file.includes("/server/") || file.includes("\\server\\")) {
          console.log(
            `[agent-native] Server file changed, reloading: ${file.split("/server/").pop()}`,
          );
          loadApp().catch((err) =>
            console.error("[agent-native] Failed to reload server:", err),
          );
        }
      });

      // Proxy middleware — delegates to the latest H3 app via toNodeListener.
      // Only intercept /api/* requests so Vite handles the SPA frontend.
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          await ready; // wait for initial load
          if (app && req.url?.startsWith("/api")) {
            const listener = toNodeListener(app);
            listener(req, res);
          } else {
            next();
          }
        },
      );
    },
  };
}
