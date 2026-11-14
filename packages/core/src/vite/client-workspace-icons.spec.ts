import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { build, resolveConfig } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "./client.js";

/**
 * Emit real bundles using Core's workspace output config. Retain legacy
 * coalescing controls while checking the current initial/shared icon split,
 * external UI grouping, optional feature boundaries and runtime singletons.
 */

const CREATE_RUNTIME_MODULE = /createReactComponent\.mjs$/;
const OPTIONAL_RUNTIME_MODULE = /optional-runtime\.mjs$/;
const SETTINGS_MODULE = /settings\.mjs$/;
const SHARED_UI_LEAF_MODULE =
  /node_modules[\\/]@(?:radix-ui|floating-ui)[\\/][^\\/]+[\\/]/;
const TOOLKIT_UI_LEAF_MODULE =
  /packages[\\/]toolkit[\\/](?:src|dist)[\\/](?:ui|design-system)[\\/]/;
const TOOLKIT_APP_MODULE = /packages[\\/]toolkit[\\/](?:src|dist)[\\/]app[\\/]/;
const REACT_RUNTIME_MODULE = /node_modules[\\/]react[\\/]dist[\\/]react\.mjs$/;

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

function chunkModuleIds(chunk: EmittedChunk): string[] {
  if (Array.isArray(chunk.moduleIds)) return chunk.moduleIds;
  return Object.keys(chunk.modules ?? {});
}

function writeFixtureFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function createWorkspaceIconFixture(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "an-workspace-icons-spec-"),
  );
  const tablerRoot = path.join(root, "node_modules", "@tabler", "icons-react");
  writeFixtureFile(
    path.join(tablerRoot, "package.json"),
    JSON.stringify(
      {
        name: "@tabler/icons-react",
        version: "3.44.0",
        type: "module",
        sideEffects: false,
      },
      null,
      2,
    ),
  );
  // Shared runtime: a dependency of every icon module. It must not be captured
  // by the icon group, and it must be evaluated once (singleton identity).
  writeFixtureFile(
    path.join(tablerRoot, "dist/esm/createReactComponent.mjs"),
    `globalThis.__tablerRegistryCount = (globalThis.__tablerRegistryCount ?? 0) + 1;
const registry = { kind: "icon-registry" };

export default function createReactComponent(kind, name, iconNode) {
  return { kind, name, iconNode, registry };
}

export { registry };
`,
  );
  for (const [name, slug] of [
    ["IconAlpha", "alpha"],
    ["IconBeta", "beta"],
    ["IconOmega", "omega"],
  ] as const) {
    writeFixtureFile(
      path.join(tablerRoot, `dist/esm/icons/${name}.mjs`),
      `import createReactComponent from "../createReactComponent.mjs";

export const __iconNode = [["${name}"]];
export const ${name} = createReactComponent("outline", "${slug}", __iconNode);
export default ${name};
`,
    );
  }
  writeFixtureFile(
    path.join(tablerRoot, "dist/esm/icons/IconCatalog.mjs"),
    `import createReactComponent from "../createReactComponent.mjs";
globalThis.__tablerCatalogFactoryCount = (globalThis.__tablerCatalogFactoryCount ?? 0) + 1;
export default createReactComponent("outline", "catalog", []);`,
  );
  // The lazy picker reaches the full namespace; only shared factories should
  // join the initial group, never the catalog-only factory.
  writeFixtureFile(
    path.join(tablerRoot, "dist/esm/icons/index.mjs"),
    ["Alpha", "Beta", "Omega", "Catalog"]
      .map(
        (name) => `export { default as Icon${name} } from "./Icon${name}.mjs";`,
      )
      .join("\n"),
  );
  writeFixtureFile(
    path.join(root, "app/icon-picker.mjs"),
    `import * as icons from "@tabler/icons-react/dist/esm/icons/index.mjs"; export function names() { return Object.values(icons).map(icon => icon.name); }`,
  );
  // A non-icon module that should stay with its own importer.
  writeFixtureFile(
    path.join(tablerRoot, "dist/esm/optional-runtime.mjs"),
    `globalThis.__tablerOptionalEvals = (globalThis.__tablerOptionalEvals ?? 0) + 1;
export const optionalRuntime = "optional-runtime";
`,
  );

  writeFixtureFile(
    path.join(root, "app/runtime.mjs"),
    `export const runtimeMarker = "app-runtime";\n`,
  );
  writeFixtureFile(
    path.join(root, "app/icons.mjs"),
    `import { IconAlpha } from "@tabler/icons-react/dist/esm/icons/index.mjs";
import IconBeta from "@tabler/icons-react/dist/esm/icons/IconBeta.mjs";

export const components = [IconAlpha, IconBeta];
export default components;
`,
  );
  writeFixtureFile(
    path.join(root, "app/settings.mjs"),
    `import { optionalRuntime } from "@tabler/icons-react/dist/esm/optional-runtime.mjs";
import IconOmega from "@tabler/icons-react/dist/esm/icons/IconOmega.mjs";

globalThis.__tablerSettingsComponent = IconOmega;
export const component = IconOmega;
export function settingsValue() {
  return optionalRuntime + ":" + IconOmega.name;
}
`,
  );
  writeFixtureFile(
    path.join(root, "entry.mjs"),
    `import { runtimeMarker } from "./app/runtime.mjs";
import { components } from "./app/icons.mjs";
import { registry } from "@tabler/icons-react/dist/esm/createReactComponent.mjs";

export { components, registry };
export function start() {
  return [runtimeMarker, components[0].name, components[1].name];
}
export async function openIconPicker() { return (await import("./app/icon-picker.mjs")).names(); }
export async function openSettings() {
  const settings = await import("./app/settings.mjs");
  return settings.settingsValue();
}
`,
  );
  return root;
}

/**
 * Shared Radix/Floating UI leaves are imported by the initial entry and by
 * separate lazy entries. Without the `agent-native-ui` group the automatic
 * chunker fragments each leaf into its own tiny shared chunk; the group must
 * coalesce them while leaving the shared React runtime and optional code out.
 */
