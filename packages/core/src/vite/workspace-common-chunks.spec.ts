import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { build, resolveConfig, type Plugin, type PluginOption } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "./client.js";

/**
 * Opt-in contract for inlining small automatic common chunks into the route
 * entries that consume them (`experimentalInlineCommonChunks`).
 *
 * `defineConfig` must only add the client-only
 * `agent-native-workspace-common-chunks` plugin when BOTH
 * `AGENT_NATIVE_WORKSPACE=1` and `AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS=1` are
 * set. When it runs, the client output must set `preserveEntrySignatures:false`
 * so small shared chunks can be duplicated into consumers, `strictExecutionOrder`
 * must keep module bodies in source order, and each route input must be emitted
 * with `preserveSignature:"exports-only"` so the router entries keep their
 * public default/loader exports.
 */

const COMMON_CHUNKS_PLUGIN = "agent-native-workspace-common-chunks";
const ICON_CHUNKS_PLUGIN = "agent-native-workspace-icon-chunks";
const INPUT_FIX_PLUGIN = "agent-native-rolldown-input-fix";

const ROUTE_COUNT = 8;
const HELPER_COUNT = 20;

interface EmittedChunk {
  type: string;
  fileName: string;
  code: string;
  name?: string;
  moduleIds?: string[];
  modules?: Record<string, unknown>;
  imports?: string[];
  dynamicImports?: string[];
}

interface FixtureRunResult {
  exportsKept: boolean;
  same: boolean;
  before: number;
  after: number;
  counts: number[];
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

function chunkPlugins(config: ReturnType<typeof defineConfig>): Plugin[] {
  return flatPlugins(config).filter((plugin) =>
    [INPUT_FIX_PLUGIN, ICON_CHUNKS_PLUGIN, COMMON_CHUNKS_PLUGIN].includes(
      plugin.name,
    ),
  );
}

function findPlugin(
  config: ReturnType<typeof defineConfig>,
  name: string,
): Plugin | undefined {
  return flatPlugins(config).find((plugin) => plugin.name === name);
}

type InlineSettings = { maxSize: number; exclude: RegExp | RegExp[] };
type ChunkOutput = {
  strictExecutionOrder?: boolean;
  codeSplitting?: false | { experimentalInlineCommonChunks?: InlineSettings };
};
type ChunkOptions = {
  preserveEntrySignatures?: string | boolean;
  output: ChunkOutput | ChunkOutput[];
};
function splitting(output: ChunkOutput): InlineSettings | undefined {
  return (
    (output.codeSplitting &&
      output.codeSplitting.experimentalInlineCommonChunks) ||
    undefined
  );
}

function chunkModuleIds(chunk: EmittedChunk): string[] {
  if (Array.isArray(chunk.moduleIds)) return chunk.moduleIds;
  return Object.keys(chunk.modules ?? {});
}

function writeFixtureFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

/**
 * Static (non-dynamic) import closure from a chunk. This is the set of files a
 * route actually downloads and evaluates before it can render.
 */
function staticImportClosure(
  chunks: EmittedChunk[],
  start: EmittedChunk,
): EmittedChunk[] {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set<string>();
  const stack = [...(start.imports ?? [])];
  while (stack.length > 0) {
    const name = stack.pop();
    if (name === undefined) break;
    if (seen.has(name)) continue;
    seen.add(name);
    const chunk = byName.get(name);
    if (chunk) stack.push(...(chunk.imports ?? []));
  }
  return [...seen]
    .map((name) => byName.get(name))
    .filter((chunk): chunk is EmittedChunk => Boolean(chunk));
}

function emittedDump(chunks: EmittedChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `${chunk.fileName}: ${chunkModuleIds(chunk)
          .map((id) => path.basename(id))
          .join(", ")}`,
    )
    .join("\n");
}

/**
 * A DOM-free ESM fixture: eight route entries sharing twenty tiny helper
 * modules in different combinations, plus a dynamically imported optional
 * module. Each route exposes a public `default` and `loader` export.
 */
