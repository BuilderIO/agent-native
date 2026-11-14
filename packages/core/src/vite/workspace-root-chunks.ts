import {
  type BuildEnvironment,
  type Plugin,
  type Rolldown,
  type ViteBuilder,
} from "vite";

const STYLE_MODULE =
  /\.(css|scss|sass|less|styl|stylus|pcss|postcss|sss)(\?|$)/;
const ROOT_FACADE = /(?:^|\/)(?:root|entry\.client)\.[cm]?[jt]sx?$/;
const ROOT_COMMON_CHUNK = "workspace-root-common";

interface CapturedPass {
  moduleIds: Set<string>;
  codeBytes: number;
  css: string[];
}

function captureRootClosure(bundle: Rolldown.OutputBundle): CapturedPass {
  const chunks = Object.values(bundle).filter(
    (item): item is Rolldown.OutputChunk => item.type === "chunk",
  );
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set<string>();
  const stack = chunks
    .filter(
      (chunk) =>
        typeof chunk.facadeModuleId === "string" &&
        ROOT_FACADE.test(chunk.facadeModuleId),
    )
    .map((chunk) => chunk.fileName);
  while (stack.length > 0) {
    const fileName = stack.pop();
    if (fileName === undefined || seen.has(fileName)) continue;
    seen.add(fileName);
    const chunk = byFile.get(fileName);
    if (chunk) stack.push(...chunk.imports);
  }
  const moduleIds = new Set<string>();
  let codeBytes = 0;
  for (const fileName of seen) {
    const chunk = byFile.get(fileName);
    if (!chunk) continue;
    codeBytes += chunk.code.length;
    for (const id of chunk.moduleIds) {
      if (ROOT_FACADE.test(id) || STYLE_MODULE.test(id)) continue;
      moduleIds.add(id);
    }
  }
  const css = Object.values(bundle)
    .filter(
      (item): item is Rolldown.OutputAsset =>
        item.type === "asset" && item.fileName.endsWith(".css"),
    )
    .map((asset) =>
      typeof asset.source === "string"
        ? asset.source
        : Buffer.from(asset.source).toString("utf8"),
    )
    .sort();
  return { moduleIds, codeBytes, css };
}

/**
 * Opt-in workspace client optimization: coalesce the shared root static closure
 * into one low-priority `workspace-root-common` chunk.
 *
 * It extends the `AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS` policy, so it is only
 * added when both it and `AGENT_NATIVE_WORKSPACE` are set, and a build also
 * requires the inline opt-in. It wraps the router `config.builder.buildApp`
 * orchestration so the client environment builds twice (first pass snapshots
 * the root/entry.client static closure, second pass groups that shared set)
 * while the server environment builds once. It rejects a second pass that grows
 * the root source closure or changes the emitted CSS.
 */
export function workspaceRootChunks(): Plugin | null {
  if (
    process.env.AGENT_NATIVE_WORKSPACE !== "1" ||
    process.env.AGENT_NATIVE_COALESCE_WORKSPACE_ROOT_CHUNKS !== "1"
  )
    return null;

  const state = {
    rootCommonIds: null as Set<string> | null,
    first: null as CapturedPass | null,
    clientPasses: 0,
    clientSinglePass: false,
    builderWrapped: false,
    checkedBuildStart: false,
  };

  return {
    name: "agent-native-workspace-root-chunks",
    apply: "build",
    enforce: "post",
    config(config) {
      const builder = config.builder;
      if (!builder || typeof builder.buildApp !== "function") return;
      const userBuildApp = builder.buildApp;
      builder.buildApp = async (viteBuilder: ViteBuilder) => {
        state.builderWrapped = true;
        // The wrapper resolves to nothing when the first pass captured no root.
        const target: {
          build: (environment: BuildEnvironment) => Promise<unknown>;
        } = viteBuilder;
        const originalBuild = viteBuilder.build.bind(viteBuilder);
        target.build = async (environment: BuildEnvironment) => {
          if (environment.name !== "client") return originalBuild(environment);
          if (state.clientPasses > 0) {
            state.clientPasses += 1;
            return originalBuild(environment);
          }
          // A single-client-output build cannot be split across two passes.
          if (state.clientSinglePass) {
            state.clientPasses = 1;
            return originalBuild(environment);
          }
          state.clientPasses = 1;
          await originalBuild(environment);
          if (state.first === null) return undefined;
          state.clientPasses = 2;
          return originalBuild(environment);
        };
        return userBuildApp(viteBuilder);
      };
    },
    configEnvironment(name, config) {
      if (name !== "client") return;
      const options =
        config.build?.rolldownOptions ?? config.build?.rollupOptions ?? {};
      const outputs = Array.isArray(options.output)
        ? options.output
        : [options.output ?? {}];
      state.clientSinglePass = outputs.every(
        (output) => output.codeSplitting === false,
      );
      const prepareOutput = (output: Rolldown.OutputOptions) => {
        if (output.codeSplitting === false) return output;
        const splitting =
          typeof output.codeSplitting === "object" ? output.codeSplitting : {};
        return {
          ...output,
          codeSplitting: {
            ...splitting,
            groups: [
              ...(splitting.groups ?? []).filter(
                (group) => group.name !== ROOT_COMMON_CHUNK,
              ),
              {
                name: ROOT_COMMON_CHUNK,
                test: (id: string) => state.rootCommonIds?.has(id) === true,
                includeDependenciesRecursively: false,
                priority: -1,
              },
            ],
          },
        };
      };
      const hadLegacyAlias = Boolean(config.build?.rollupOptions);
      const rolldownOptions = {
        ...options,
        output: Array.isArray(options.output)
          ? options.output.map(prepareOutput)
          : prepareOutput(options.output ?? {}),
      };
      config.build = {
        ...config.build,
        rolldownOptions,
        ...(hadLegacyAlias ? { rollupOptions: rolldownOptions } : {}),
      };
    },
    buildStart() {
      if (state.checkedBuildStart) return;
      state.checkedBuildStart = true;
      if (process.env.AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS !== "1")
        this.error(
          "Workspace root-chunk coalescing requires the inline common-chunks opt-in (AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS=1)",
        );
      if (!state.builderWrapped)
        this.error(
          "Workspace root-chunk coalescing requires the router buildApp orchestrator",
        );
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      const captured = captureRootClosure(bundle);
      const first = state.first;
      if (state.clientPasses <= 1 || !first) {
        state.first = captured;
        state.rootCommonIds = new Set(captured.moduleIds);
        return;
      }
      const added = [...captured.moduleIds].filter(
        (id) => !first.moduleIds.has(id),
      );
      if (added.length > 0)
        this.error(
          "Workspace root static source closure grew between client passes",
        );
      if (captured.css.join("\u0000") !== first.css.join("\u0000"))
        this.error(
          "Workspace root-chunk coalescing changed the emitted CSS between client passes",
        );
    },
  };
}
