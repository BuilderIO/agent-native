import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createBuilder,
  resolveConfig,
  type Plugin,
  type PluginOption,
} from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "./client.js";

/**
 * Opt-in contract for coalescing the shared root static closure into a single
 * low-priority client chunk (`workspace.coalesceRootChunks`).
 *
 * `defineConfig` must only add the build-only
 * `agent-native-workspace-root-chunks` plugin for workspace apps that opt in
 * through `AGENT_NATIVE_COALESCE_WORKSPACE_ROOT_CHUNKS=1` and
 * `AGENT_NATIVE_WORKSPACE=1`. The feature extends the existing
 * `AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS=1` policy, so it needs that opt-in when
 * building. When it runs it wraps the router `config.builder.buildApp`
 * orchestration: the client environment builds twice (first pass snapshots the
 * `root`/`entry.client` static closure, second pass adds a non-recursive
 * `workspace-root-common` group for that shared set) while the server
 * environment builds once. The existing per-input export preservation,
 * `strictExecutionOrder`, and inline-common-chunk policy remain in force.
 */

const ROOT_CHUNKS_PLUGIN = "agent-native-workspace-root-chunks";
const COMMON_CHUNKS_PLUGIN = "agent-native-workspace-common-chunks";
const ICON_CHUNKS_PLUGIN = "agent-native-workspace-icon-chunks";
const INPUT_FIX_PLUGIN = "agent-native-rolldown-input-fix";
const WORKSPACE_ROOT_COMMON_CHUNK = "workspace-root-common";

const ROOT_FACADE = "root";
const ENTRY_CLIENT_FACADE = "entry.client";
const HOME_FACADE = "home";
const ENTRY_NAMES = [
  ROOT_FACADE,
  ENTRY_CLIENT_FACADE,
  HOME_FACADE,
  "route1",
  "route2",
  "route3",
] as const;

const HELPER_COUNT = 24;
const STYLE_FILE = "style.css";

type Flag = "0" | "1";

interface FixtureRunResult {
  exportsKept: boolean;
  same: boolean;
  before: number;
  after: number;
  counts: number[];
}

interface CapturedChunk {
  fileName: string;
  name: string;
  code: string;
  moduleIds: string[];
  imports: string[];
  facadeModuleId: string | null;
}

interface CapturedAsset {
  fileName: string;
  text: string;
}

interface CapturedPass {
  chunks: CapturedChunk[];
  assets: CapturedAsset[];
}

interface BuildProbe {
  plugin: Plugin;
  counts: Record<string, number>;
  passes: CapturedPass[];
}

interface RootFixture {
  input: Record<string, string>;
  ssrInput: Record<string, string>;
  entryNames: string[];
  helperFiles: string[];
  extraFile: string;
}

interface RootGroupOptions {
  name?: string;
  priority?: number;
  includeDependenciesRecursively?: boolean;
  minShareCount?: number;
}

interface SplittingOptions {
  groups?: RootGroupOptions[];
  experimentalInlineCommonChunks?: unknown;
}

interface ChunkOutput {
  strictExecutionOrder?: boolean;
  codeSplitting?: false | SplittingOptions;
}

interface ChunkOptions {
  preserveEntrySignatures?: string | boolean;
  output: ChunkOutput | ChunkOutput[];
}

interface RunBuildOptions {
  root: string;
  plugins: PluginOption[];
  input: Record<string, string>;
  ssrInput: Record<string, string>;
  write: boolean;
  outDir: string;
  ssrOutDir: string;
  clientCodeSplitting?: false;
  withRouter?: boolean;
}

function stubWorkspaceFlags(
  workspace: Flag,
  inline: Flag,
  coalesce: Flag,
): void {
  vi.stubEnv("AGENT_NATIVE_WORKSPACE", workspace);
  vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", inline);
  vi.stubEnv("AGENT_NATIVE_COALESCE_WORKSPACE_ROOT_CHUNKS", coalesce);
}

