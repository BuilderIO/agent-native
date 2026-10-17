import path from "node:path";

import { bundleBoundedTaskSource } from "../collab/bounded-task-bundle.js";

const QUERY = "?bounded-task";
const RESOLVED_PREFIX = "\0agent-native-bounded-task:";

interface PluginContext {
  resolve(
    source: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ): Promise<{ id: string; external?: boolean | string } | null>;
  addWatchFile(file: string): void;
}

/**
 * `import source from "./tasks.ts?bounded-task"` yields the module bundled
 * into a `BoundedTaskSource` at build time, so deployed servers never run
 * esbuild. Registered for Vite (dev and client builds) and the production
 * Nitro build.
 */
export function boundedTaskSourcePlugin() {
  return {
    name: "agent-native-bounded-task-source",
    enforce: "pre" as const,
    async resolveId(this: PluginContext, source: string, importer?: string) {
      if (!source.endsWith(QUERY)) return null;
      const request = source.slice(0, -QUERY.length);
      const resolved = await this.resolve(request, importer, {
        skipSelf: true,
      });
      if (!resolved || resolved.external) {
        throw new Error(
          `Cannot resolve bounded task module ${request}${importer ? ` from ${importer}` : ""}`,
        );
      }
      return RESOLVED_PREFIX + resolved.id.split("?")[0];
    },
    async load(this: PluginContext, id: string) {
      if (!id.startsWith(RESOLVED_PREFIX)) return null;
      const entry = id.slice(RESOLVED_PREFIX.length);
      const bundled = await bundleBoundedTaskSource(entry, {
        name: path.basename(entry).replace(/\.[^.]+$/, ""),
      });
      for (const input of bundled.inputs) this.addWatchFile(input);
      const source = {
        kind: bundled.kind,
        name: bundled.name,
        code: bundled.code,
      };
      return `export default Object.freeze(${JSON.stringify(source)});\n`;
    },
  };
}
