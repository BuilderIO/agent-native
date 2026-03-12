import type { Plugin } from "vite";

export interface ExpressPluginOptions {
  /** Path to the module that exports createServer(). Default: "./server" */
  serverEntry?: string;
}

/**
 * Vite plugin that mounts the Express app as middleware during dev.
 * Only active in serve mode (not during build).
 */
export function expressPlugin(options: ExpressPluginOptions = {}): Plugin {
  const serverEntry = options.serverEntry ?? "./server";

  return {
    name: "agentnative-express",
    apply: "serve",
    async configureServer(server) {
      const mod = await server.ssrLoadModule(serverEntry);
      const createServer =
        mod.createServer ?? mod.createAppServer ?? mod.default;

      if (typeof createServer !== "function") {
        throw new Error(
          `[agentnative] Could not find createServer export in "${serverEntry}". ` +
            `Export a createServer() function that returns an Express app.`,
        );
      }

      const app = createServer();
      server.middlewares.use(app);
    },
  };
}