function flatPlugins(config: ReturnType<typeof defineConfig>): Plugin[] {
  const plugins: Plugin[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) candidate.forEach(visit);
    else if (
      candidate &&
      typeof candidate === "object" &&
      "name" in candidate &&
      typeof candidate.name === "string"
    )
      plugins.push(candidate as Plugin);
  };
  visit(config.plugins);
  return plugins;
}

function policyPlugins(config: ReturnType<typeof defineConfig>): Plugin[] {
  return flatPlugins(config).filter((plugin) =>
    [
      INPUT_FIX_PLUGIN,
      ICON_CHUNKS_PLUGIN,
      COMMON_CHUNKS_PLUGIN,
      ROOT_CHUNKS_PLUGIN,
    ].includes(plugin.name),
  );
}

function findPlugin(
  config: ReturnType<typeof defineConfig>,
  name: string,
): Plugin | undefined {
  return flatPlugins(config).find((plugin) => plugin.name === name);
}

function writeFixtureFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function helperImportLines(indexes: number[]): string {
  return indexes
    .map(
      (index) => `import { value as v${index} } from "./helper${index}.mjs";`,
    )
    .join("\n");
}

function helperValueList(indexes: number[]): string {
  return indexes.map((index) => `v${index}`).join(", ");
}

/**
 * DOM-free ESM fixture. `root`, `entry.client`, `home`, and the extra routes
 * share enough helper modules to give the coalescer a real common set while
 * remaining individually cheap to emit.
 */
function createRootFixture(root: string): RootFixture {
  const allIndexes = Array.from({ length: HELPER_COUNT }, (_, index) => index);
  const helperFiles: string[] = [];
  for (const index of allIndexes) {
    const file = path.join(root, `helper${index}.mjs`);
    writeFixtureFile(
      file,
      `globalThis.helperRuns ??= {};
globalThis.helperRuns[${index}] = (globalThis.helperRuns[${index}] ?? 0) + 1;
export const value = { id: ${index}, pad: "${"x".repeat(400)}" };
`,
    );
    // Resolve the macOS tmp symlink so the emitted module ids match.
    helperFiles.push(fs.realpathSync(file));
  }

  writeFixtureFile(
    path.join(root, "optional.mjs"),
    `globalThis.optionalRuns = (globalThis.optionalRuns ?? 0) + 1;
export const value = "optional";
`,
  );
  const extraFile = path.join(root, "second-pass-extra.mjs");
  // A bare export is tree-shaken out of the side-effect import used by the
  // second-pass growth fixture, so keep a top-level side effect as well.
  writeFixtureFile(
    extraFile,
    `globalThis.secondPassExtra = (globalThis.secondPassExtra ?? 0) + 1;
export const extra = "second-pass";
`,
  );
  writeFixtureFile(
    path.join(root, STYLE_FILE),
    ".fixture { --workspace-root-chunks: 1; gap: 4px; }\n",
  );

  writeFixtureFile(
    path.join(root, `${ROOT_FACADE}.mjs`),
    `${helperImportLines(allIndexes)}
import "./${STYLE_FILE}";
export default () => [${helperValueList(allIndexes)}];
export const loader = () => "${ROOT_FACADE}";
`,
  );
  writeFixtureFile(
    path.join(root, `${ENTRY_CLIENT_FACADE}.mjs`),
    `${helperImportLines(allIndexes)}
export default () => [${helperValueList(allIndexes)}];
export const loader = () => "${ENTRY_CLIENT_FACADE}";
`,
  );

  const routeIndexes = (predicate: (index: number) => boolean): number[] => [
    0,
    ...allIndexes.filter((index) => index !== 0 && predicate(index)),
  ];
  const homeIndexes = routeIndexes((index) => index % 2 === 0);
  const routeSelections: Array<[string, number[]]> = [
    [HOME_FACADE, homeIndexes],
    ["route1", routeIndexes((index) => index % 3 === 0)],
    ["route2", routeIndexes((index) => index % 3 === 1)],
    ["route3", routeIndexes((index) => index % 3 === 2)],
  ];
  for (const [name, indexes] of routeSelections) {
    writeFixtureFile(
      path.join(root, `${name}.mjs`),
      `${helperImportLines(indexes)}
export default () => [${helperValueList(indexes)}];
export const loader = () => "${name}";
export const openOptional = () => import("./optional.mjs");
`,
    );
  }

  writeFixtureFile(
    path.join(root, "server.mjs"),
    `import { value as v0 } from "./helper0.mjs";
export default () => v0;
`,
  );

  const input: Record<string, string> = {};
  for (const name of ENTRY_NAMES) {
    input[name] = path.join(root, `${name}.mjs`);
  }

  return {
    input,
    ssrInput: { server: path.join(root, "server.mjs") },
    entryNames: [...ENTRY_NAMES],
    helperFiles,
    extraFile,
  };
}

