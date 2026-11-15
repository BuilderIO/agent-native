import { version as viteVersion, type Plugin, type Rolldown } from "vite";

import { getAppConfig } from "../app-config/index.js";

const STYLE_MODULE =
  /\.(css|scss|sass|less|styl|stylus|pcss|postcss|sss)(\?|$)/;

/** Opt-in client optimization; normal workspaces retain their chunk policy. */
export function workspaceCommonChunks(): Plugin | null {
  const workspace = getAppConfig().workspace;
  if (workspace.isWorkspace !== true || workspace.inlineCommonChunks !== true)
    return null;

  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(viteVersion);
  const supported =
    version &&
    (Number(version[1]) > 8 ||
      (Number(version[1]) === 8 &&
        (Number(version[2]) > 3 ||
          (Number(version[2]) === 3 && Number(version[3]) >= 5))));
  if (!supported)
    throw new Error(
      "Workspace common-chunk inlining requires Vite 8.3.5 or newer",
    );

  return {
    name: "agent-native-workspace-common-chunks",
    enforce: "post",
    configEnvironment(name, config) {
      if (name !== "client") return;
      const options =
        config.build?.rolldownOptions ?? config.build?.rollupOptions ?? {};
      const original = options.output;
      const outputs = Array.isArray(original) ? original : [original ?? {}];
      if (outputs.every((output) => output.codeSplitting === false)) return;

      const rejectWrapping = (
        experimental: Record<string, unknown> | undefined,
      ) => {
        for (const key of ["onDemandWrapping", "devMode"]) {
          if (experimental?.[key])
            throw new Error(
              `Workspace common-chunk inlining is incompatible with experimental.${key}`,
            );
        }
      };
      rejectWrapping(options.experimental);
      const prepareOutput = (output: Rolldown.OutputOptions) => {
        if (output.codeSplitting === false) return output;
        if (output.preserveModules || output.inlineDynamicImports)
          throw new Error(
            "Workspace common-chunk inlining requires split ES entry output; disable preserveModules and inlineDynamicImports",
          );
        if (output.strictExecutionOrder === false)
          throw new Error(
            "Workspace common-chunk inlining requires strictExecutionOrder; remove the explicit false value or disable the opt-in",
          );
        if (
          output.format &&
          output.format !== "es" &&
          output.format !== "esm" &&
          output.format !== "module"
        )
          throw new Error(
            "Workspace common-chunk inlining requires ES module output",
          );
        // Report misplaced experimental settings too, rather than silently
        // ignoring an explicit request that conflicts with this optimization.
        rejectWrapping(
          (output as typeof output & { experimental?: Record<string, unknown> })
            .experimental,
        );
        const splitting =
          typeof output.codeSplitting === "object" ? output.codeSplitting : {};
        return {
          ...output,
          strictExecutionOrder: true,
          codeSplitting: {
            ...splitting,
            experimentalInlineCommonChunks: {
              maxSize: 32768,
              exclude: STYLE_MODULE,
            },
          },
        };
      };
      const preparedOutput = Array.isArray(original)
        ? original.map(prepareOutput)
        : prepareOutput(original ?? {});

      // Inlining requires a false global entry signature, but routers still
      // import route exports by name. Preserve each entry's public interface.
      const preserveEntries: Plugin = {
        name: "agent-native-workspace-entry-exports",
        buildStart(inputOptions) {
          const runningVersion = this.meta.rolldownVersion;
          const running = /^(\d+)\.(\d+)\.(\d+)/.exec(runningVersion);
          if (
            !running ||
            Number(running[1]) < 1 ||
            (Number(running[1]) === 1 &&
              (Number(running[2]) < 2 ||
                (Number(running[2]) === 2 && Number(running[3]) < 16)))
          )
            this.error(
              "Workspace common-chunk inlining requires running Rolldown 1.2.16 or newer",
            );
          const input = inputOptions.input;
          const ids =
            typeof input === "string"
              ? [input]
              : Array.isArray(input)
                ? input
                : Object.values(input);
          for (const id of new Set(ids)) {
            if (typeof id !== "string" || id.length === 0)
              this.error("Workspace route inputs must be non-empty module ids");
            this.emitFile({
              type: "chunk",
              id,
              preserveSignature: "exports-only",
            });
          }
        },
        generateBundle(_output, bundle) {
          for (const chunk of Object.values(bundle)) {
            if (
              chunk.type !== "chunk" ||
              !chunk.isEntry ||
              !chunk.facadeModuleId
            )
              continue;
            const expected =
              this.getModuleInfo(chunk.facadeModuleId)?.exports ?? [];
            const missing = expected.filter(
              (name) => !chunk.exports.includes(name),
            );
            if (missing.length)
              this.error(
                `Workspace entry lost public exports: ${missing.join(", ")}`,
              );
          }
        },
      };
      const plugins =
        options.plugins === undefined
          ? []
          : Array.isArray(options.plugins)
            ? options.plugins
            : [options.plugins];
      const prepared = {
        ...options,
        preserveEntrySignatures: false as const,
        plugins: [
          ...plugins.filter(
            (plugin) =>
              !plugin ||
              typeof plugin !== "object" ||
              !("name" in plugin) ||
              plugin.name !== preserveEntries.name,
          ),
          preserveEntries,
        ],
        output: preparedOutput,
      };
      const hadLegacyAlias = Boolean(config.build?.rollupOptions);
      config.build = {
        ...config.build,
        rolldownOptions: prepared,
        ...(hadLegacyAlias ? { rollupOptions: prepared } : {}),
      };
    },
  };
}
