import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("DesignCanvas Fast Refresh boundary", () => {
  it("exports only the React component", () => {
    const source = readFileSync(
      "app/components/design/DesignCanvas.tsx",
      "utf8",
    );
    const sourceFile = ts.createSourceFile(
      "DesignCanvas.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const hasModifier = (statement: ts.Statement, kind: ts.SyntaxKind) =>
      ts.canHaveModifiers(statement) &&
      Boolean(ts.getModifiers(statement)?.some((item) => item.kind === kind));
    // Type-only declarations (interfaces, type aliases) are erased entirely
    // during compilation — they produce zero runtime exports, so an
    // `export interface`/`export type` can never affect the Fast Refresh
    // component boundary this test actually guards. Only count statements
    // that still exist at runtime after TypeScript strips types.
    const isTypeOnlyDeclaration = (statement: ts.Statement) =>
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement);
    const exportedStatements = sourceFile.statements.filter(
      (statement) =>
        !isTypeOnlyDeclaration(statement) &&
        (ts.isExportDeclaration(statement) ||
          hasModifier(statement, ts.SyntaxKind.ExportKeyword)),
    );

    expect(exportedStatements).toHaveLength(1);
    expect(ts.isFunctionDeclaration(exportedStatements[0])).toBe(true);
    const component = exportedStatements[0] as ts.FunctionDeclaration;
    expect(component.name?.text).toBe("DesignCanvas");
    expect(hasModifier(component, ts.SyntaxKind.DefaultKeyword)).toBe(false);
  });
});