function createWorkspaceUiFixture(initial = false): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-workspace-ui-spec-"));
  const reactRoot = path.join(root, "node_modules", "react");
  writeFixtureFile(
    path.join(reactRoot, "package.json"),
    JSON.stringify(
      {
        name: "react",
        version: "19.0.0",
        type: "module",
        sideEffects: false,
        exports: { ".": "./dist/react.mjs" },
      },
      null,
      2,
    ),
  );
  // Shared runtime: a dependency of every UI leaf. It must stay out of the UI
  // chunk and be evaluated once (singleton identity).
  writeFixtureFile(
    path.join(reactRoot, "dist/react.mjs"),
    `globalThis.__reactRuntimeEvals = (globalThis.__reactRuntimeEvals ?? 0) + 1;
const runtime = { kind: "react-runtime" };

export default runtime;
export { runtime };
export function createElement() { return runtime; }
`,
  );
  const leaves: Array<[string, string]> = [
    [
      path.join(root, "node_modules", "@floating-ui", "core", "dist/index.mjs"),
      "core",
    ],
    [
      path.join(root, "node_modules", "@floating-ui", "dom", "dist/index.mjs"),
      "dom",
    ],
    [
      path.join(
        root,
        "node_modules",
        "@radix-ui",
        "react-slot",
        "dist/index.mjs",
      ),
      "slot",
    ],
  ];
  for (const [filePath, name] of leaves) {
    writeFixtureFile(
      path.join(path.dirname(filePath), "..", "package.json"),
      JSON.stringify(
        { name: `fixture-${name}`, version: "1.0.0", type: "module" },
        null,
        2,
      ),
    );
    writeFixtureFile(
      filePath,
      `import { runtime } from "react";
globalThis.__uiFactoryCounts = globalThis.__uiFactoryCounts ?? {};
globalThis.__uiFactoryCounts.${name} = (globalThis.__uiFactoryCounts.${name} ?? 0) + 1;

export const ${name}Leaf = { name: "${name}", runtime };
`,
    );
  }

  writeFixtureFile(
    path.join(root, "lazy-a.mjs"),
    `import { coreLeaf } from "@floating-ui/core/dist/index.mjs";
import { domLeaf } from "@floating-ui/dom/dist/index.mjs";

export function leavesA() {
  return [coreLeaf, domLeaf];
}
`,
  );
  writeFixtureFile(
    path.join(root, "lazy-b.mjs"),
    `import { domLeaf } from "@floating-ui/dom/dist/index.mjs";
import { slotLeaf } from "@radix-ui/react-slot/dist/index.mjs";

export function leavesB() {
  return [domLeaf, slotLeaf];
}
`,
  );
  writeFixtureFile(
    path.join(root, "lazy-c.mjs"),
    `import { slotLeaf } from "@radix-ui/react-slot/dist/index.mjs";
import { coreLeaf } from "@floating-ui/core/dist/index.mjs";

export function leavesC() {
  return [slotLeaf, coreLeaf];
}
`,
  );
  writeFixtureFile(
    path.join(root, "app/ui-optional-runtime.mjs"),
    `globalThis.__uiOptionalEvals = (globalThis.__uiOptionalEvals ?? 0) + 1;
export const optionalRuntime = "ui-optional-runtime";
`,
  );
  writeFixtureFile(
    path.join(root, "app/settings.mjs"),
    `import { optionalRuntime } from "./ui-optional-runtime.mjs";

export function settingsValue() {
  return optionalRuntime;
}
`,
  );
  writeFixtureFile(
    path.join(root, "entry.mjs"),
    `${
      initial
        ? `import { coreLeaf } from "@floating-ui/core/dist/index.mjs";
import { domLeaf } from "@floating-ui/dom/dist/index.mjs";
import { slotLeaf } from "@radix-ui/react-slot/dist/index.mjs";
export const initialLeaves = [coreLeaf, domLeaf, slotLeaf];`
        : ""
    }
export function start() {
  return ["ui-entry"];
}
export async function openUiA() { return (await import("./lazy-a.mjs")).leavesA(); }
export async function openUiB() { return (await import("./lazy-b.mjs")).leavesB(); }
export async function openUiC() { return (await import("./lazy-c.mjs")).leavesC(); }
export async function openSettings() {
  return (await import("./app/settings.mjs")).settingsValue();
}
`,
  );
  return root;
}

/**
 * First-party `@agent-native/toolkit` UI wrappers and design-system modules
 * are shared across many lazy routes and otherwise fragment into dozens of
 * tiny chunks. The `agent-native-ui` group must coalesce the ones under
 * `packages/toolkit/{src,dist}/{ui,design-system}` while leaving sibling
 * `toolkit/app` optional features and the shared React runtime out.
 */
function createWorkspaceToolkitUiFixture(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "an-workspace-toolkit-ui-spec-"),
  );
  const reactRoot = path.join(root, "node_modules", "react");
  writeFixtureFile(
    path.join(reactRoot, "package.json"),
    JSON.stringify(
      {
        name: "react",
        version: "19.0.0",
        type: "module",
        sideEffects: false,
        exports: { ".": "./dist/react.mjs" },
      },
      null,
      2,
    ),
  );
  writeFixtureFile(
    path.join(reactRoot, "dist/react.mjs"),
    `globalThis.__reactRuntimeEvals = (globalThis.__reactRuntimeEvals ?? 0) + 1;
const runtime = { kind: "react-runtime" };

export default runtime;
export { runtime };
`,
  );
  const toolkitDist = path.join(root, "packages", "toolkit", "dist");
  const toolkitLeaves: Array<[string, string]> = [
    ["ui/ui-a.mjs", "uiA"],
    ["ui/ui-b.mjs", "uiB"],
    ["ui/ui-c.mjs", "uiC"],
    ["design-system/ds-a.mjs", "dsA"],
  ];
  for (const [relative, name] of toolkitLeaves) {
    writeFixtureFile(
      path.join(toolkitDist, relative),
      `import { runtime } from "react";
globalThis.__toolkitUiFactoryCounts = globalThis.__toolkitUiFactoryCounts ?? {};
globalThis.__toolkitUiFactoryCounts.${name} =
  (globalThis.__toolkitUiFactoryCounts.${name} ?? 0) + 1;

export const ${name} = { name: "${name}", runtime };
`,
    );
  }
  writeFixtureFile(
    path.join(toolkitDist, "app/optional-runtime.mjs"),
    `globalThis.__toolkitAppOptionalEvals = (globalThis.__toolkitAppOptionalEvals ?? 0) + 1;
export const optionalRuntime = "toolkit-app-optional";
`,
  );
  writeFixtureFile(
    path.join(toolkitDist, "app/optional-feature.mjs"),
    `import { optionalRuntime } from "./optional-runtime.mjs";

export function optionalFeatureValue() {
  return optionalRuntime;
}
`,
  );
  const leafImport = (relative: string) =>
    `./${path.posix.join("packages/toolkit/dist", relative)}`;
  writeFixtureFile(
    path.join(root, "lazy-a.mjs"),
    `import { uiA } from "${leafImport("ui/ui-a.mjs")}";
import { uiB } from "${leafImport("ui/ui-b.mjs")}";
import { dsA } from "${leafImport("design-system/ds-a.mjs")}";

export function leavesA() {
  return [uiA, uiB, dsA];
}
`,
  );
  writeFixtureFile(
    path.join(root, "lazy-b.mjs"),
    `import { uiB } from "${leafImport("ui/ui-b.mjs")}";
import { uiC } from "${leafImport("ui/ui-c.mjs")}";
import { dsA } from "${leafImport("design-system/ds-a.mjs")}";

export function leavesB() {
  return [uiB, uiC, dsA];
}
`,
  );
  writeFixtureFile(
    path.join(root, "lazy-c.mjs"),
    `import { uiC } from "${leafImport("ui/ui-c.mjs")}";
import { uiA } from "${leafImport("ui/ui-a.mjs")}";
import { dsA } from "${leafImport("design-system/ds-a.mjs")}";

export function leavesC() {
  return [uiC, uiA, dsA];
}
`,
  );
  writeFixtureFile(
    path.join(root, "entry.mjs"),
    `export function start() {
  return ["toolkit-ui-entry"];
}
export async function openUiA() { return (await import("./lazy-a.mjs")).leavesA(); }
export async function openUiB() { return (await import("./lazy-b.mjs")).leavesB(); }
export async function openUiC() { return (await import("./lazy-c.mjs")).leavesC(); }
export async function openOptional() {
  return (await import("${leafImport("app/optional-feature.mjs")}")).optionalFeatureValue();
}
`,
  );
  return root;
}

