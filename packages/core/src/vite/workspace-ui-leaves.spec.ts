import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  isWorkspaceUiLeaf,
  WORKSPACE_UI_LEAVES,
} from "./workspace-ui-leaves.js";

describe("workspace presentation boundary", () => {
  it("accepts source and compiled leaves but excludes providers, feature wrappers and virtual modules", () => {
    expect(isWorkspaceUiLeaf("/repo/packages/toolkit/src/ui/card.tsx")).toBe(
      true,
    );
    expect(
      isWorkspaceUiLeaf("C:\\repo\\packages\\toolkit\\dist\\ui\\card.js"),
    ).toBe(true);
    for (const name of [
      "button",
      "sidebar",
      "toaster",
      "sonner",
      "chart",
      "index",
    ]) {
      expect(
        isWorkspaceUiLeaf(`/repo/packages/toolkit/src/ui/${name}.tsx`),
      ).toBe(false);
    }
    expect(isWorkspaceUiLeaf("/repo/packages/toolkit/src/app/card.tsx")).toBe(
      false,
    );
    expect(
      isWorkspaceUiLeaf("/repo/packages/toolkit/src/ui/card.tsx?virtual"),
    ).toBe(false);
  });

  it("keeps every real leaf's first-party runtime imports inside the presentation boundary", () => {
    const ui = fileURLToPath(
      new URL("../../../toolkit/src/ui/", import.meta.url),
    );
    const allowed = new Set<string>(WORKSPACE_UI_LEAVES);
    const toolkitPackage = JSON.parse(
      fs.readFileSync(
        new URL("../../../toolkit/package.json", import.meta.url),
        "utf8",
      ),
    );
    const declaredPackages = new Set(
      Object.keys({
        ...toolkitPackage.dependencies,
        ...toolkitPackage.peerDependencies,
      }),
    );
    const violations: string[] = [];
    // The shared utility is part of the same dependency boundary, not an escape.
    for (const name of [...WORKSPACE_UI_LEAVES, "../utils"]) {
      const file = ["tsx", "ts"]
        .map((ext) => path.join(ui, `${name}.${ext}`))
        .find((candidate) => fs.existsSync(candidate));
      expect(file, `Missing presentation leaf ${name}`).toBeDefined();
      // source-read-ok: parse runtime imports to enforce a closed presentation dependency graph.
      const source = ts.createSourceFile(
        file!,
        fs.readFileSync(file!, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const imports: string[] = [];
      function visit(node: ts.Node): void {
        if (
          ts.isImportDeclaration(node) &&
          !node.importClause?.isTypeOnly &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const clause = node.importClause;
          const bindings = clause?.namedBindings;
          const typeOnlyNamed =
            !clause?.name &&
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.every((element) => element.isTypeOnly);
          if (!typeOnlyNamed) imports.push(node.moduleSpecifier.text);
        }
        if (
          ts.isExportDeclaration(node) &&
          !node.isTypeOnly &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          imports.push(node.moduleSpecifier.text);
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require"))
        ) {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg)) imports.push(arg.text);
          else violations.push(`${name}: nonliteral runtime dependency`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      for (const dependency of imports) {
        if (
          dependency.startsWith("@agent-native/") ||
          dependency.startsWith("@/")
        ) {
          violations.push(`${name}: ${dependency}`);
        } else if (dependency.startsWith(".")) {
          const leaf = /^\.\/([^/]+)\.[cm]?[jt]sx?$/.exec(dependency)?.[1];
          if (
            name === "../utils" ||
            (dependency !== "../utils.js" && !(leaf && allowed.has(leaf)))
          )
            violations.push(`${name}: ${dependency}`);
        } else {
          const packageName = dependency.startsWith("@")
            ? dependency.split("/").slice(0, 2).join("/")
            : dependency.split("/")[0]!;
          if (
            !declaredPackages.has(packageName) ||
            packageName === "next-themes"
          )
            violations.push(`${name}: ${dependency}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
