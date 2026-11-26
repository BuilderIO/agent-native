import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { build } from "vite";
import { describe, expect, it } from "vitest";

import { toolkitMessagesForLocale } from "./catalog.js";

// Exercise the same public entry that app builds import.
const TOOLKIT_LAZY_ENTRY = path.resolve(import.meta.dirname, "../i18n.ts");

const ALL_LOCALES = [
  "en-US",
  "zh-CN",
  "zh-TW",
  "es-ES",
  "fr-FR",
  "de-DE",
  "ja-JP",
  "ko-KR",
  "pt-BR",
  "hi-IN",
  "ar-SA",
];
const NON_SOURCE_LOCALES = ALL_LOCALES.filter((locale) => locale !== "en-US");

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

function moduleIds(chunk: EmittedChunk): string[] {
  if (Array.isArray(chunk.moduleIds)) return chunk.moduleIds;
  return Object.keys(chunk.modules ?? {});
}

function catalogLocale(moduleId: string): string | undefined {
  return /catalogs[\\/]([a-zA-Z-]+)\.ts/.exec(moduleId)?.[1];
}

function writeFixtureFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

/**
 * The real Toolkit `i18n.ts` with a self-contained stand-in for
 * `@agent-native/core/client/i18n`, so the emitted bundle can run under Node
 * without the framework. The stand-in preserves the loader contract the
 * factory relies on.
 */
function createBundleFixture(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "an-lazy-toolkit-locales-spec-"),
  );
  writeFixtureFile(
    path.join(root, "core-i18n.mjs"),
    `export const SUPPORTED_LOCALES = ${JSON.stringify(ALL_LOCALES)};
export function createAgentNativeI18nCatalog(args) {
  return {
    namespace: args.namespace,
    sourceLocale: args.sourceLocale ?? "en-US",
    messages: args.messages,
    locales: args.locales,
    coreMessageOverrides: args.coreMessageOverrides,
    supportedLocales: args.supportedLocales,
    restrictToCatalogLocales: args.restrictToCatalogLocales,
    loadMessages: async (locale) => {
      const loader = args.localeLoaders?.[locale];
      if (!loader) return null;
      const value = await loader();
      if (
        value &&
        typeof value === "object" &&
        Object.prototype.toString.call(value) === "[object Module]"
      ) {
        return value.default;
      }
      return value;
    },
  };
}
`,
  );
  writeFixtureFile(
    path.join(root, "entry.mjs"),
    `import { createToolkitI18nCatalog } from "@fixture/toolkit-lazy";

export const catalog = createToolkitI18nCatalog({
  messages: { app: { greeting: "hello" } },
});
`,
  );
  return root;
}