function frameworkChunkPlugins(config: ReturnType<typeof defineConfig>) {
  return (config.plugins ?? [])
    .flat(Infinity)
    .filter(
      (plugin: any) =>
        plugin?.name === "agent-native-rolldown-input-fix" ||
        plugin?.name === "agent-native-workspace-icon-chunks",
    ) as any[];
}

/**
 * Legacy control only: restores, inside the fixture, the removed broad
 * `agent-native-ui` group that also captured first-party toolkit
 * `ui`/`design-system` wrappers. The current Core default captures
 * Radix/Floating primitives only and lets the automatic chunker place the
 * first-party wrappers.
 */
function legacyBroadToolkitUiGroupControl(): any {
  return {
    name: "fixture-legacy-broad-toolkit-ui-group",
    enforce: "post",
    configEnvironment(name: string, config: any) {
      if (name !== "client") return;
      const options =
        config.build?.rolldownOptions ?? config.build?.rollupOptions ?? {};
      const outputs = Array.isArray(options.output)
        ? options.output
        : [options.output ?? {}];
      for (const output of outputs) {
        if (!output || output.codeSplitting === false) continue;
        const splitting =
          typeof output.codeSplitting === "object" ? output.codeSplitting : {};
        const groups = [...(splitting.groups ?? [])];
        const legacyTest = (id: string) =>
          /node_modules[\\/]@(?:radix-ui|floating-ui)[\\/][^\\/]+[\\/]/.test(
            id,
          ) || TOOLKIT_UI_LEAF_MODULE.test(id);
        const index = groups.findIndex(
          (group: any) => group.name === "agent-native-ui",
        );
        if (index >= 0) {
          groups[index] = { ...groups[index], test: legacyTest };
        } else {
          groups.push({
            name: "agent-native-ui",
            minShareCount: 2,
            test: legacyTest,
            includeDependenciesRecursively: false,
          });
        }
        output.codeSplitting = { ...splitting, groups };
      }
    },
  };
}

/**
 * Static (non-dynamic) import closure from a chunk. Dynamic imports are the
 * boundary that keeps optional features out of the initial graph.
 */
