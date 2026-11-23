import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// oracle-change: removed DesignEditor source and AST greps of hook dependency lists; the Fast Refresh boundary cases remain

describe("Design editor route Fast Refresh boundary", () => {
  const routeSource = readFileSync("app/routes/design.$id.tsx", "utf8");

  it("owns a local named route component instead of re-exporting the editor", () => {
    expect(routeSource).toContain("export default function DesignRoute()");
    expect(routeSource).toContain("return <DesignEditorRoute />;");
    expect(routeSource).not.toContain(
      'export { default } from "../pages/DesignEditor"',
    );
    expect(routeSource).toMatch(/export (?:function meta\(\)|const meta\b)/);
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
});