function createCommonChunksFixture(root: string): {
  input: Record<string, string>;
  entryNames: string[];
} {
  const input: Record<string, string> = {};
  for (let j = 0; j < HELPER_COUNT; j++) {
    writeFixtureFile(
      path.join(root, `helper${j}.mjs`),
      `globalThis.helperRuns ??= {};
globalThis.helperRuns[${j}] = (globalThis.helperRuns[${j}] ?? 0) + 1;
export const value = { id: ${j} };
`,
    );
  }
  writeFixtureFile(
    path.join(root, "optional.mjs"),
    `globalThis.optionalRuns = (globalThis.optionalRuns ?? 0) + 1;
export const value = "optional";
`,
  );
  const entryNames: string[] = [];
  for (let i = 0; i < ROUTE_COUNT; i++) {
    const name = `route${i}`;
    entryNames.push(name);
    const helperIndexes = Array.from(
      { length: HELPER_COUNT },
      (_, j) => j,
    ).filter((j) => ((j + 1) & (1 << (i % 4))) !== 0 || j === 0);
    const imports = helperIndexes
      .map((j) => `import { value as v${j} } from "./helper${j}.mjs";`)
      .join("\n");
    const values = helperIndexes.map((j) => `v${j}`).join(", ");
    writeFixtureFile(
      path.join(root, `${name}.mjs`),
      `${imports}
export default () => [${values}];
export const loader = () => ${i};
export const openOptional = () => import("./optional.mjs");
`,
    );
    input[name] = path.join(root, `${name}.mjs`);
  }
  return { input, entryNames };
}

async function buildRoutes(
  root: string,
  input: Record<string, string>,
  plugins: PluginOption[],
  outDir: string,
): Promise<EmittedChunk[]> {
  const result = (await build({
    configFile: false,
    envDir: false,
    root,
    logLevel: "silent",
    plugins,
    build: {
      write: true,
      minify: false,
      outDir,
      emptyOutDir: true,
      // No DOM in this fixture; skip the modulepreload helper that would
      // otherwise reference `document` when a dynamic chunk loads.
      modulePreload: false,
      rolldownOptions: {
        input,
        // Model the router input. The opt-in plugin replaces this with
        // preserveEntrySignatures:false plus per-input exports-only emits.
        preserveEntrySignatures: "exports-only",
        output: {
          format: "es",
          entryFileNames: "[name].mjs",
          chunkFileNames: "[name]-[hash].mjs",
        },
      },
    },
  })) as { output: EmittedChunk[] };
  return result.output.filter((chunk) => chunk.type === "chunk");
}

