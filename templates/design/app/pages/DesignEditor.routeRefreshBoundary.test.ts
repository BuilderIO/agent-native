import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("Design editor route Fast Refresh boundary", () => {
  const routeSource = readFileSync("app/routes/design.$id.tsx", "utf8");

  it("owns a local named route component instead of re-exporting the editor", () => {
    expect(routeSource).toContain("export default function DesignRoute()");
    expect(routeSource).toContain("return <DesignEditorRoute />;");
    expect(routeSource).not.toContain(
      'export { default } from "../pages/DesignEditor"',
    );
    expect(routeSource).toContain("export function meta()");
  });

  it("keeps DesignEditor component-only with no runtime named exports", () => {
    const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");
    const sourceFile = ts.createSourceFile(
      "DesignEditor.tsx",
      editorSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const hasModifier = (statement: ts.Statement, kind: ts.SyntaxKind) =>
      ts.canHaveModifiers(statement) &&
      Boolean(ts.getModifiers(statement)?.some((item) => item.kind === kind));
    const runtimeNamedExports = sourceFile.statements.filter((statement) => {
      if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) return false;
        if (
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.every((item) => item.isTypeOnly)
        ) {
          return false;
        }
        return true;
      }
      if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return false;
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return false;
      if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)
      ) {
        return false;
      }
      return true;
    });
    const defaultComponents = sourceFile.statements.filter(
      (statement) =>
        ts.isFunctionDeclaration(statement) &&
        hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword),
    );

    expect(runtimeNamedExports.map((statement) => statement.getText())).toEqual(
      [],
    );
    expect(defaultComponents).toHaveLength(1);
  });

  it("invalidates cached overview canvases for preview-only state changes", () => {
    const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");
    const sourceFile = ts.createSourceFile(
      "DesignEditor.tsx",
      editorSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let dependencyNames: string[] | null = null;

    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "renderScreenContent" &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const dependencyArray = node.initializer.arguments[1];
        if (dependencyArray && ts.isArrayLiteralExpression(dependencyArray)) {
          dependencyNames = dependencyArray.elements.map((element) =>
            element.getText(sourceFile),
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(dependencyNames).toEqual(
      expect.arrayContaining([
        "motionDefaultEase",
        "motionDurationMs",
        "inScreenGradientEditTarget",
        "handleInScreenGradientEditChange",
        "statePreviewTarget",
      ]),
    );
  });
});
