import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { build, resolveConfig } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "./client.js";

/**
 * Workspace manual groups must preserve lazy feature boundaries. The legacy
 * broad first-party group reproduces an initialization TypeError; forcing
 * strict execution fixes that cycle but adds optional bodies to startup.
 * Keep both controls, then prove the current primitive-only Core default has
 * no initial dependency on the lazy home/Calendar modules and executes safely.
 */

interface EmittedChunk {
  type: string;
  fileName: string;
  code: string;
  isEntry?: boolean;
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

/**
 * A toolkit UI `Button` (A), a toolkit design-system `Calendar` (B) that
 * statically pulls the app home route, and a home route that reads A at module
 * evaluation time. settings/details both import A+B so the real UI group
 * captures them (minShareCount 2). The initial entry imports A only; it never
 * imports home, so the UI->home cycle is created by the group itself.
 */
function createWorkspaceRuntimeFixture(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "an-workspace-runtime-spec-"),
  );

  writeFixtureFile(
    path.join(root, "runtime.mjs"),
    `globalThis.__runtimeEvals = (globalThis.__runtimeEvals ?? 0) + 1;
export const runtime = { id: "runtime-singleton" };
`,
  );

  writeFixtureFile(
    path.join(root, "packages/toolkit/src/ui/button.mjs"),
    `import { runtime } from "../../../../runtime.mjs";
globalThis.__buttonInits = (globalThis.__buttonInits ?? 0) + 1;
export var Button;
Button = { ready: "button-ready", runtime };
export default Button;
`,
  );

  writeFixtureFile(
    path.join(root, "packages/toolkit/src/design-system/calendar.mjs"),
    `import { runtime } from "../../../../runtime.mjs";
import { readDate } from "../../../../app/home.mjs";
export const Calendar = { readDate, runtime };
export default Calendar;
`,
  );

  writeFixtureFile(
    path.join(root, "app/home.mjs"),
    `import * as ui from "../packages/toolkit/src/ui/button.mjs";
globalThis.__homeInits = (globalThis.__homeInits ?? 0) + 1;
// Top-level read of the captured UI export: this is the real failure point
// when the UI chunk has not initialized before the grouped dependency.
export const observedReady = ui.Button.ready;
export function readDate() {
  return "2026-01-01";
}
export function openHome() {
  globalThis.__homeOpened = (globalThis.__homeOpened ?? 0) + 1;
  return { date: readDate(), ready: observedReady };
}
`,
  );

  for (const name of ["settings", "details"] as const) {
    writeFixtureFile(
      path.join(root, `app/${name}.mjs`),
      `import { Calendar } from "../packages/toolkit/src/design-system/calendar.mjs";
import { Button } from "../packages/toolkit/src/ui/button.mjs";
export const routeName = "${name}";
export { Button, Calendar };
`,
    );
  }

  writeFixtureFile(
    path.join(root, "entry.mjs"),
    `const { Button } = await import("./packages/toolkit/src/ui/button.mjs");
export const initialButton = Button;
export async function openSettings() {
  const settings = await import("./app/settings.mjs");
  return { name: settings.routeName, sameButton: settings.Button === Button };
}
export async function openDetails() {
  const details = await import("./app/details.mjs");
  return { name: details.routeName, sameButton: details.Button === Button };
}
export async function openHome() {
  return (await import("./app/home.mjs")).openHome();
}
`,
  );

  return root;
}

function workspaceFrameworkPlugins(config: ReturnType<typeof defineConfig>) {
  return (config.plugins ?? [])
    .flat(Infinity)
    .filter(
      (plugin: any) =>
        plugin?.name === "agent-native-rolldown-input-fix" ||
        plugin?.name === "agent-native-workspace-icon-chunks",
    ) as any[];
}

/**
 * Legacy control only. Runs after the real Core `workspaceIconChunks` hook
 * (`enforce: "post"`) and restores the removed pre-R13 behavior *inside the
 * fixture*: the broad `agent-native-ui` group that also captured first-party
 * toolkit `ui`/`design-system` wrappers, plus the old output-wide
 * `strictExecutionOrder` value. The current Core default captures
 * Radix/Floating primitives only and does not force strict order.
 */
