/**
 * Guard tests for the bridge compile-time pipeline.
 *
 * Three invariants enforced here:
 *
 * 1. NO runtime imports — every *.bridge.ts source must be free of
 *    `import … from` and `require(` statements (type-only imports that are
 *    erased by tsc are caught here too; authors should simply not import
 *    anything rather than relying on the "type-only erasure" loophole, since
 *    the esbuild step would bundle them inline anyway).
 *
 * 2. BRIDGE TSCONFIG CLEAN — `tsc -p bridge/tsconfig.json` must exit 0,
 *    proving every *.bridge.ts is valid under the scoped DOM-only environment
 *    with no app path aliases. This catches app type leaks at CI time.
 *
 * 3. FRESHNESS — the committed .generated/bridge/*.generated.ts content must
 *    exactly match what re-running codegen produces right now. If a *.bridge.ts
 *    was edited without re-running codegen, this test fails with a diff.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const designRoot = resolve(__dirname, "../../../..");
const bridgeDir = __dirname;
const generatedDir = join(designRoot, ".generated", "bridge");

// ── helpers ────────────────────────────────────────────────────────────────

function getBridgeFiles(): string[] {
  return readdirSync(bridgeDir)
    .filter((f) => f.endsWith(".bridge.ts"))
    .sort();
}

function generatedPath(bridgeFilename: string): string {
  const name = bridgeFilename.replace(/\.bridge\.ts$/, "");
  return join(generatedDir, `${name}.generated.ts`);
}

// ── test 1: no runtime imports ─────────────────────────────────────────────

describe("bridge source files", () => {
  const bridgeFiles = getBridgeFiles();

  it("has at least one *.bridge.ts file", () => {
    expect(bridgeFiles.length).toBeGreaterThan(0);
  });

  for (const filename of bridgeFiles) {
    it(`${filename} — no runtime import/require statements`, () => {
      const src = readFileSync(join(bridgeDir, filename), "utf-8");

      // Strip line comments so we don't flag commented-out examples.
      const stripped = src.replace(/\/\/[^\n]*/g, "");

      // Strip block comments.
      const noComments = stripped.replace(/\/\*[\s\S]*?\*\//g, "");

      const hasImport = /\bimport\s+(?:type\s+)?(?:\*|{|[a-zA-Z_$])/.test(
        noComments,
      );
      const hasRequire = /\brequire\s*\(/.test(noComments);

      expect(
        hasImport || hasRequire,
        `${filename} contains a runtime import or require — bridge files must be self-contained (DOM globals only).\n` +
          `If you need a type import for documentation purposes, write it as a JSDoc comment instead.`,
      ).toBe(false);
    });
  }
});

// ── test 2: bridge tsconfig clean ──────────────────────────────────────────

it(
  "bridge tsconfig — tsc -p bridge/tsconfig.json exits clean",
  { timeout: 30_000 },
  () => {
    const tsconfigPath = join(bridgeDir, "tsconfig.json");
    let output = "";
    let failed = false;
    try {
      output = execSync(`pnpm exec tsc --noEmit -p "${tsconfigPath}"`, {
        cwd: designRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err: unknown) {
      failed = true;
      const e = err as { stdout?: string; stderr?: string; message?: string };
      output = (e.stdout ?? "") + (e.stderr ?? "") + (e.message ?? "");
    }

    expect(failed, `bridge tsconfig type-check failed:\n${output}`).toBe(false);
  },
);

// ── test 3: generated output is fresh ──────────────────────────────────────

describe("generated bridge modules", () => {
  const bridgeFiles = getBridgeFiles();

  for (const filename of bridgeFiles) {
    it(`${filename} → .generated/bridge/${filename.replace(".bridge.ts", ".generated.ts")} is up to date`, async () => {
      const outPath = generatedPath(filename);

      // Ensure a generated file exists at all.
      expect(
        existsSync(outPath),
        `Missing generated file for ${filename}. Run: pnpm exec tsx app/components/design/bridge/codegen.ts`,
      ).toBe(true);

      const committed = readFileSync(outPath, "utf-8");

      // Re-run codegen for just this bridge file into a temp path and compare.
      const tempPath = outPath + ".tmp";
      try {
        // Import codegen internals directly rather than spawning a subprocess,
        // so we can compare output cheaply within the test runner.
        const esbuild = await import("esbuild");

        const srcFile = join(bridgeDir, filename);
        const result = await esbuild.build({
          entryPoints: [srcFile],
          bundle: true,
          format: "iife",
          platform: "browser",
          target: "es2020",
          write: false,
          external: [],
        });

        if (result.errors.length > 0) {
          const msgs = await esbuild.formatMessages(result.errors, {
            kind: "error",
          });
          throw new Error(`esbuild error for ${filename}:\n${msgs.join("\n")}`);
        }

        const compiled = result.outputFiles[0]?.text ?? "";

        // Build the expected generated module src using the same logic as codegen.ts.
        const name = filename.replace(/\.bridge\.ts$/, "");
        const camelCaseName = name.replace(
          /[-_]([a-z])/g,
          (_: string, c: string) => c.toUpperCase(),
        );
        const escaped = compiled
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/\$\{/g, "\\${");

        const expected =
          `// AUTO-GENERATED by bridge/codegen.ts — do not edit manually.\n` +
          `// Run: pnpm exec tsx app/components/design/bridge/codegen.ts\n` +
          `\n` +
          `/** Compiled IIFE string for ${name}.bridge.ts — inject into an iframe via srcdoc or a <script> tag. */\n` +
          `export const ${camelCaseName}BridgeScript: string = \`${escaped}\`;\n`;

        writeFileSync(tempPath, expected, "utf-8");

        expect(
          committed,
          `Generated file for ${filename} is stale. Re-run:\n  pnpm exec tsx app/components/design/bridge/codegen.ts`,
        ).toBe(expected);
      } finally {
        if (existsSync(tempPath)) rmSync(tempPath);
      }
    });
  }
});