function assetText(source: string | Uint8Array): string {
  return typeof source === "string"
    ? source
    : Buffer.from(source).toString("utf8");
}

function createBuildProbe(): BuildProbe {
  const counts: Record<string, number> = {};
  const passes: CapturedPass[] = [];
  const plugin: Plugin = {
    name: "fixture-root-chunks-probe",
    buildStart() {
      const name = this.environment.name;
      counts[name] = (counts[name] ?? 0) + 1;
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      const chunks: CapturedChunk[] = [];
      const assets: CapturedAsset[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type === "chunk") {
          chunks.push({
            fileName: item.fileName,
            name: item.name,
            code: item.code,
            moduleIds: [...item.moduleIds],
            imports: [...item.imports],
            facadeModuleId: item.facadeModuleId,
          });
        } else {
          assets.push({
            fileName: item.fileName,
            text: assetText(item.source),
          });
        }
      }
      passes.push({ chunks, assets });
    },
  };
  return { plugin, counts, passes };
}

async function runBuild(options: RunBuildOptions): Promise<void> {
  const clientOutput = {
    format: "es" as const,
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name]-[hash].mjs",
    ...(options.clientCodeSplitting === false
      ? { codeSplitting: false as const }
      : {}),
  };
  const builder = await createBuilder({
    configFile: false,
    envDir: false,
    root: options.root,
    logLevel: "silent",
    plugins: options.plugins,
    environments: {
      client: {
        build: {
          write: options.write,
          minify: false,
          outDir: options.outDir,
          emptyOutDir: options.write,
          // No DOM in this fixture; skip the modulepreload helper that would
          // otherwise reference `document` when a dynamic chunk loads.
          modulePreload: false,
          rolldownOptions: {
            input: options.input,
            output: clientOutput,
          },
        },
      },
      ssr: {
        build: {
          write: options.write,
          minify: false,
          outDir: options.ssrOutDir,
          emptyOutDir: options.write,
          rolldownOptions: {
            input: options.ssrInput,
            output: { format: "es" as const, entryFileNames: "[name].mjs" },
          },
        },
      },
    },
    ...(options.withRouter === false
      ? {}
      : {
          builder: {
            async buildApp(builder) {
              await builder.build(builder.environments.client);
              await builder.build(builder.environments.ssr);
            },
          },
        }),
  });
  await builder.buildApp();
}

