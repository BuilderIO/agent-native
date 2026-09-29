import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { build, createServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { scanDeprecatedImports } from "../package-lifecycle/deprecated-imports.js";
import {
  resolveMigrationSymbolMove,
  type MigrationManifest,
} from "../package-lifecycle/migration-manifest.js";
import {
  AGENTKIT_CHAT_MIGRATION_GUIDE_URL,
  AGENT_NATIVE_MIGRATION_GUIDE_URL,
  AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND,
} from "../package-lifecycle/migration-message.js";
import { migrationDiagnosticPlugin } from "./migration-diagnostic-plugin.js";

const roots: string[] = [];

function createProject(source: string): {
  root: string;
  sourceFile: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migration-vite-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "index.html"),
    '<script type="module" src="/src/main.ts"></script>',
  );
  const sourceFile = path.join(root, "src/main.ts");
  fs.writeFileSync(sourceFile, source);
  return { root, sourceFile };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Agent-Native migration Vite diagnostic", () => {
  it("fails dev startup with the migration for a tombstoned subpath", async () => {
    const { root } = createProject(
      'import { AgentSidebar } from "@agent-native/core/client/AgentSidebar";\nvoid AgentSidebar;\n',
    );

    await expect(
      createServer({
        configFile: false,
        root,
        plugins: [migrationDiagnosticPlugin()],
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, ws: false },
      }),
    ).rejects.toThrow(
      `New home: AgentSidebar → @agent-native/toolkit/app/chat/AgentSidebar`,
    );
  });

  it("fails builds with a symbol-specific destination from a mixed export", async () => {
    const { root } = createProject(
      'import type { AppProvidersProps } from "@agent-native/core/client/hooks";\nvoid (0 as unknown as AppProvidersProps);\n',
    );

    const buildError = await build({
      configFile: false,
      root,
      plugins: [migrationDiagnosticPlugin()],
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(buildError).toBeInstanceOf(Error);
    expect((buildError as Error).message).toContain(
      `AppProvidersProps → @agent-native/toolkit/app/providers`,
    );
    expect((buildError as Error).message).toContain(
      AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND,
    );
    expect((buildError as Error).message).toContain(
      AGENT_NATIVE_MIGRATION_GUIDE_URL,
    );
  });

  it("preserves a removed symbol's guide and includes the current runbook", async () => {
    const { root } = createProject(
      [
        'import { createAgentChatAdapter } from "@agent-native/core/client/agent-chat";',
        'import { AgentNative } from "@agent-native/core/client";',
        "",
      ].join("\n"),
    );

    const buildError = await build({
      configFile: false,
      root,
      plugins: [migrationDiagnosticPlugin()],
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(buildError).toBeInstanceOf(Error);
    expect((buildError as Error).message).toContain(
      AGENTKIT_CHAT_MIGRATION_GUIDE_URL,
    );
    expect((buildError as Error).message).toContain(
      AGENT_NATIVE_MIGRATION_GUIDE_URL,
    );
  });

  it("reports a deprecated import added after dev startup through Vite's error hook", async () => {
    const { root, sourceFile } = createProject("export const value = 1;\n");
    const plugin = migrationDiagnosticPlugin();
    const server = await createServer({
      configFile: false,
      root,
      plugins: [plugin],
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, ws: false },
    });

    try {
      fs.writeFileSync(
        sourceFile,
        'import { AppProvidersProps } from "@agent-native/core/client/hooks";\nvoid AppProvidersProps;\n',
      );
      const hook = plugin.handleHotUpdate;
      expect(typeof hook).toBe("function");
      const errorContext = {
        error: vi.fn((message: string) => {
          throw new Error(message);
        }),
      };

      expect(() =>
        Reflect.apply(hook as (...args: never[]) => unknown, errorContext, [
          { file: sourceFile },
        ]),
      ).toThrow(AGENT_NATIVE_MIGRATION_GUIDE_URL);
      expect(errorContext.error).toHaveBeenCalledWith(
        expect.stringContaining(
          `AppProvidersProps → @agent-native/toolkit/app/providers`,
        ),
      );
    } finally {
      await server.close();
    }
  });

  it("keeps every declared moved and removed symbol visible to the Vite scanner", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-migration-coverage-"),
    );
    roots.push(root);
    const manifest = JSON.parse(
      fs.readFileSync(
        new URL("../../migration-manifest.json", import.meta.url),
        "utf8",
      ),
    ) as MigrationManifest;
    const symbolsBySpecifier = new Map<string, Set<string>>();
    const expected = new Set<string>();

    for (const [specifier, move] of Object.entries(manifest.moves)) {
      for (const symbol of Object.keys(move.symbols ?? {})) {
        const resolved = resolveMigrationSymbolMove(move, symbol);
        if (!resolved || resolved.status === "planned") continue;
        const symbols = symbolsBySpecifier.get(specifier) ?? new Set<string>();
        symbols.add(symbol);
        symbolsBySpecifier.set(specifier, symbols);
        expected.add(`${specifier}\0${symbol}\0${resolved.to}`);
      }
    }

    for (const [specifier, removed] of Object.entries(
      manifest.removedExports ?? {},
    )) {
      const symbols = symbolsBySpecifier.get(specifier) ?? new Set<string>();
      for (const symbol of removed.symbols) {
        symbols.add(symbol);
        expected.add(`${specifier}\0${symbol}\0removed`);
      }
      symbolsBySpecifier.set(specifier, symbols);
    }

    const source = [...symbolsBySpecifier]
      .map(([specifier, symbols], group) => {
        const names = [...symbols]
          .map((symbol, index) => `${symbol} as __migration_${group}_${index}`)
          .join(", ");
        return `import { ${names} } from ${JSON.stringify(specifier)};`;
      })
      .join("\n");
    const sourceFile = path.join(root, "migration-coverage.ts");
    fs.writeFileSync(sourceFile, source);

    const actual = new Set(
      scanDeprecatedImports({
        root,
        files: [sourceFile],
        manifests: [manifest],
      }).flatMap((finding) =>
        finding.symbols.map((symbol) => {
          if (finding.status === "removed") {
            return `${finding.from}\0${symbol}\0removed`;
          }
          const move = manifest.moves[finding.from];
          const resolved = move
            ? resolveMigrationSymbolMove(move, symbol)
            : null;
          return `${finding.from}\0${symbol}\0${resolved?.to ?? ""}`;
        }),
      ),
    );

    expect(actual).toEqual(expected);
  });

  it("keeps every Core tombstone destination in the migration manifest", () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        new URL("../../migration-manifest.json", import.meta.url),
        "utf8",
      ),
    ) as MigrationManifest;
    const tombstoneRoot = fileURLToPath(
      new URL("../client/tombstone/", import.meta.url),
    );
    const sourceFiles = fs
      .readdirSync(tombstoneRoot)
      .filter((file) => file.endsWith(".ts"));
    const mismatches: string[] = [];
    let checkedCalls = 0;

    const stringLiteral = (node: ts.Expression | undefined): string | null =>
      node && ts.isStringLiteralLike(node) ? node.text : null;

    for (const file of sourceFiles) {
      const filePath = path.join(tombstoneRoot, file);
      const source = ts.createSourceFile(
        filePath,
        fs.readFileSync(filePath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "throwMovedAgentNativeModule"
        ) {
          checkedCalls += 1;
          const from = stringLiteral(node.arguments[0]);
          const defaultTarget = stringLiteral(node.arguments[1]);
          const move = from ? manifest.moves[from] : undefined;
          if (!from || !defaultTarget || !move) {
            mismatches.push(`${file}: missing manifest move for tombstone`);
          } else if (move.to !== defaultTarget) {
            mismatches.push(
              `${from}: tombstone default ${defaultTarget}, manifest ${move.to}`,
            );
          }

          const symbolTargets = node.arguments[2];
          if (symbolTargets && ts.isObjectLiteralExpression(symbolTargets)) {
            for (const property of symbolTargets.properties) {
              if (
                !ts.isPropertyAssignment(property) ||
                !property.name ||
                !(
                  ts.isIdentifier(property.name) ||
                  ts.isStringLiteralLike(property.name)
                )
              ) {
                mismatches.push(`${file}: unsupported tombstone symbol map`);
                continue;
              }
              const symbol = property.name.text;
              const target = stringLiteral(property.initializer);
              const resolved = move
                ? resolveMigrationSymbolMove(move, symbol)
                : null;
              if (!target || resolved?.to !== target) {
                mismatches.push(
                  `${from ?? file}#${symbol}: tombstone ${target ?? "<dynamic>"}, manifest ${resolved?.to ?? "<missing>"}`,
                );
              }
            }
          } else if (symbolTargets) {
            mismatches.push(`${file}: unsupported tombstone symbol map`);
          }
        }
        node.forEachChild(visit);
      };
      visit(source);
    }

    expect(checkedCalls).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });
});