function legacyBroadUiGroupControl(
  strictExecutionOrder: boolean | undefined,
): any {
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
        if (typeof strictExecutionOrder === "boolean") {
          output.strictExecutionOrder = strictExecutionOrder;
        }
        const splitting =
          typeof output.codeSplitting === "object" ? output.codeSplitting : {};
        const groups = [...(splitting.groups ?? [])];
        const legacyTest = (id: string) =>
          /node_modules[\\/]@(?:radix-ui|floating-ui)[\\/][^\\/]+[\\/]/.test(
            id,
          ) ||
          /packages[\\/]toolkit[\\/](?:src|dist)[\\/](?:ui|design-system)[\\/]/.test(
            id,
          );
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

type RuntimeBuildMode = "current" | "legacy-baseline" | "legacy-strict";

async function emitFixture(
  root: string,
  mode: RuntimeBuildMode,
): Promise<{ chunks: EmittedChunk[]; distDir: string }> {
  vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
  const config = defineConfig();
  const output = config.build?.rolldownOptions?.output;
  expect(output).toBeTruthy();

  const workspaceOutput = structuredClone(output) as Record<string, unknown>;
  const plugins =
    mode === "current"
      ? workspaceFrameworkPlugins(config)
      : [
          ...workspaceFrameworkPlugins(config),
          legacyBroadUiGroupControl(mode === "legacy-strict"),
        ];

  const distDir = path.join(root, `dist-${mode}`);
  const result = (await build({
    plugins,
    configFile: false,
    envDir: false,
    logLevel: "silent",
    root,
    build: {
      write: true,
      minify: false,
      outDir: path.relative(root, distDir),
      emptyOutDir: true,
      modulePreload: false,
      rolldownOptions: {
        input: path.join(root, "entry.mjs"),
        experimental: config.build?.rolldownOptions?.experimental,
        preserveEntrySignatures: "allow-extension",
        output: workspaceOutput,
      },
    },
  })) as { output: EmittedChunk[] };

  const chunks = result.output.filter(
    (chunk) => chunk.type === "chunk",
  ) as EmittedChunk[];
  return { chunks, distDir };
}

function effectiveStrictOrder(resolved: any): unknown {
  const effective = resolved.environments.client.build.rolldownOptions
    .output as any;
  return (Array.isArray(effective) ? effective[0] : effective)
    ?.strictExecutionOrder;
}

/** Legacy control: the injected broad group drives strict order false/true. */
async function resolvedLegacyStrictOrder(
  root: string,
  strictExecutionOrder: boolean,
): Promise<unknown> {
  vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
  const config = defineConfig();
  const resolved = await resolveConfig(
    {
      configFile: false,
      envDir: false,
      root,
      plugins: [
        ...workspaceFrameworkPlugins(config),
        legacyBroadUiGroupControl(strictExecutionOrder),
      ],
      environments: { client: {} },
      build: {
        rolldownOptions: {
          output: structuredClone(config.build?.rolldownOptions?.output),
        },
      },
    },
    "build",
  );
  return effectiveStrictOrder(resolved);
}

/** Current Core default must not force strict order. */
async function resolvedDefaultStrictOrder(root: string): Promise<unknown> {
  vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
  const config = defineConfig();
  const resolved = await resolveConfig(
    {
      configFile: false,
      envDir: false,
      root,
      plugins: workspaceFrameworkPlugins(config),
      environments: { client: {} },
      build: {
        rolldownOptions: {
          output: structuredClone(config.build?.rolldownOptions?.output),
        },
      },
    },
    "build",
  );
  return effectiveStrictOrder(resolved);
}

/** Current Core must retain an explicitly user-configured strict order. */
async function resolvedUserStrictOrder(
  root: string,
  value: boolean,
): Promise<unknown> {
  vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
  const config = defineConfig();
  const userOutput = structuredClone(
    config.build?.rolldownOptions?.output,
  ) as any;
  for (const output of Array.isArray(userOutput) ? userOutput : [userOutput]) {
    if (output && output.codeSplitting !== false) {
      output.strictExecutionOrder = value;
    }
  }
  const resolved = await resolveConfig(
    {
      configFile: false,
      envDir: false,
      root,
      plugins: workspaceFrameworkPlugins(config),
      environments: { client: {} },
      build: { rolldownOptions: { output: userOutput } },
    },
    "build",
  );
  return effectiveStrictOrder(resolved);
}

function runEmitted(
  root: string,
  distDir: string,
  chunks: EmittedChunk[],
): {
  ok: boolean;
  error?: string;
  errorName?: string;
  initialReady?: string;
  settings?: { name: string; sameButton: boolean };
  details?: { name: string; sameButton: boolean };
  home?: { date: string; ready: string };
  homeOpenedBefore?: number;
  homeOpenedAfter?: number;
  runtimeEvals?: number;
  buttonInits?: number;
  homeInits?: number;
} {
  const entryChunk = chunks.find((chunk) => chunk.isEntry);
  expect(entryChunk).toBeTruthy();
  const runScript = path.join(root, "run-emitted.mjs");
  fs.writeFileSync(
    runScript,
    `const out = (value) => console.log(JSON.stringify(value));
// Node has no DOM. The emitted preload helper only needs these to report the
// real chunk-load error instead of masking it with "window is not defined".
globalThis.window ??= {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.document ??= {
  getElementsByTagName: () => [],
  querySelector: () => null,
  createElement: () => ({
    setAttribute() {},
    addEventListener() {},
    appendChild() {},
  }),
  head: { appendChild() {} },
};
try {
  const entry = await import(new URL(process.argv[2], import.meta.url).href);
  const initialReady = entry.initialButton?.ready;
  const runtimeEvals = globalThis.__runtimeEvals ?? 0;
  const settings = await entry.openSettings();
  const details = await entry.openDetails();
  const homeOpenedBefore = globalThis.__homeOpened ?? 0;
  const home = await entry.openHome();
  const homeOpenedAfter = globalThis.__homeOpened ?? 0;
  out({
    ok: true,
    initialReady,
    settings,
    details,
    home,
    homeOpenedBefore,
    homeOpenedAfter,
    runtimeEvals,
    buttonInits: globalThis.__buttonInits ?? 0,
    homeInits: globalThis.__homeInits ?? 0,
  });
} catch (error) {
  out({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : typeof error,
  });
}
`,
    "utf8",
  );
  const run = spawnSync(
    process.execPath,
    [runScript, path.relative(root, path.join(distDir, entryChunk!.fileName))],
    { cwd: root, encoding: "utf8" },
  );
  expect(run.status, run.stderr || run.stdout).toBe(0);
  return JSON.parse(run.stdout.trim().split("\n").pop()!);
}

/**
 * Static (non-dynamic) import closure from a chunk. Dynamic imports are the
 * boundary that keeps optional routes out of the initial graph, so they are
 * deliberately not followed.
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

describe("workspace agent-native-ui chunk execution order", () => {
  it("legacy broad group proves the cycle fails without strict order and recovers with it", async () => {
    const root = createWorkspaceRuntimeFixture();
    try {
      const baselineOrder = await resolvedLegacyStrictOrder(root, false);
      const fixedOrder = await resolvedLegacyStrictOrder(root, true);
      expect(baselineOrder).toBe(false);
      expect(fixedOrder).toBe(true);

      const baseline = await emitFixture(root, "legacy-baseline");
      const fixed = await emitFixture(root, "legacy-strict");

      const baselineEntry = baseline.chunks.find((chunk) => chunk.isEntry)!;
      const fixedEntry = fixed.chunks.find((chunk) => chunk.isEntry)!;
      expect(baselineEntry).toBeTruthy();
      expect(fixedEntry).toBeTruthy();

      const uiChunks = fixed.chunks.filter((chunk) =>
        chunkModuleIds(chunk).some(
          (id) =>
            /toolkit[\\/]src[\\/]ui[\\/]button\.mjs$/.test(id) ||
            /toolkit[\\/]src[\\/]design-system[\\/]calendar\.mjs$/.test(id),
        ),
      );
      const emittedDump = fixed.chunks
        .map(
          (chunk) =>
            `${chunk.fileName}: ${chunkModuleIds(chunk)
              .map((id) => path.relative(root, id))
              .join(", ")}`,
        )
        .join("\n");
      expect(
        uiChunks,
        `expected one merged agent-native-ui chunk\n${emittedDump}`,
      ).toHaveLength(1);
      const uiChunk = uiChunks[0]!;
      const uiIds = chunkModuleIds(uiChunk);
      expect(
        uiIds.some((id) => /toolkit[\\/]src[\\/]ui[\\/]button\.mjs$/.test(id)),
        emittedDump,
      ).toBe(true);
      expect(
        uiIds.some((id) =>
          /toolkit[\\/]src[\\/]design-system[\\/]calendar\.mjs$/.test(id),
        ),
        emittedDump,
      ).toBe(true);

      const homeChunks = fixed.chunks.filter((chunk) =>
        chunkModuleIds(chunk).some((id) => /app[\\/]home\.mjs$/.test(id)),
      );
      expect(homeChunks).toHaveLength(1);
      const homeChunk = homeChunks[0]!;
      expect(homeChunk.fileName).not.toBe(uiChunk.fileName);

      // The legacy manual group created the real cycle in the emitted graph.
      expect(uiChunk.imports ?? []).toContain(homeChunk.fileName);
      expect(homeChunk.imports ?? []).toContain(uiChunk.fileName);

      // Legacy baseline (strictExecutionOrder off) must fail while loading the
      // initial entry because home reads the uninitialized Button export.
      const baselineRun = runEmitted(root, baseline.distDir, baseline.chunks);
      expect(baselineRun.ok, JSON.stringify(baselineRun)).toBe(false);
      expect(baselineRun.errorName, JSON.stringify(baselineRun)).toBe(
        "TypeError",
      );
      expect(baselineRun.error).toMatch(/ready|undefined|null/i);

      // Legacy strict control must load and keep the singleton identity and
      // deferred home side effects.
      const fixedRun = runEmitted(root, fixed.distDir, fixed.chunks);
      expect(fixedRun.ok, JSON.stringify(fixedRun)).toBe(true);
      expect(fixedRun.initialReady).toBe("button-ready");
      expect(fixedRun.settings).toEqual({
        name: "settings",
        sameButton: true,
      });
      expect(fixedRun.details).toEqual({
        name: "details",
        sameButton: true,
      });
      expect(fixedRun.home).toEqual({
        date: "2026-01-01",
        ready: "button-ready",
      });
      expect(fixedRun.homeOpenedBefore).toBe(0);
      expect(fixedRun.homeOpenedAfter).toBe(1);
      expect(fixedRun.runtimeEvals).toBe(1);
      expect(fixedRun.buttonInits).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("current default does not force strict order and keeps optional routes out of the initial Button closure", async () => {
    const root = createWorkspaceRuntimeFixture();
    try {
      const defaultOrder = await resolvedDefaultStrictOrder(root);
      expect(defaultOrder).toBeUndefined();
      for (const value of [false, true]) {
        const userOrder = await resolvedUserStrictOrder(root, value);
        expect(userOrder).toBe(value);
      }

      const current = await emitFixture(root, "current");
      const currentEntry = current.chunks.find((chunk) => chunk.isEntry)!;
      expect(currentEntry).toBeTruthy();

      const buttonChunks = current.chunks.filter((chunk) =>
        chunkModuleIds(chunk).some((id) =>
          /toolkit[\\/]src[\\/]ui[\\/]button\.mjs$/.test(id),
        ),
      );
      expect(buttonChunks).toHaveLength(1);
      const buttonChunk = buttonChunks[0]!;
      const closure = staticImportClosure(current.chunks, buttonChunk);
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
          chunkModuleIds(chunk).some((id) => /app[\\/]home\.mjs$/.test(id)),
        ),
        `initial Button static closure must not reach home\n${closureDump}`,
      ).toBe(false);
      expect(
        closure.some((chunk) =>
          chunkModuleIds(chunk).some((id) =>
            /toolkit[\\/]src[\\/]design-system[\\/]calendar\.mjs$/.test(id),
          ),
        ),
        `initial Button static closure must not reach Calendar\n${closureDump}`,
      ).toBe(false);

      const run = runEmitted(root, current.distDir, current.chunks);
      expect(run.ok, JSON.stringify(run)).toBe(true);
      expect(run.initialReady).toBe("button-ready");
      expect(run.settings).toEqual({ name: "settings", sameButton: true });
      expect(run.details).toEqual({ name: "details", sameButton: true });
      expect(run.home).toEqual({
        date: "2026-01-01",
        ready: "button-ready",
      });
      expect(run.homeOpenedBefore).toBe(0);
      expect(run.homeOpenedAfter).toBe(1);
      expect(run.runtimeEvals).toBe(1);
      expect(run.buttonInits).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
