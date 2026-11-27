import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import { generateActionArtifacts, scanActionsDirectory } from "./codegen.js";
import { toNodeHandler } from "./http.js";
import type { CombinedHandlerOptions } from "./registry.js";

export interface ViteActionsPluginOptions {
  /** Directory scanned for `actions/*.ts`. Defaults to `"actions"`. */
  actionsDir?: string;
  /** Output directory for `.generated/actions.ts` and `.generated/action-types.d.ts`. Defaults to `".generated"`. */
  generatedDir?: string;
  /** Catch-all mount path serving `/actions/*` and `/mcp`. Defaults to `"/api/agent-native"`. */
  basePath?: string;
  /** Enable/configure MCP endpoint. Defaults to `true`. */
  mcp?: CombinedHandlerOptions["mcp"];
  /** HTTP RPC options (CORS, CSRF). */
  http?: CombinedHandlerOptions["http"];
  /**
   * Mount dev middleware automatically inside Vite's dev server.
   * Set `false` in frameworks like SvelteKit whose own server routes handle requests.
   */
  devMiddleware?: boolean;
}

const VIRTUAL_MODULE_ID = "virtual:agent-native/actions";
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

function buildVirtualModuleSource(
  projectRoot: string,
  actionsDir: string,
  options: ViteActionsPluginOptions,
): string {
  const scan = scanActionsDirectory(projectRoot, { actionsDir });
  const imports = scan.actions.map(
    (action) =>
      `import ${action.identifier} from ${JSON.stringify(action.filePath)};`,
  );
  const contextImport = scan.contextFile
    ? `import * as actionContextModule from ${JSON.stringify(scan.contextFile)};`
    : "";
  const entries = scan.actions.map(
    (action) => `  ${JSON.stringify(action.name)}: ${action.identifier},`,
  );

  return [
    'import { createActions } from "@agent-native/actions";',
    ...imports,
    ...(contextImport ? [contextImport] : []),
    "export const actions = createActions({",
    "  actions: {",
    ...entries,
    "  },",
    ...(scan.contextFile
      ? [
          '  ...(typeof actionContextModule.createContext === "function" ? { createContext: actionContextModule.createContext } : {}),',
        ]
      : []),
    ...(options.http ? [`  http: ${JSON.stringify(options.http)},`] : []),
    "});",
    "export default actions;",
  ].join("\n");
}

/**
 * Vite plugin providing:
 * - Static codegen into `.generated/actions.ts` & `.generated/action-types.d.ts`
 * - `virtual:agent-native/actions` for Vite-built servers
 * - Dev middleware serving `/api/agent-native/actions/*` and `/api/agent-native/mcp` with HMR
 */
export function agentNativeActionsPlugin(
  options: ViteActionsPluginOptions = {},
): Plugin {
  const actionsDir = options.actionsDir ?? "actions";
  const generatedDir = options.generatedDir ?? ".generated";
  const basePath = (options.basePath ?? "/api/agent-native").replace(
    /\/+$/,
    "",
  );
  let projectRoot = process.cwd();

  const regenerate = () => {
    generateActionArtifacts({
      projectRoot,
      actionsDir,
      generatedDir,
    });
  };

  return {
    name: "@agent-native/actions:vite",
    configResolved(config) {
      projectRoot = config.root;
      regenerate();
    },
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        return buildVirtualModuleSource(projectRoot, actionsDir, options);
      }
      return null;
    },
    configureServer(server: ViteDevServer) {
      const absActionsDir = path.resolve(projectRoot, actionsDir);
      server.watcher.add(absActionsDir);

      const handleChange = (changedFile: string) => {
        if (!changedFile.startsWith(absActionsDir)) return;
        try {
          regenerate();
          const mod = server.moduleGraph.getModuleById(
            RESOLVED_VIRTUAL_MODULE_ID,
          );
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
          }
        } catch (err) {
          server.config.logger.error(
            `[@agent-native/actions/vite] Failed to regenerate actions: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };

      server.watcher.on("add", handleChange);
      server.watcher.on("unlink", handleChange);
      server.watcher.on("change", handleChange);

      if (options.devMiddleware === false) return;

      server.middlewares.use((req, res, next) => {
        const reqUrl = req.url ?? "";
        if (reqUrl !== basePath && !reqUrl.startsWith(`${basePath}/`)) {
          next();
          return;
        }

        void (async () => {
          try {
            const loaded = (await server.ssrLoadModule(VIRTUAL_MODULE_ID)) as {
              actions?: {
                createHandler: (
                  opts?: CombinedHandlerOptions,
                ) => (request: Request) => Promise<Response>;
              };
            };
            if (!loaded.actions) {
              res.statusCode = 500;
              res.end("virtual:agent-native/actions did not export `actions`.");
              return;
            }
            const handler = toNodeHandler(
              loaded.actions.createHandler({
                basePath,
                ...(options.mcp !== undefined ? { mcp: options.mcp } : {}),
                ...(options.http ? { http: options.http } : {}),
              }),
            );
            await handler(req, res);
          } catch (error) {
            server.ssrFixStacktrace(
              error instanceof Error ? error : new Error(String(error)),
            );
            next(error);
          }
        })();
      });
    },
  };
}
