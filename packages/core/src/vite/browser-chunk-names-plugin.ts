import path from "node:path";

import type { Plugin } from "vite";

export function browserChunkNamesPlugin(): Plugin {
  return {
    name: "agent-native-browser-chunk-names",
    apply: "build",
    configEnvironment(name, config) {
      if (
        (config.consumer ?? (name === "client" ? "client" : "server")) !==
        "client"
      )
        return;
      if (config.build?.lib) return;

      const build = (config.build ??= {});
      const options = (build.rolldownOptions ??= {});
      const fileName = path.posix.join(
        build.assetsDir ?? "assets",
        "m-[hash].js",
      );
      const defaults = {
        // Source-derived script names can match privacy lists and prevent the
        // entire module graph from loading, including authentication popups.
        // A neutral prefix preserves the shared name-hash cache contract.
        entryFileNames: fileName,
        chunkFileNames: fileName,
      };
      options.output = Array.isArray(options.output)
        ? options.output.map((output) => ({ ...defaults, ...output }))
        : { ...defaults, ...options.output };
    },
  };
}