function runEmittedFixture(
  root: string,
  outDir: string,
  entryNames: string[],
): FixtureRunResult {
  const runner = path.join(root, outDir, "run-fixture.mjs");
  fs.writeFileSync(
    runner,
    `const names = ${JSON.stringify(entryNames)};
const pages = await Promise.all(names.map((name) => import("./" + name + ".mjs")));
const exportsKept = pages.every(
  (page, index) =>
    typeof page.default === "function" &&
    typeof page.loader === "function" &&
    page.loader() === index,
);
const before = globalThis.optionalRuns ?? 0;
let same = false;
if (exportsKept) {
  const first = pages[0].default()[0];
  same = pages.every((page) => page.default()[0] === first);
  await pages[0].openOptional();
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
    cwd: path.join(root, outDir),
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

describe("workspace common chunk inlining opt-in", () => {
  it("adds the client-only common-chunks plugin only when both workspace flags are set", () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    expect(findPlugin(defineConfig(), COMMON_CHUNKS_PLUGIN)).toBeUndefined();

    vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
    const enabled = defineConfig();
    expect(findPlugin(enabled, COMMON_CHUNKS_PLUGIN)).toBeTruthy();
    expect(
      chunkPlugins(enabled)
        .map((plugin) => plugin.name)
        .sort(),
    ).toEqual(
      [INPUT_FIX_PLUGIN, ICON_CHUNKS_PLUGIN, COMMON_CHUNKS_PLUGIN].sort(),
    );

    // Inline flag alone (standalone / not a workspace) must not activate it.
    vi.unstubAllEnvs();
    vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
    expect(findPlugin(defineConfig(), COMMON_CHUNKS_PLUGIN)).toBeUndefined();
  });

  it("configures client routing output for inline common chunks without touching server or explicit codeSplitting:false", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
    const config = await resolveConfig(
      {
        configFile: false,
        envDir: false,
        plugins: chunkPlugins(defineConfig()),
        environments: { client: {}, ssr: {} },
        build: {
          rolldownOptions: {
            preserveEntrySignatures: "exports-only",
            output: [{ format: "es" }, { codeSplitting: false }],
          },
        },
      },
      "build",
    );

    const client = config.environments.client.build
      .rolldownOptions as ChunkOptions;
    expect(client.preserveEntrySignatures).toBe(false);
    const output = client.output as ChunkOutput[];
    expect(Array.isArray(output)).toBe(true);

    expect(output[0].strictExecutionOrder).toBe(true);
    const inline = splitting(output[0]);
    expect(inline).toBeTruthy();
    if (!inline) throw new Error("Missing inline chunk settings");
    expect(inline.maxSize).toBe(32768);
    const excludes = Array.isArray(inline.exclude)
      ? inline.exclude
      : [inline.exclude];
    const excluded = (id: string): boolean =>
      excludes.some((matcher) => matcher.test(id));
    expect(excluded("src/app.css")).toBe(true);
    expect(excluded("src/theme.scss")).toBe(true);
    expect(excluded("src/app.mjs")).toBe(false);

    // Explicit `codeSplitting:false` outputs are left untouched.
    expect(output[1].codeSplitting).toBe(false);
    expect(output[1].strictExecutionOrder).toBeUndefined();
    expect(splitting(output[1])).toBeUndefined();

    // The server environment never gets the client-only inlining options.
    const ssr = config.environments.ssr.build.rolldownOptions as ChunkOptions;
    expect(ssr.preserveEntrySignatures).toBe("exports-only");
    const ssrOutput = ssr.output as ChunkOutput[];
    expect(ssrOutput[0].strictExecutionOrder).toBeUndefined();
    expect(splitting(ssrOutput[0])).toBeUndefined();
  });

  it.each([
    {
      label: "explicit strictExecutionOrder:false",
      output: { format: "es", strictExecutionOrder: false },
      message: /strictExecutionOrder/i,
    },
    {
      label: "experimental.onDemandWrapping",
      output: { format: "es", experimental: { onDemandWrapping: true } },
      message: /onDemandWrapping/i,
    },
    {
      label: "experimental.devMode",
      output: { format: "es", experimental: { devMode: true } },
      message: /devMode/i,
    },
  ])(
    "rejects $label as incompatible with inline common chunks",
    async ({ output, message }) => {
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
      await expect(
        resolveConfig(
          {
            configFile: false,
            envDir: false,
            plugins: chunkPlugins(defineConfig()),
            environments: { client: {} },
            build: {
              rolldownOptions: {
                preserveEntrySignatures: "exports-only",
                output,
              },
            },
          },
          "build",
        ),
      ).rejects.toThrow(message);
    },
  );

  it.each(["onDemandWrapping", "devMode"])(
    "rejects incompatible input experimental.%s settings",
    async (key) => {
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
      await expect(
        resolveConfig(
          {
            configFile: false,
            envDir: false,
            plugins: chunkPlugins(defineConfig()),
            build: {
              rolldownOptions: {
                experimental: { [key]: true },
                output: { format: "es" },
              },
            },
          },
          "build",
        ),
      ).rejects.toThrow(new RegExp(key));
    },
  );

  it("honors an explicit code-splitting opt-out without changing entry signatures", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
    const config = await resolveConfig(
      {
        configFile: false,
        envDir: false,
        plugins: chunkPlugins(defineConfig()),
        build: {
          rolldownOptions: {
            preserveEntrySignatures: "exports-only",
            output: { codeSplitting: false, strictExecutionOrder: false },
          },
        },
      },
      "build",
    );
    const options = config.environments.client.build
      .rolldownOptions as ChunkOptions;
    expect(options.preserveEntrySignatures).toBe("exports-only");
    if (Array.isArray(options.output)) throw new Error("Expected one output");
    expect(options.output.codeSplitting).toBe(false);
    expect(options.output.strictExecutionOrder).toBe(false);
  });

  it("rejects non-ES output instead of changing the caller's module format", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
    await expect(
      resolveConfig(
        {
          configFile: false,
          envDir: false,
          plugins: chunkPlugins(defineConfig()),
          build: { rolldownOptions: { output: { format: "cjs" } } },
        },
        "build",
      ),
    ).rejects.toThrow(/ES module/);
  });

  it.each(["preserveModules", "inlineDynamicImports"])(
    "rejects incompatible %s output",
    async (key) => {
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
      await expect(
        resolveConfig(
          {
            configFile: false,
            envDir: false,
            plugins: chunkPlugins(defineConfig()),
            build: { rolldownOptions: { output: { [key]: true } } },
          },
          "build",
        ),
      ).rejects.toThrow(/split ES entry/);
    },
  );

  it("preserves queried router array entries and late plugin entry exports", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-workspace-router-entries-"),
    );
    try {
      const one = path.join(root, "one.mjs");
      const two = path.join(root, "two.mjs");
      const late = path.join(root, "late.mjs");
      const helper = path.join(root, "shared.mjs");
      writeFixtureFile(helper, "export const identity = {}; ");
      writeFixtureFile(
        one,
        'import {identity} from "./shared.mjs"; export default () => identity; export const loader = () => 1;',
      );
      writeFixtureFile(
        two,
        'import {identity} from "./shared.mjs"; export default () => identity; export const loader = () => 2;',
      );
      writeFixtureFile(late, 'export const publicLate = () => "late";');
      const result = await build({
        configFile: false,
        envDir: false,
        root,
        logLevel: "silent",
        plugins: [
          ...chunkPlugins(defineConfig()),
          {
            name: "router-query-fixture",
            resolveId(id) {
              if (id.includes("?")) return id;
            },
            load(id) {
              if (id.includes("?"))
                return fs.readFileSync(id.split("?")[0], "utf8");
            },
            buildStart() {
              this.emitFile({
                type: "chunk",
                id: late,
                fileName: "late.mjs",
                preserveSignature: "exports-only",
              });
            },
          },
        ],
        build: {
          write: false,
          minify: false,
          rolldownOptions: {
            input: [
              one + "?__react-router-build-client-route",
              two + "?route-chunk=main",
            ],
            output: {
              entryFileNames: (chunk) =>
                chunk.facadeModuleId?.includes("one.mjs")
                  ? "one.mjs"
                  : "two.mjs",
            },
          },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const chunks = outputs
        .flatMap((output) => ("output" in output ? output.output : []))
        .filter((chunk) => chunk.type === "chunk");
      for (const name of ["one.mjs", "two.mjs"]) {
        const chunk = chunks.find((entry) => entry.fileName === name);
        expect(chunk?.exports).toEqual(
          expect.arrayContaining(["default", "loader"]),
        );
      }
      expect(
        chunks.find((entry) => entry.fileName === "late.mjs")?.exports,
      ).toEqual(["publicLate"]);
      // Each route can acquire a preservation facade, but never unbounded twins.
      expect(
        chunks.filter((chunk) => chunk.isEntry).length,
      ).toBeLessThanOrEqual(5);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves emitted styles and CSS-module exports under the opt-in", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    const baselinePlugins = chunkPlugins(defineConfig());
    vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
    const optInPlugins = chunkPlugins(defineConfig());
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-workspace-inline-css-"),
    );
    try {
      writeFixtureFile(
        path.join(root, "style.module.css"),
        ".fixture { --inline-css-check: 1; gap: 4px; }",
      );
      const input: Record<string, string> = {};
      for (const name of ["one", "two"]) {
        input[name] = path.join(root, `${name}.mjs`);
        writeFixtureFile(
          input[name],
          'import styles from "./style.module.css"; export default () => styles.fixture;',
        );
      }
      const css = (directory: string): string[] =>
        fs
          .readdirSync(directory, { recursive: true })
          .filter(
            (file): file is string =>
              typeof file === "string" && file.endsWith(".css"),
          )
          .map((file) => fs.readFileSync(path.join(directory, file), "utf8"))
          .sort();
      await buildRoutes(root, input, baselinePlugins, "baseline");
      await buildRoutes(root, input, optInPlugins, "inline");
      const original = css(path.join(root, "baseline"));
      expect(original.length).toBeGreaterThan(0);
      expect(original.join("\n")).toContain("--inline-css-check");
      expect(css(path.join(root, "inline"))).toEqual(original);
      const run = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'const a=await import("./one.mjs");const b=await import("./two.mjs");console.log(JSON.stringify({same:a.default()===b.default(),className:a.default()}));',
        ],
        {
          cwd: path.join(root, "inline"),
          encoding: "utf8",
          env: { PATH: process.env.PATH },
          timeout: 10000,
        },
      );
      expect(run.status, run.stderr).toBe(0);
      const result = JSON.parse(run.stdout.trim());
      expect(result.same).toBe(true);
      expect(result.className).toMatch(/fixture/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps route exports and shared singletons while shrinking the initial route closure under the opt-in", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    const baselinePlugins = chunkPlugins(defineConfig());

    vi.stubEnv("AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS", "1");
    const optInConfig = defineConfig();
    expect(findPlugin(optInConfig, COMMON_CHUNKS_PLUGIN)).toBeTruthy();
    const optInPlugins = chunkPlugins(optInConfig);

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-workspace-common-chunks-spec-"),
    );
    try {
      const { input, entryNames } = createCommonChunksFixture(root);

      const baselineChunks = await buildRoutes(
        root,
        input,
        baselinePlugins,
        "baseline",
      );
      const optInChunks = await buildRoutes(
        root,
        input,
        optInPlugins,
        "inline",
      );

      const baselineRoute0 = baselineChunks.find(
        (chunk) => chunk.fileName === "route0.mjs",
      );
      const optInRoute0 = optInChunks.find(
        (chunk) => chunk.fileName === "route0.mjs",
      );
      expect(baselineRoute0, emittedDump(baselineChunks)).toBeTruthy();
      expect(optInRoute0, emittedDump(optInChunks)).toBeTruthy();

      if (!baselineRoute0 || !optInRoute0)
        throw new Error("Missing route entry chunks");
      const baselineClosure = staticImportClosure(
        baselineChunks,
        baselineRoute0,
      );
      const optInClosure = staticImportClosure(optInChunks, optInRoute0);
      expect(baselineClosure.length).toBeGreaterThan(0);
      expect(
        optInClosure.length,
        `opt-in closure:\n${emittedDump([optInRoute0, ...optInClosure])}\n` +
          `baseline closure:\n${emittedDump([baselineRoute0, ...baselineClosure])}`,
      ).toBeLessThan(baselineClosure.length);

      // Default (flag off) keeps the original exports and singleton behavior.
      const baselineRun = runEmittedFixture(root, "baseline", entryNames);
      expect(baselineRun).toMatchObject({
        exportsKept: true,
        same: true,
        before: 0,
        after: 1,
      });
      expect(baselineRun.counts.length).toBeGreaterThan(0);
      expect(baselineRun.counts.every((count) => count === 1)).toBe(true);

      // Opt-in retains public default/loader exports, evaluates each shared
      // helper exactly once, and leaves the optional module behind its
      // dynamic import.
      const optInRun = runEmittedFixture(root, "inline", entryNames);
      expect(optInRun).toMatchObject({
        exportsKept: true,
        same: true,
        before: 0,
        after: 1,
      });
      expect(optInRun.counts.length).toBeGreaterThan(0);
      expect(optInRun.counts.every((count) => count === 1)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