function staticImportClosure(
  chunks: EmittedChunk[],
  start: EmittedChunk,
): EmittedChunk[] {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set<string>();
  const stack = [...(start.imports ?? [])];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const chunk = byName.get(name);
    if (chunk) stack.push(...(chunk.imports ?? []));
  }
  return [...seen]
    .map((name) => byName.get(name))
    .filter((chunk): chunk is EmittedChunk => Boolean(chunk));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("workspace client icon chunk", () => {
  it("coalesces pure UI leaves without capturing provider-coupled optional modules", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-pure-ui-spec-"));
    const ui = path.join(root, "packages/toolkit/src/ui");
    try {
      writeFixtureFile(
        path.join(ui, "card.mjs"),
        `globalThis.__pureCardRuns=(globalThis.__pureCardRuns??0)+1;export const card={name:'card'};`,
      );
      writeFixtureFile(
        path.join(ui, "label.mjs"),
        `export const label={name:'label'};`,
      );
      // Unlike the shared leaves, this leaf has one optional importer.
      writeFixtureFile(
        path.join(ui, "avatar.mjs"),
        `globalThis.__avatarRuns=(globalThis.__avatarRuns??0)+1;export const avatar={name:'avatar'};`,
      );
      writeFixtureFile(
        path.join(root, "provider.mjs"),
        `import {card} from './packages/toolkit/src/ui/card.mjs';export const provider={card};`,
      );
      writeFixtureFile(
        path.join(ui, "button.mjs"),
        `import {provider} from '../../../../provider.mjs';import {avatar} from './avatar.mjs';globalThis.__optionalButtonRuns=(globalThis.__optionalButtonRuns??0)+1;export const button={provider,avatar};`,
      );
      writeFixtureFile(
        path.join(root, "second.mjs"),
        `export {card} from './packages/toolkit/src/ui/card.mjs';export {label} from './packages/toolkit/src/ui/label.mjs';`,
      );
      writeFixtureFile(
        path.join(root, "entry.mjs"),
        `export {card} from './packages/toolkit/src/ui/card.mjs';export {label} from './packages/toolkit/src/ui/label.mjs';export const second=()=>import('./second.mjs');export const optional=()=>import('./packages/toolkit/src/ui/button.mjs');`,
      );
      const result = await build({
        configFile: false,
        envDir: false,
        root,
        plugins: frameworkChunkPlugins(defineConfig()),
        environments: { client: {} },
        build: {
          minify: false,
          modulePreload: false,
          outDir: "out",
          rolldownOptions: {
            input: {
              entry: path.join(root, "entry.mjs"),
              second: path.join(root, "second.mjs"),
            },
            output: {
              format: "es",
              entryFileNames: "[name].mjs",
              chunkFileNames: "[name]-[hash].mjs",
            },
          },
        },
      });
      const chunks = (Array.isArray(result) ? result[0] : result).output.filter(
        (chunk: any) => chunk.type === "chunk",
      ) as EmittedChunk[];
      const pure = chunks.filter(
        (chunk) => chunk.name === "agent-native-ui-leaves",
      );
      expect(
        pure,
        JSON.stringify(
          chunks.map((c) => ({
            name: c.name,
            file: c.fileName,
            modules: chunkModuleIds(c).map((id) => path.relative(root, id)),
          })),
        ),
      ).toHaveLength(1);
      expect(
        chunkModuleIds(pure[0]!).filter((id) =>
          /\/(?:card|label)\.mjs$/.test(id),
        ),
      ).toHaveLength(2);
      expect(
        chunkModuleIds(pure[0]!).some((id) =>
          /button\.mjs$|provider\.mjs$|avatar\.mjs$/.test(id),
        ),
      ).toBe(false);
      const entry = chunks.find((chunk) => chunk.fileName === "entry.mjs")!;
      expect(
        staticImportClosure(chunks, entry).some((chunk) =>
          chunkModuleIds(chunk).some((id) =>
            /button\.mjs$|provider\.mjs$|avatar\.mjs$/.test(id),
          ),
        ),
      ).toBe(false);
      const run = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const x=await import(${JSON.stringify(path.join(root, "out/entry.mjs"))});const y=await x.second();const before=globalThis.__optionalButtonRuns??0;const avatarBefore=globalThis.__avatarRuns??0;const z=await x.optional();console.log(JSON.stringify({same:x.card===y.card&&z.button.provider.card===x.card,cardRuns:globalThis.__pureCardRuns,before,after:globalThis.__optionalButtonRuns,avatarBefore,avatarAfter:globalThis.__avatarRuns}));`,
        ],
        { encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 10000 },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout.trim())).toEqual({
        same: true,
        cardRuns: 1,
        before: 0,
        after: 1,
        avatarBefore: 0,
        avatarAfter: 1,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps output arrays, user groups and server options isolated", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    const original = [
      { codeSplitting: { groups: [{ name: "existing", test: /custom/ }] } },
      { codeSplitting: false as const },
    ];
    const config = await resolveConfig(
      {
        configFile: false,
        envDir: false,
        plugins: frameworkChunkPlugins(defineConfig()),
        environments: { client: {}, ssr: {} },
        build: {
          rolldownOptions: {
            preserveEntrySignatures: "exports-only",
            output: original,
          },
        },
      },
      "build",
    );
    const outputs = config.environments.client.build.rolldownOptions
      .output as any[];
    expect(outputs).toHaveLength(2);
    expect(
      config.environments.client.build.rolldownOptions.preserveEntrySignatures,
    ).toBe("allow-extension");
    expect(
      outputs[0].codeSplitting.groups.filter(
        (group: any) => group.name === "existing",
      ),
    ).toHaveLength(1);
    expect(
      outputs[0].codeSplitting.groups.filter(
        (group: any) => group.name === "agent-native-icons",
      ),
    ).toHaveLength(1);
    expect(
      outputs[0].codeSplitting.groups.filter(
        (group: any) => group.name === "agent-native-ui",
      ),
    ).toHaveLength(1);
    expect(
      outputs[0].codeSplitting.groups.find(
        (group: any) => group.name === "agent-native-ui",
      ),
    ).toMatchObject({
      minShareCount: 2,
      includeDependenciesRecursively: false,
    });
    expect(outputs[1].codeSplitting).toBe(false);
    expect(original[0].codeSplitting).toMatchObject({
      groups: [{ name: "existing" }],
    });
    expect(
      config.environments.ssr.build.rolldownOptions.preserveEntrySignatures,
    ).toBe("exports-only");
    const serverOutputs = config.environments.ssr.build.rolldownOptions
      .output as any[];
    expect(serverOutputs).toHaveLength(2);
    expect(serverOutputs[0].codeSplitting.groups).toHaveLength(1);
  });

  it("leaves standalone client output ungrouped", async () => {
    const config = await resolveConfig(
      {
        configFile: false,
        envDir: false,
        plugins: frameworkChunkPlugins(defineConfig()),
        environments: { client: {} },
        build: { rolldownOptions: { output: {} } },
      },
      "build",
    );
    const output = config.environments.client.build.rolldownOptions
      .output as any;
    const groups = output?.codeSplitting?.groups ?? [];
    expect(
      groups.filter(
        (group: any) =>
          group.name === "agent-native-icons" ||
          group.name === "agent-native-ui",
      ),
    ).toHaveLength(0);
  });

  it("keeps strict server entry exports buildable without client icon grouping", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    const config = defineConfig();
    const root = createWorkspaceIconFixture();
    try {
      const result = await build({
        plugins: frameworkChunkPlugins(config),
        root,
        configFile: false,
        envDir: false,
        logLevel: "silent",
        build: {
          ssr: true,
          write: false,
          minify: false,
          rolldownOptions: {
            input: path.join(root, "entry.mjs"),
            preserveEntrySignatures: "exports-only",
            output: config.build?.rolldownOptions?.output,
          },
        },
      });
      expect(result).toBeTruthy();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    { mode: "legacy used-icon capture control", legacy: true },
    { mode: "current Core default", legacy: false },
  ])(
    "keeps used icons lazy-safe with $mode",
    async ({ legacy }) => {
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      const config = defineConfig();
      const output = config.build?.rolldownOptions?.output;
      expect(output).toBeTruthy();

      const workspaceOutput = structuredClone(output) as Record<
        string,
        unknown
      >;
      const root = createWorkspaceIconFixture();
      const distDir = path.join(root, "dist");
      // Keep the former single-chunk guarantee as a control. Strict ordering
      // must retain initial factories in the entry to preserve evaluation order.
      const plugins = frameworkChunkPlugins(config).map((plugin) =>
        legacy && plugin.name === "agent-native-workspace-icon-chunks"
          ? { ...plugin, transform: undefined }
          : plugin,
      );
      if (legacy)
        plugins.push({
          name: "fixture-legacy-icon-order",
          enforce: "post",
          configEnvironment(name: string, config: any) {
            if (name !== "client") return;
            const outputs = config.build.rolldownOptions.output;
            for (const output of Array.isArray(outputs) ? outputs : [outputs]) {
              output.strictExecutionOrder = false;
              // Restore the former single-chunk policy explicitly. Newer
              // compilers count barrel references differently; the control
              // must still exercise eager capture of all used icon leaves.
              for (const group of output.codeSplitting?.groups ?? []) {
                if (group.name === "agent-native-icons") {
                  group.minShareCount = 1;
                  // The former capture set contains the three used icons;
                  // the catalog-only factory must remain behind its picker.
                  group.test = /icons[\\/]Icon(?:Alpha|Beta|Omega)\.mjs$/;
                }
              }
            }
          },
        });
      try {
        const result = (await build({
          plugins,
          configFile: false,
          envDir: false,
          logLevel: "silent",
          root,
          build: {
            write: true,
            minify: false,
            outDir: "dist",
            emptyOutDir: true,
            // No DOM in this fixture; skip the modulepreload helper that would
            // otherwise reference `document` when the dynamic chunk loads.
            modulePreload: false,
            rolldownOptions: {
              input: path.join(root, "entry.mjs"),
              experimental: config.build?.rolldownOptions?.experimental,
              // Model the router input. The client-only plugin preserves exports
              // with allow-extension while enabling non-recursive icon grouping.
              preserveEntrySignatures: "exports-only",
              output: workspaceOutput,
            },
          },
        })) as { output: EmittedChunk[] };

        const chunks = result.output.filter(
          (chunk) => chunk.type === "chunk",
        ) as EmittedChunk[];

        const isFixtureIcon = (id: string) =>
          /Icon(?:Alpha|Beta|Omega)\.mjs$/.test(id);
        const iconChunks = chunks.filter((chunk) =>
          chunkModuleIds(chunk).some(isFixtureIcon),
        );
        expect(iconChunks).toHaveLength(legacy ? 1 : 2);
        const iconsChunk = legacy
          ? iconChunks[0]!
          : iconChunks.find((chunk) => chunk.name === "agent-native-icons")!;
        expect(iconsChunk.fileName).toMatch(
          /^assets\/agent-native-icons-[A-Za-z0-9_-]{16}\.js$/,
        );

        const iconModuleIds = chunkModuleIds(iconsChunk).filter((id) =>
          isFixtureIcon(id),
        );
        const emittedDump = chunks
          .map(
            (chunk) =>
              `${chunk.fileName}: ${chunkModuleIds(chunk)
                .map((id) => path.basename(id))
                .join(", ")}`,
          )
          .join("\n");
        expect(iconModuleIds, emittedDump).toHaveLength(legacy ? 3 : 1);
        if (!legacy)
          expect(iconModuleIds.map((id) => path.basename(id))).toEqual([
            "IconOmega.mjs",
          ]);
        for (const id of iconModuleIds) {
          expect(id).toMatch(/Icon(?:Alpha|Beta|Omega)\.mjs$/);
        }

        // Every used icon lives in the icons chunk, and only there.
        for (const chunk of chunks) {
          if (chunk === iconsChunk) continue;
          const initialIcons = chunkModuleIds(chunk).filter(isFixtureIcon);
          if (!legacy && chunk.name === "entry") {
            expect(initialIcons.map((id) => path.basename(id)).sort()).toEqual([
              "IconAlpha.mjs",
              "IconBeta.mjs",
            ]);
          } else {
            expect(initialIcons).toEqual([]);
          }
        }

        // The recursive-dependency capture is off: the shared runtime and the
        // optional module must not ride along in the icons chunk.
        expect(
          chunkModuleIds(iconsChunk).some((id) =>
            CREATE_RUNTIME_MODULE.test(id),
          ),
        ).toBe(false);
        expect(
          chunkModuleIds(iconsChunk).some((id) =>
            /icons[\\/]index\.mjs$/.test(id),
          ),
        ).toBe(false);
        expect(
          chunkModuleIds(iconsChunk).some((id) =>
            OPTIONAL_RUNTIME_MODULE.test(id),
          ),
        ).toBe(false);

        // The shared runtime is emitted once, preserving singleton identity.
        const runtimeChunks = chunks.filter((chunk) =>
          chunkModuleIds(chunk).some((id) => CREATE_RUNTIME_MODULE.test(id)),
        );
        expect(runtimeChunks).toHaveLength(1);

        // Optional settings stay behind a dynamic import.
        const entryChunk = chunks.find((chunk) =>
          /^assets\/entry-[A-Za-z0-9_-]{16}\.js$/.test(chunk.fileName),
        );
        const settingsChunk = chunks.find((chunk) =>
          chunkModuleIds(chunk).some((id) => SETTINGS_MODULE.test(id)),
        );
        expect(entryChunk).toBeTruthy();
        expect(settingsChunk).toBeTruthy();
        expect(entryChunk!.imports ?? []).not.toContain(
          settingsChunk!.fileName,
        );
        expect(entryChunk!.dynamicImports ?? []).toContain(
          settingsChunk!.fileName,
        );
        expect(
          chunkModuleIds(settingsChunk!).some((id) =>
            OPTIONAL_RUNTIME_MODULE.test(id),
          ),
        ).toBe(true);

        // Run the emitted bundle in a child Node process so the test's module
        // runner cannot evaluate the shared runtime a second time. This is the
        // real ESM graph: exports, lazy initialization, and singleton identity.
        const runScript = path.join(root, "run-emitted.mjs");
        fs.writeFileSync(
          runScript,
          `const entry = await import(
  new URL(process.argv[2], import.meta.url).href
);
const before = globalThis.__tablerOptionalEvals ?? 0;
const catalogBefore = globalThis.__tablerCatalogFactoryCount ?? 0;
const started = entry.start();
const settings = await entry.openSettings();
const after = globalThis.__tablerOptionalEvals ?? 0;
await entry.openIconPicker();
const catalogAfter = globalThis.__tablerCatalogFactoryCount ?? 0;
const shared = entry.components[0].registry;
console.log(JSON.stringify({
  started,
  settings,
  before,
  after,
  registryCount: globalThis.__tablerRegistryCount,
  catalogBefore, catalogAfter,
  entryShared: entry.components[1].registry === shared,
  settingsShared: globalThis.__tablerSettingsComponent?.registry === shared,
}));
`,
          "utf8",
        );
        const run = spawnSync(
          process.execPath,
          [
            runScript,
            path.relative(root, path.join(distDir, entryChunk!.fileName)),
          ],
          { cwd: root, encoding: "utf8" },
        );
        expect(run.status, run.stderr || run.stdout).toBe(0);
        const emitted = JSON.parse(run.stdout.trim().split("\n").pop()!) as {
          started: string[];
          settings: string;
          before: number;
          after: number;
          registryCount: number;
          catalogBefore: number;
          catalogAfter: number;
          entryShared: boolean;
          settingsShared: boolean;
        };
        expect(emitted.started).toEqual(["app-runtime", "alpha", "beta"]);
        expect(emitted.before).toBe(0);
        expect(emitted.settings).toBe("optional-runtime:omega");
        expect(emitted.after).toBe(1);
        expect(emitted.entryShared).toBe(true);
        expect(emitted.settingsShared).toBe(true);
        expect(emitted.registryCount).toBe(1);
        expect(emitted.catalogBefore).toBe(0);
        expect(emitted.catalogAfter).toBe(1);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.each([false, true])(
    "coalesces shared UI modules with initial imports=%s",
    async (initial) => {
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      const config = defineConfig();
      const output = config.build?.rolldownOptions?.output;
      expect(output).toBeTruthy();

      const workspaceOutput = structuredClone(output) as {
        codeSplitting?: { groups?: Array<Record<string, unknown>> };
        [key: string]: unknown;
      };
      const root = createWorkspaceUiFixture(initial);
      const distDir = path.join(root, "dist");
      try {
        const result = (await build({
          plugins: frameworkChunkPlugins(config),
          configFile: false,
          envDir: false,
          logLevel: "silent",
          root,
          build: {
            write: true,
            minify: false,
            outDir: "dist",
            emptyOutDir: true,
            modulePreload: false,
            rolldownOptions: {
              input: path.join(root, "entry.mjs"),
              experimental: config.build?.rolldownOptions?.experimental,
              preserveEntrySignatures: "exports-only",
              output: workspaceOutput,
            },
          },
        })) as { output: EmittedChunk[] };

        const chunks = result.output.filter(
          (chunk) => chunk.type === "chunk",
        ) as EmittedChunk[];
        const isUiLeaf = (id: string) => SHARED_UI_LEAF_MODULE.test(id);
        const emittedDump = chunks
          .map(
            (chunk) =>
              `${chunk.fileName}: ${chunkModuleIds(chunk)
                .map((id) => path.relative(root, id))
                .join(", ")}`,
          )
          .join("\n");

        const uiChunks = chunks.filter((chunk) =>
          chunkModuleIds(chunk).some(isUiLeaf),
        );
        expect(
          uiChunks,
          `expected exactly one UI chunk, got: ${uiChunks
            .map((chunk) => chunk.fileName)
            .join(", ")}\n${emittedDump}`,
        ).toHaveLength(1);

        const uiChunk = uiChunks[0]!;
        if (!initial) {
          expect(uiChunk.fileName).toMatch(
            /^assets\/agent-native-ui-[A-Za-z0-9_-]{16}\.js$/,
          );
        }
        const uiLeafIds = chunkModuleIds(uiChunk).filter(isUiLeaf);
        expect(uiLeafIds, emittedDump).toHaveLength(3);
        for (const id of uiLeafIds) {
          expect(id).toMatch(
            /@(?:radix-ui|floating-ui)[\\/][^\\/]+[\\/]dist[\\/]index\.mjs$/,
          );
        }

        // Every UI leaf lives in the UI chunk, and only there.
        for (const chunk of chunks) {
          if (chunk === uiChunk) continue;
          expect(chunkModuleIds(chunk).some(isUiLeaf)).toBe(false);
        }

        // The recursive-dependency capture is off: neither the React runtime nor
        // the optional settings module may ride along in the UI chunk.
        if (!initial) {
          expect(
            chunkModuleIds(uiChunk).some((id) => REACT_RUNTIME_MODULE.test(id)),
          ).toBe(false);
        }
        // With all leaves in the initial graph, Rolldown can already co-locate
        // them and React in the entry. The reserved UI group does not capture it.
        expect(
          chunkModuleIds(uiChunk).some((id) =>
            /ui-optional-runtime\.mjs$/.test(id),
          ),
        ).toBe(false);

        // The React runtime is emitted once, preserving singleton identity.
        const reactChunks = chunks.filter((chunk) =>
          chunkModuleIds(chunk).some((id) => REACT_RUNTIME_MODULE.test(id)),
        );
        expect(reactChunks).toHaveLength(1);

        // Optional settings stay behind a dynamic import.
        const entryChunk = chunks.find((chunk) =>
          /^assets\/entry-[A-Za-z0-9_-]{16}\.js$/.test(chunk.fileName),
        );
        const settingsChunk = chunks.find((chunk) =>
          chunkModuleIds(chunk).some((id) => /app[\\/]settings\.mjs$/.test(id)),
        );
        expect(entryChunk).toBeTruthy();
        expect(settingsChunk).toBeTruthy();
        expect(entryChunk!.imports ?? []).not.toContain(
          settingsChunk!.fileName,
        );
        expect(entryChunk!.dynamicImports ?? []).toContain(
          settingsChunk!.fileName,
        );
        expect(
          chunkModuleIds(settingsChunk!).some((id) =>
            /ui-optional-runtime\.mjs$/.test(id),
          ),
        ).toBe(true);

        const runScript = path.join(root, "run-emitted.mjs");
        fs.writeFileSync(
          runScript,
          `const entry = await import(
  new URL(process.argv[2], import.meta.url).href
);
const optionalBefore = globalThis.__uiOptionalEvals ?? 0;
const started = entry.start();
const leavesA = await entry.openUiA();
const leavesB = await entry.openUiB();
const leavesC = await entry.openUiC();
const optionalMid = globalThis.__uiOptionalEvals ?? 0;
const settings = await entry.openSettings();
const optionalAfter = globalThis.__uiOptionalEvals ?? 0;
const allLeaves = [...(entry.initialLeaves ?? []), ...leavesA, ...leavesB, ...leavesC];
const runtime = allLeaves[0].runtime;
const singleton = allLeaves.every((leaf) => leaf.runtime === runtime);
console.log(JSON.stringify({
  started,
  initialNames: (entry.initialLeaves ?? []).map((leaf) => leaf.name),
  namesA: leavesA.map((leaf) => leaf.name),
  namesB: leavesB.map((leaf) => leaf.name),
  namesC: leavesC.map((leaf) => leaf.name),
  optionalBefore,
  optionalMid,
  settings,
  optionalAfter,
  singleton,
  reactEvals: globalThis.__reactRuntimeEvals,
}));
`,
          "utf8",
        );
        const run = spawnSync(
          process.execPath,
          [
            runScript,
            path.relative(root, path.join(distDir, entryChunk!.fileName)),
          ],
          { cwd: root, encoding: "utf8" },
        );
        expect(run.status, run.stderr || run.stdout).toBe(0);
        const emitted = JSON.parse(run.stdout.trim().split("\n").pop()!) as {
          started: string[];
          initialNames: string[];
          namesA: string[];
          namesB: string[];
          namesC: string[];
          optionalBefore: number;
          optionalMid: number;
          settings: string;
          optionalAfter: number;
          singleton: boolean;
          reactEvals: number;
        };
        expect(emitted.started).toEqual(["ui-entry"]);
        expect(emitted.initialNames).toEqual(
          initial ? ["core", "dom", "slot"] : [],
        );
        expect(emitted.namesA).toEqual(["core", "dom"]);
        expect(emitted.namesB).toEqual(["dom", "slot"]);
        expect(emitted.namesC).toEqual(["slot", "core"]);
        expect(emitted.optionalBefore).toBe(0);
        expect(emitted.optionalMid).toBe(0);
        expect(emitted.settings).toBe("ui-optional-runtime");
        expect(emitted.optionalAfter).toBe(1);
        expect(emitted.singleton).toBe(true);
        expect(emitted.reactEvals).toBe(1);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("legacy broad group coalesces toolkit ui and design-system wrappers and excludes toolkit app features", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    const config = defineConfig();
    const output = config.build?.rolldownOptions?.output;
    expect(output).toBeTruthy();

    const workspaceOutput = structuredClone(output) as Record<string, unknown>;
    const root = createWorkspaceToolkitUiFixture();
    const distDir = path.join(root, "dist");
    try {
      const result = (await build({
        plugins: [
          ...frameworkChunkPlugins(config),
          legacyBroadToolkitUiGroupControl(),
        ],
        configFile: false,
        envDir: false,
        logLevel: "silent",
        root,
        build: {
          write: true,
          minify: false,
          outDir: "dist",
          emptyOutDir: true,
          modulePreload: false,
          rolldownOptions: {
            input: path.join(root, "entry.mjs"),
            experimental: config.build?.rolldownOptions?.experimental,
            preserveEntrySignatures: "exports-only",
            output: workspaceOutput,
          },
        },
      })) as { output: EmittedChunk[] };

      const chunks = result.output.filter(
        (chunk) => chunk.type === "chunk",
      ) as EmittedChunk[];
      const emittedDump = chunks
        .map(
          (chunk) =>
            `${chunk.fileName}: ${chunkModuleIds(chunk)
              .map((id) => path.relative(root, id))
              .join(", ")}`,
        )
        .join("\n");

      const uiChunks = chunks.filter((chunk) =>
        chunkModuleIds(chunk).some((id) => TOOLKIT_UI_LEAF_MODULE.test(id)),
      );
      expect(
        uiChunks,
        `expected exactly one toolkit UI chunk, got: ${uiChunks
          .map((chunk) => chunk.fileName)
          .join(", ")}\n${emittedDump}`,
      ).toHaveLength(1);

      const uiChunk = uiChunks[0]!;
      expect(uiChunk.fileName).toMatch(
        /^assets\/agent-native-ui-[A-Za-z0-9_-]{16}\.js$/,
      );
      const toolkitLeafIds = chunkModuleIds(uiChunk).filter((id) =>
        TOOLKIT_UI_LEAF_MODULE.test(id),
      );
      expect(toolkitLeafIds, emittedDump).toHaveLength(4);
      for (const id of toolkitLeafIds) {
        expect(id).toMatch(
          /packages[\\/]toolkit[\\/](?:src|dist)[\\/](?:ui|design-system)[\\/].*\.mjs$/,
        );
      }

      // Every toolkit UI/design-system leaf lives in the UI chunk, and only
      // there.
      for (const chunk of chunks) {
        if (chunk === uiChunk) continue;
        expect(
          chunkModuleIds(chunk).some((id) => TOOLKIT_UI_LEAF_MODULE.test(id)),
        ).toBe(false);
      }

      // The recursive-dependency capture is off and the group is scoped to
      // first-party UI paths: toolkit app features and the shared React
      // runtime must never be captured into the UI chunk.
      expect(
        chunkModuleIds(uiChunk).some((id) => TOOLKIT_APP_MODULE.test(id)),
      ).toBe(false);
      expect(
        chunkModuleIds(uiChunk).some((id) => REACT_RUNTIME_MODULE.test(id)),
      ).toBe(false);

      const reactChunks = chunks.filter((chunk) =>
        chunkModuleIds(chunk).some((id) => REACT_RUNTIME_MODULE.test(id)),
      );
      expect(reactChunks).toHaveLength(1);

      // The optional toolkit app feature stays behind a dynamic import.
      const entryChunk = chunks.find((chunk) =>
        /^assets\/entry-[A-Za-z0-9_-]{16}\.js$/.test(chunk.fileName),
      );
      const optionalChunk = chunks.find((chunk) =>
        chunkModuleIds(chunk).some((id) =>
          /packages[\\/]toolkit[\\/](?:src|dist)[\\/]app[\\/]optional-feature\.mjs$/.test(
            id,
          ),
        ),
      );
      expect(entryChunk).toBeTruthy();
      expect(optionalChunk).toBeTruthy();
      expect(entryChunk!.imports ?? []).not.toContain(optionalChunk!.fileName);
      expect(entryChunk!.dynamicImports ?? []).toContain(
        optionalChunk!.fileName,
      );
      expect(
        chunkModuleIds(optionalChunk!).some((id) =>
          /packages[\\/]toolkit[\\/](?:src|dist)[\\/]app[\\/]optional-runtime\.mjs$/.test(
            id,
          ),
        ),
      ).toBe(true);

      const runScript = path.join(root, "run-emitted.mjs");
      fs.writeFileSync(
        runScript,
        `const entry = await import(
  new URL(process.argv[2], import.meta.url).href
);
const optionalBefore = globalThis.__toolkitAppOptionalEvals ?? 0;
const started = entry.start();
const leavesA = await entry.openUiA();
const leavesB = await entry.openUiB();
const leavesC = await entry.openUiC();
const optionalMid = globalThis.__toolkitAppOptionalEvals ?? 0;
const settings = await entry.openOptional();
const optionalAfter = globalThis.__toolkitAppOptionalEvals ?? 0;
const allLeaves = [...leavesA, ...leavesB, ...leavesC];
const runtime = allLeaves[0].runtime;
const singleton = allLeaves.every((leaf) => leaf.runtime === runtime);
console.log(JSON.stringify({
  started,
  namesA: leavesA.map((leaf) => leaf.name),
  namesB: leavesB.map((leaf) => leaf.name),
  namesC: leavesC.map((leaf) => leaf.name),
  optionalBefore,
  optionalMid,
  settings,
  optionalAfter,
  singleton,
  reactEvals: globalThis.__reactRuntimeEvals,
}));
`,
        "utf8",
      );
      const run = spawnSync(
        process.execPath,
        [
          runScript,
          path.relative(root, path.join(distDir, entryChunk!.fileName)),
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(run.status, run.stderr || run.stdout).toBe(0);
      const emitted = JSON.parse(run.stdout.trim().split("\n").pop()!) as {
        started: string[];
        namesA: string[];
        namesB: string[];
        namesC: string[];
        optionalBefore: number;
        optionalMid: number;
        settings: string;
        optionalAfter: number;
        singleton: boolean;
        reactEvals: number;
      };
      expect(emitted.started).toEqual(["toolkit-ui-entry"]);
      expect(emitted.namesA).toEqual(["uiA", "uiB", "dsA"]);
      expect(emitted.namesB).toEqual(["uiB", "uiC", "dsA"]);
      expect(emitted.namesC).toEqual(["uiC", "uiA", "dsA"]);
      expect(emitted.optionalBefore).toBe(0);
      expect(emitted.optionalMid).toBe(0);
      expect(emitted.settings).toBe("toolkit-app-optional");
      expect(emitted.optionalAfter).toBe(1);
      expect(emitted.singleton).toBe(true);
      expect(emitted.reactEvals).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("current default leaves coupled fixture wrappers to automatic chunking and keeps optional features out of the initial graph", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    const config = defineConfig();
    const output = config.build?.rolldownOptions?.output;
    expect(output).toBeTruthy();

    const workspaceOutput = structuredClone(output) as Record<string, unknown>;
    const root = createWorkspaceToolkitUiFixture();
    const distDir = path.join(root, "dist");
    try {
      const result = (await build({
        plugins: frameworkChunkPlugins(config),
        configFile: false,
        envDir: false,
        logLevel: "silent",
        root,
        build: {
          write: true,
          minify: false,
          outDir: "dist",
          emptyOutDir: true,
          modulePreload: false,
          rolldownOptions: {
            input: path.join(root, "entry.mjs"),
            experimental: config.build?.rolldownOptions?.experimental,
            preserveEntrySignatures: "exports-only",
            output: workspaceOutput,
          },
        },
      })) as { output: EmittedChunk[] };

      const chunks = result.output.filter(
        (chunk) => chunk.type === "chunk",
      ) as EmittedChunk[];
      const emittedDump = chunks
        .map(
          (chunk) =>
            `${chunk.fileName}: ${chunkModuleIds(chunk)
              .map((id) => path.relative(root, id))
              .join(", ")}`,
        )
        .join("\n");

      // Current Core scopes `agent-native-ui` to Radix/Floating primitives; it
      // must not capture first-party toolkit wrappers.
      const capturedUiChunks = chunks.filter(
        (chunk) =>
          chunk.name === "agent-native-ui" &&
          chunkModuleIds(chunk).some((id) => TOOLKIT_UI_LEAF_MODULE.test(id)),
      );
      expect(
        capturedUiChunks,
        `agent-native-ui must not capture toolkit wrappers\n${emittedDump}`,
      ).toHaveLength(0);

      // The optional toolkit app feature stays behind a dynamic import and out
      // of the initial graph. No exact legacy chunk count is demanded in this
      // mode: the automatic chunker is free to place the wrappers.
      const entryChunk = chunks.find((chunk) =>
        /^assets\/entry-[A-Za-z0-9_-]{16}\.js$/.test(chunk.fileName),
      );
      const optionalChunk = chunks.find((chunk) =>
        chunkModuleIds(chunk).some((id) =>
          /packages[\\/]toolkit[\\/](?:src|dist)[\\/]app[\\/]optional-feature\.mjs$/.test(
            id,
          ),
        ),
      );
      expect(entryChunk).toBeTruthy();
      expect(optionalChunk).toBeTruthy();
      expect(entryChunk!.imports ?? []).not.toContain(optionalChunk!.fileName);
      expect(entryChunk!.dynamicImports ?? []).toContain(
        optionalChunk!.fileName,
      );
      const closure = staticImportClosure(chunks, entryChunk!);
      const closureDump = closure
        .map(
          (chunk) =>
            `${chunk.fileName}: ${chunkModuleIds(chunk)
              .map((id) => path.relative(root, id))
              .join(", ")}`,
        )
        .join("\n");
      expect(
        closure.some((chunk) =>
          chunkModuleIds(chunk).some((id) =>
            /packages[\\/]toolkit[\\/](?:src|dist)[\\/]app[\\/]optional-(?:feature|runtime)\.mjs$/.test(
              id,
            ),
          ),
        ),
        `initial graph must not include optional toolkit features\n${closureDump}`,
      ).toBe(false);

      const runScript = path.join(root, "run-emitted.mjs");
      fs.writeFileSync(
        runScript,
        `const entry = await import(
  new URL(process.argv[2], import.meta.url).href
);
const optionalBefore = globalThis.__toolkitAppOptionalEvals ?? 0;
const started = entry.start();
const leavesA = await entry.openUiA();
const leavesB = await entry.openUiB();
const leavesC = await entry.openUiC();
const optionalMid = globalThis.__toolkitAppOptionalEvals ?? 0;
const settings = await entry.openOptional();
const optionalAfter = globalThis.__toolkitAppOptionalEvals ?? 0;
const allLeaves = [...leavesA, ...leavesB, ...leavesC];
const runtime = allLeaves[0].runtime;
const singleton = allLeaves.every((leaf) => leaf.runtime === runtime);
console.log(JSON.stringify({
  started,
  namesA: leavesA.map((leaf) => leaf.name),
  namesB: leavesB.map((leaf) => leaf.name),
  namesC: leavesC.map((leaf) => leaf.name),
  optionalBefore,
  optionalMid,
  settings,
  optionalAfter,
  singleton,
  reactEvals: globalThis.__reactRuntimeEvals,
}));
`,
        "utf8",
      );
      const run = spawnSync(
        process.execPath,
        [
          runScript,
          path.relative(root, path.join(distDir, entryChunk!.fileName)),
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(run.status, run.stderr || run.stdout).toBe(0);
      const emitted = JSON.parse(run.stdout.trim().split("\n").pop()!) as {
        started: string[];
        namesA: string[];
        namesB: string[];
        namesC: string[];
        optionalBefore: number;
        optionalMid: number;
        settings: string;
        optionalAfter: number;
        singleton: boolean;
        reactEvals: number;
      };
      expect(emitted.started).toEqual(["toolkit-ui-entry"]);
      expect(emitted.namesA).toEqual(["uiA", "uiB", "dsA"]);
      expect(emitted.namesB).toEqual(["uiB", "uiC", "dsA"]);
      expect(emitted.namesC).toEqual(["uiC", "uiA", "dsA"]);
      expect(emitted.optionalBefore).toBe(0);
      expect(emitted.optionalMid).toBe(0);
      expect(emitted.settings).toBe("toolkit-app-optional");
      expect(emitted.optionalAfter).toBe(1);
      expect(emitted.singleton).toBe(true);
      expect(emitted.reactEvals).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