describe("lazy Toolkit locales emitted bundle", () => {
  it.each([
    ["client", true],
    ["ssr", true],
    ["client", false],
    ["ssr", false],
  ] as const)(
    "preserves the %s public bundle contract with opt-in=%s",
    async (environment, optIn) => {
      const root = createBundleFixture();
      const distDir = path.join(root, "dist");
      try {
        const result = (await build({
          configFile: false,
          envDir: false,
          logLevel: "silent",
          root,
          define: {
            __AGENT_NATIVE_LAZY_TOOLKIT_LOCALES__: JSON.stringify(optIn),
          },
          resolve: {
            alias: [
              {
                find: "@agent-native/core/client/i18n",
                replacement: path.join(root, "core-i18n.mjs"),
              },
              {
                find: "@fixture/toolkit-lazy",
                replacement: TOOLKIT_LAZY_ENTRY,
              },
            ],
          },
          build: {
            ssr: environment === "ssr",
            write: true,
            minify: false,
            outDir: "dist",
            emptyOutDir: true,
            modulePreload: false,
            rolldownOptions: {
              input: path.join(root, "entry.mjs"),
              // Preserve the entry exports so the factory call is kept and the
              // lazy `import()` calls become real chunks instead of being
              // tree-shaken with the unused entry binding.
              preserveEntrySignatures: "strict",
            },
          },
        })) as { output: EmittedChunk[] };

        const chunks = result.output.filter(
          (chunk) => chunk.type === "chunk",
        ) as EmittedChunk[];
        const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
        const entryChunk = chunks.find((chunk) => chunk.isEntry);
        expect(entryChunk).toBeTruthy();

        const staticClosure = new Set<string>();
        const visit = (fileName: string) => {
          if (staticClosure.has(fileName)) return;
          staticClosure.add(fileName);
          for (const imported of byFile.get(fileName)?.imports ?? []) {
            visit(imported);
          }
        };
        visit(entryChunk!.fileName);
        const staticModules = [...staticClosure].flatMap((fileName) =>
          moduleIds(byFile.get(fileName)!),
        );
        const emittedDump = chunks
          .map(
            (chunk) =>
              `${chunk.fileName}: ${moduleIds(chunk)
                .map((id) => catalogLocale(id) ?? path.basename(id))
                .join(", ")}`,
          )
          .join("\n");

        expect(
          staticModules.some((id) => catalogLocale(id) === "en-US"),
          emittedDump,
        ).toBe(true);
        if (optIn) {
          for (const locale of NON_SOURCE_LOCALES) {
            expect(
              staticModules.some((id) => catalogLocale(id) === locale),
              `${locale} must not be in the static closure\n${emittedDump}`,
            ).toBe(false);
          }
          expect(
            chunks.some((chunk) =>
              moduleIds(chunk).some((id) => /i18n[\\/]catalog\.ts$/.test(id)),
            ),
            `the synchronous aggregate must be excluded\n${emittedDump}`,
          ).toBe(false);

          // Every non-source locale is emitted as a lazy chunk, exactly once.
          for (const locale of NON_SOURCE_LOCALES) {
            const owners = chunks.filter((chunk) =>
              moduleIds(chunk).some((id) => catalogLocale(id) === locale),
            );
            expect(
              owners,
              `${locale} lazy chunk count\n${emittedDump}`,
            ).toHaveLength(1);
            expect(staticClosure.has(owners[0]!.fileName)).toBe(false);
            expect(owners[0]!.code.length).toBeGreaterThan(0);
          }
        } else {
          expect(
            staticModules.some((id) => /i18n[\\/]catalog\.ts$/.test(id)),
          ).toBe(true);
          for (const locale of ALL_LOCALES) {
            const owners = chunks.filter((chunk) =>
              moduleIds(chunk).some((id) => catalogLocale(id) === locale),
            );
            expect(
              owners,
              `${locale} default catalog count\n${emittedDump}`,
            ).toHaveLength(1);
            expect(staticClosure.has(owners[0]!.fileName)).toBe(true);
          }
          expect(
            chunks.some((chunk) =>
              moduleIds(chunk).some((id) => /i18n[\\/]lazy\.ts$/.test(id)),
            ),
          ).toBe(false);
          expect(chunks.every((chunk) => !chunk.dynamicImports?.length)).toBe(
            true,
          );
        }

        // Run the emitted bundle: the lazy chunks execute and return the same
        // messages as the synchronous aggregate.
        const runScript = path.join(root, "run-emitted.mjs");
        fs.writeFileSync(
          runScript,
          `const entry = await import(
  new URL(process.argv[2], import.meta.url).href
);
const es = await entry.catalog.loadMessages("es-ES");
const esAgain = await entry.catalog.loadMessages("es-ES");
const fr = await entry.catalog.loadMessages("fr-FR");
console.log(JSON.stringify({
  sourceLocale: entry.catalog.sourceLocale,
  es: es?.agentChat?.composer?.submitFailed ?? null,
  esAgain: esAgain?.agentChat?.composer?.submitFailed ?? null,
  fr: fr?.agentChat?.composer?.submitFailed ?? null,
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
          sourceLocale: string;
          es: string | null;
          esAgain: string | null;
          fr: string | null;
        };
        const esMessages = toolkitMessagesForLocale("es-ES") as {
          agentChat: { composer: { submitFailed: string } };
        };
        const frMessages = toolkitMessagesForLocale("fr-FR") as {
          agentChat: { composer: { submitFailed: string } };
        };
        expect(emitted.sourceLocale).toBe("en-US");
        expect(emitted.es).toBe(esMessages.agentChat.composer.submitFailed);
        expect(emitted.esAgain).toBe(emitted.es);
        expect(emitted.fr).toBe(frMessages.agentChat.composer.submitFailed);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
