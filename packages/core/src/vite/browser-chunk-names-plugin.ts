import path from "node:path";

import { mergeConfig, type Plugin, type Rolldown } from "vite";

type ScriptNames = Pick<
  Rolldown.OutputOptions,
  "entryFileNames" | "chunkFileNames"
>;

export function browserChunkNamesPlugin(): Plugin {
  let appNames: ScriptNames[] = [];
  return {
    name: "agent-native-browser-chunk-names",
    apply: "build",
    enforce: "pre",
    config(config) {
      const client = config.environments?.client;
      const build = mergeConfig(config.build ?? {}, client?.build ?? {});
      const output = build.rolldownOptions?.output;
      // Capture app choices before frameworks populate their own default names.
      appNames = (Array.isArray(output) ? output : [output]).map((entry) => ({
        entryFileNames: entry?.entryFileNames,
        chunkFileNames: entry?.chunkFileNames,
      }));
    },
    configEnvironment(name, config) {
      if (
        name !== "client" ||
        config.consumer === "server" ||
        config.build?.lib
      )
        return;
      const build = (config.build ??= {});
      const options = (build.rolldownOptions ??= {});
      // A neutral prefix preserves the shared name-hash cache contract.
      const fileName = path.posix.join(
        build.assetsDir ?? "assets",
        "m-[hash].js",
      );
      const withNames = (output: Rolldown.OutputOptions = {}, index = 0) => ({
        ...output,
        entryFileNames: appNames[index]?.entryFileNames ?? fileName,
        chunkFileNames: appNames[index]?.chunkFileNames ?? fileName,
      });
      options.output = Array.isArray(options.output)
        ? options.output.map(withNames)
        : withNames(options.output);
    },
  };
}