async function withTempFixture<T>(
  run: (fixture: RootFixture, root: string) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "an-workspace-root-chunks-"),
  );
  try {
    return await run(createRootFixture(root), root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function isRootFacadeChunk(chunk: CapturedChunk): boolean {
  const id = chunk.facadeModuleId;
  return (
    typeof id === "string" && /(?:^|\/)(?:root|entry\.client)\.mjs$/.test(id)
  );
}

function staticClosure(
  chunks: CapturedChunk[],
  isStart: (chunk: CapturedChunk) => boolean,
): CapturedChunk[] {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set<string>();
  const stack = chunks.filter(isStart).map((chunk) => chunk.fileName);
  while (stack.length > 0) {
    const name = stack.pop();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const chunk = byName.get(name);
    if (chunk) stack.push(...chunk.imports);
  }
  return [...seen]
    .map((name) => byName.get(name))
    .filter((chunk): chunk is CapturedChunk => Boolean(chunk));
}

function closureBytes(chunks: CapturedChunk[]): number {
  return chunks.reduce((total, chunk) => total + chunk.code.length, 0);
}

function closureDump(chunks: CapturedChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `${chunk.fileName}: ${chunk.moduleIds
          .map((id) => path.basename(id))
          .join(", ")}`,
    )
    .join("\n");
}

function cssTexts(pass: CapturedPass): string[] {
  return pass.assets
    .filter((asset) => asset.fileName.endsWith(".css"))
    .map((asset) => asset.text)
    .sort();
}

function runEmittedFixture(
  outDir: string,
  entryNames: string[],
): FixtureRunResult {
  const runner = path.join(outDir, "run-fixture.mjs");
  fs.writeFileSync(
    runner,
    `const names = ${JSON.stringify(entryNames)};
const pages = await Promise.all(names.map((name) => import("./" + name + ".mjs")));
const exportsKept = pages.every(
  (page, index) =>
    typeof page.default === "function" &&
    typeof page.loader === "function" &&
    page.loader() === names[index],
);
const before = globalThis.optionalRuns ?? 0;
let same = false;
if (exportsKept) {
  const first = pages[0].default()[0];
  same = pages.every((page) => page.default()[0] === first);
  await pages[2].openOptional();
}
console.log(
  JSON.stringify({
    exportsKept,
    same,
    before,
    after: globalThis.optionalRuns ?? 0,
    counts: Object.values(globalThis.helperRuns ?? {}),
  }),
);
`,
    "utf8",
  );
  const run = spawnSync(process.execPath, [runner], {
    cwd: outDir,
    encoding: "utf8",
    env: { PATH: process.env.PATH },
    timeout: 20_000,
  });
  expect(run.status, run.stderr || run.stdout).toBe(0);
  return JSON.parse(
    run.stdout.trim().split("\n").at(-1) ?? "",
  ) as FixtureRunResult;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("workspace root chunk coalescing opt-in", () => {
  it("adds the build-only root-chunks plugin only for workspace apps that opt in", () => {
    stubWorkspaceFlags("0", "1", "1");
    expect(findPlugin(defineConfig(), ROOT_CHUNKS_PLUGIN)).toBeUndefined();

    stubWorkspaceFlags("1", "1", "0");
    expect(findPlugin(defineConfig(), ROOT_CHUNKS_PLUGIN)).toBeUndefined();

    stubWorkspaceFlags("1", "0", "1");
    const withoutInline = defineConfig();
    const pluginWithoutInline = findPlugin(withoutInline, ROOT_CHUNKS_PLUGIN);
    expect(
      pluginWithoutInline,
      "coalescing is a workspace opt-in; the inline flag is a build-time dependency",
    ).toBeTruthy();
    expect(pluginWithoutInline?.apply).toBe("build");
    expect(findPlugin(withoutInline, COMMON_CHUNKS_PLUGIN)).toBeUndefined();

    stubWorkspaceFlags("1", "1", "1");
    const enabled = defineConfig();
    const plugin = findPlugin(enabled, ROOT_CHUNKS_PLUGIN);
    expect(plugin).toBeTruthy();
    expect(plugin?.apply).toBe("build");
    expect(findPlugin(enabled, COMMON_CHUNKS_PLUGIN)).toBeTruthy();
    expect(policyPlugins(enabled).map((candidate) => candidate.name)).toEqual([
      INPUT_FIX_PLUGIN,
      ICON_CHUNKS_PLUGIN,
      COMMON_CHUNKS_PLUGIN,
      ROOT_CHUNKS_PLUGIN,
    ]);
  });

  it("requires the inline common-chunks opt-in when building", async () => {
    stubWorkspaceFlags("1", "0", "1");
    const config = defineConfig();
    expect(findPlugin(config, COMMON_CHUNKS_PLUGIN)).toBeUndefined();

    await withTempFixture(async (fixture, root) => {
      await expect(
        runBuild({
          root,
          plugins: [...policyPlugins(config)],
          input: fixture.input,
          ssrInput: fixture.ssrInput,
          write: false,
          outDir: path.join(root, "dist/client"),
          ssrOutDir: path.join(root, "dist/ssr"),
        }),
      ).rejects.toThrow(/inline/i);
    });
  }, 120_000);

  it("runs the client environment twice and the server once through the router buildApp", async () => {
    stubWorkspaceFlags("1", "1", "1");
    const config = defineConfig();

    await withTempFixture(async (fixture, root) => {
      const probe = createBuildProbe();
      await runBuild({
        root,
        plugins: [probe.plugin, ...policyPlugins(config)],
        input: fixture.input,
        ssrInput: fixture.ssrInput,
        write: false,
        outDir: path.join(root, "dist/client"),
        ssrOutDir: path.join(root, "dist/ssr"),
      });
      expect(probe.counts.client).toBe(2);
      expect(probe.counts.ssr).toBe(1);
      expect(probe.passes.length).toBe(2);
    });
  }, 120_000);

  it("adds a low-priority non-recursive workspace-root-common group without touching caller groups or the entry export policy", async () => {
    stubWorkspaceFlags("1", "1", "1");
    const resolved = await resolveConfig(
      {
        configFile: false,
        envDir: false,
        plugins: policyPlugins(defineConfig()),
        builder: { buildApp: async () => {} },
        environments: { client: {}, ssr: {} },
        build: {
          rolldownOptions: {
            preserveEntrySignatures: "exports-only",
            output: {
              format: "es",
              codeSplitting: {
                groups: [
                  { name: "caller-vendor", test: /vendor/, priority: 10 },
                ],
              },
            },
          },
        },
      },
      "build",
    );

    const options = resolved.environments.client.build
      .rolldownOptions as ChunkOptions;
    const output = Array.isArray(options.output)
      ? options.output[0]
      : options.output;
    if (!output) throw new Error("Missing client output options");
    const splitting =
      output.codeSplitting && typeof output.codeSplitting === "object"
        ? output.codeSplitting
        : undefined;
    if (!splitting) throw new Error("Missing client code splitting options");

    const groupNames = (splitting.groups ?? []).map((group) => group.name);
    expect(groupNames).toEqual(
      expect.arrayContaining(["caller-vendor", WORKSPACE_ROOT_COMMON_CHUNK]),
    );
    const rootGroup = (splitting.groups ?? []).find(
      (group) => group.name === WORKSPACE_ROOT_COMMON_CHUNK,
    );
    expect(rootGroup).toBeTruthy();
    expect(rootGroup?.includeDependenciesRecursively).toBe(false);
    expect(rootGroup?.priority ?? 0).toBeLessThan(0);

    // The existing common-chunks policy is still what preserves entries.
    expect(options.preserveEntrySignatures).toBe(false);
    expect(output.strictExecutionOrder).toBe(true);
    expect(splitting.experimentalInlineCommonChunks).toBeTruthy();
  });

  it("shrinks the emitted initial static closure and puts the shared root modules in one chunk", async () => {
    await withTempFixture(async (fixture, root) => {
      stubWorkspaceFlags("1", "1", "0");
      const baselineConfig = defineConfig();
      const baselineProbe = createBuildProbe();
      await runBuild({
        root,
        plugins: [baselineProbe.plugin, ...policyPlugins(baselineConfig)],
        input: fixture.input,
        ssrInput: fixture.ssrInput,
        write: false,
        outDir: path.join(root, "dist/baseline-client"),
        ssrOutDir: path.join(root, "dist/baseline-ssr"),
      });

      stubWorkspaceFlags("1", "1", "1");
      const optInConfig = defineConfig();
      const optInProbe = createBuildProbe();
      await runBuild({
        root,
        plugins: [optInProbe.plugin, ...policyPlugins(optInConfig)],
        input: fixture.input,
        ssrInput: fixture.ssrInput,
        write: false,
        outDir: path.join(root, "dist/opt-in-client"),
        ssrOutDir: path.join(root, "dist/opt-in-ssr"),
      });

      expect(baselineProbe.passes.length).toBe(1);
      expect(optInProbe.passes.length).toBe(2);
      const baselinePass = baselineProbe.passes[0];
      const optInPass = optInProbe.passes[1];
      if (!baselinePass || !optInPass) throw new Error("Missing client pass");

      const baselineClosure = staticClosure(
        baselinePass.chunks,
        isRootFacadeChunk,
      );
      const optInClosure = staticClosure(optInPass.chunks, isRootFacadeChunk);
      const baselineBytes = closureBytes(baselineClosure);
      const optInBytes = closureBytes(optInClosure);
      expect(baselineBytes).toBeGreaterThan(0);
      expect(
        optInBytes,
        `opt-in closure:\n${closureDump(optInClosure)}\n` +
          `baseline closure:\n${closureDump(baselineClosure)}`,
      ).toBeLessThan(baselineBytes);

      expect(
        optInClosure.some((chunk) =>
          chunk.fileName.includes(WORKSPACE_ROOT_COMMON_CHUNK),
        ),
      ).toBe(true);
      expect(
        baselineClosure.some((chunk) =>
          chunk.fileName.includes(WORKSPACE_ROOT_COMMON_CHUNK),
        ),
      ).toBe(false);

      const common = optInClosure.find((chunk) =>
        chunk.fileName.includes(WORKSPACE_ROOT_COMMON_CHUNK),
      );
      const helperIds = new Set(fixture.helperFiles);
      const groupedHelpers = new Set(
        (common?.moduleIds ?? []).filter((id) => helperIds.has(id)),
      );
      expect(groupedHelpers.size).toBeGreaterThan(1);
    });
  }, 120_000);

  it("preserves root and home exports, evaluates shared singletons once, and leaves the optional feature lazy", async () => {
    await withTempFixture(async (fixture, root) => {
      stubWorkspaceFlags("1", "1", "0");
      const baselineConfig = defineConfig();
      const baselineOut = path.join(root, "dist/baseline-client");
      await runBuild({
        root,
        plugins: [...policyPlugins(baselineConfig)],
        input: fixture.input,
        ssrInput: fixture.ssrInput,
        write: true,
        outDir: baselineOut,
        ssrOutDir: path.join(root, "dist/baseline-ssr"),
      });
      const baselineRun = runEmittedFixture(baselineOut, fixture.entryNames);
      expect(baselineRun).toMatchObject({
        exportsKept: true,
        same: true,
        before: 0,
        after: 1,
      });
      expect(baselineRun.counts.length).toBe(fixture.helperFiles.length);
      expect(baselineRun.counts.every((count) => count === 1)).toBe(true);

      stubWorkspaceFlags("1", "1", "1");
      const optInConfig = defineConfig();
      const optInOut = path.join(root, "dist/opt-in-client");
      const optInProbe = createBuildProbe();
      await runBuild({
        root,
        plugins: [optInProbe.plugin, ...policyPlugins(optInConfig)],
        input: fixture.input,
        ssrInput: fixture.ssrInput,
        write: true,
        outDir: optInOut,
        ssrOutDir: path.join(root, "dist/opt-in-ssr"),
      });
      expect(optInProbe.counts.client).toBe(2);
      expect(optInProbe.passes.length).toBe(2);
      expect(
        optInProbe.passes[1]?.chunks.some((chunk) =>
          chunk.fileName.includes(WORKSPACE_ROOT_COMMON_CHUNK),
        ),
      ).toBe(true);
      const optInRun = runEmittedFixture(optInOut, fixture.entryNames);
      expect(optInRun).toMatchObject({
        exportsKept: true,
        same: true,
        before: 0,
        after: 1,
      });
      expect(optInRun.counts.length).toBe(fixture.helperFiles.length);
      expect(optInRun.counts.every((count) => count === 1)).toBe(true);
    });
  }, 120_000);

  it("keeps the emitted stylesheet text identical across the two client passes", async () => {
    stubWorkspaceFlags("1", "1", "1");
    const config = defineConfig();
    await withTempFixture(async (fixture, root) => {
      const probe = createBuildProbe();
      await runBuild({
        root,
        plugins: [probe.plugin, ...policyPlugins(config)],
        input: fixture.input,
        ssrInput: fixture.ssrInput,
        write: false,
        outDir: path.join(root, "dist/client"),
        ssrOutDir: path.join(root, "dist/ssr"),
      });
      expect(probe.passes.length).toBe(2);
      const first = probe.passes[0];
      const second = probe.passes[1];
      if (!first || !second) throw new Error("Missing client pass");
      const firstCss = cssTexts(first);
      const secondCss = cssTexts(second);
      expect(firstCss.length).toBeGreaterThan(0);
      expect(secondCss).toEqual(firstCss);
    });
  }, 120_000);

  it("rejects when the second pass grows the root static source closure", async () => {
    stubWorkspaceFlags("1", "1", "1");
    const config = defineConfig();

    let clientPasses = 0;
    const growth: Plugin = {
      name: "fixture-second-pass-source-growth",
      buildStart() {
        if (this.environment.name === "client") clientPasses += 1;
      },
      transform(code, id) {
        const file = id.split("?")[0] ?? "";
        if (
          clientPasses >= 2 &&
          file.replaceAll("\\", "/").endsWith("/root.mjs")
        )
          return `import "./second-pass-extra.mjs";\n${code}`;
      },
    };

    await withTempFixture(async (fixture, root) => {
      await expect(
        runBuild({
          root,
          plugins: [growth, ...policyPlugins(config)],
          input: fixture.input,
          ssrInput: fixture.ssrInput,
          write: false,
          outDir: path.join(root, "dist/client"),
          ssrOutDir: path.join(root, "dist/ssr"),
        }),
      ).rejects.toThrow(/root|closure|source/i);
    });
  }, 120_000);

  it("rejects when the second pass changes the emitted CSS", async () => {
    stubWorkspaceFlags("1", "1", "1");
    const config = defineConfig();

    let clientPasses = 0;
    const cssMutation: Plugin = {
      name: "fixture-second-pass-css",
      buildStart() {
        if (this.environment.name === "client") clientPasses += 1;
      },
      transform(code, id) {
        if (clientPasses >= 2 && id.includes(STYLE_FILE))
          return `${code}\n.second-pass { color: red; }\n`;
      },
    };

    await withTempFixture(async (fixture, root) => {
      await expect(
        runBuild({
          root,
          plugins: [cssMutation, ...policyPlugins(config)],
          input: fixture.input,
          ssrInput: fixture.ssrInput,
          write: false,
          outDir: path.join(root, "dist/client"),
          ssrOutDir: path.join(root, "dist/ssr"),
        }),
      ).rejects.toThrow(/css/i);
    });
  }, 120_000);

  it("leaves explicit client codeSplitting:false builds single-pass", async () => {
    stubWorkspaceFlags("1", "1", "1");
    const config = defineConfig();
    expect(findPlugin(config, ROOT_CHUNKS_PLUGIN)).toBeTruthy();

    await withTempFixture(async (fixture, root) => {
      const probe = createBuildProbe();
      // `codeSplitting: false` with multiple inputs is invalid for the bundler,
      // so this single-pass contract uses a single entry.
      await runBuild({
        root,
        plugins: [probe.plugin, ...policyPlugins(config)],
        input: { [ROOT_FACADE]: fixture.input[ROOT_FACADE]! },
        ssrInput: fixture.ssrInput,
        write: false,
        outDir: path.join(root, "dist/client"),
        ssrOutDir: path.join(root, "dist/ssr"),
        clientCodeSplitting: false,
      });
      expect(probe.counts.client).toBe(1);
      expect(probe.counts.ssr).toBe(1);
      expect(probe.passes).toHaveLength(1);
    });
  }, 120_000);

  it("fails clearly when the router buildApp orchestrator is missing", async () => {
    stubWorkspaceFlags("1", "1", "1");
    const config = defineConfig();

    await withTempFixture(async (fixture, root) => {
      await expect(
        runBuild({
          root,
          plugins: [...policyPlugins(config)],
          input: fixture.input,
          ssrInput: fixture.ssrInput,
          write: false,
          outDir: path.join(root, "dist/client"),
          ssrOutDir: path.join(root, "dist/ssr"),
          withRouter: false,
        }),
      ).rejects.toThrow(/buildApp|orchestrat|router/i);
    });
  }, 120_000);
});
