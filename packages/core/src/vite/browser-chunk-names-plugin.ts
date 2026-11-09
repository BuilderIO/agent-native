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
      const defaults = {
        // Source-derived script names can match privacy lists and prevent the
        // entire module graph from loading, including authentication popups.
        // A neutral prefix preserves the shared name-hash cache contract.
        entryFileNames: `${build.assetsDir ?? "assets"}/m-[hash].js`,
        chunkFileNames: `${build.assetsDir ?? "assets"}/m-[hash].js`,
      };
      options.output = Array.isArray(options.output)
        ? options.output.map((output) => ({ ...defaults, ...output }))
        : { ...defaults, ...options.output };
    },
  };
}
