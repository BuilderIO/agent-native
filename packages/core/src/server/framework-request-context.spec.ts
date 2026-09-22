import { readFileSync } from "node:fs";

import type { H3Event } from "h3";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  getPublicFrameworkPathname,
  PUBLIC_PATHNAME_CONTEXT_KEY,
} from "./framework-request-context.js";
import { getPublicFrameworkPathname as getPublicFrameworkPathnameFromHandler } from "./framework-request-handler.js";

function eventWithContext(context: Record<string, unknown>): H3Event {
  return { context } as H3Event;
}

describe("framework request context", () => {
  it("reads only string public pathnames", () => {
    expect(
      getPublicFrameworkPathname(
        eventWithContext({
          [PUBLIC_PATHNAME_CONTEXT_KEY]: "/mail/_platform/auth/callback",
        }),
      ),
    ).toBe("/mail/_platform/auth/callback");
    expect(getPublicFrameworkPathname(eventWithContext({}))).toBeUndefined();
    expect(
      getPublicFrameworkPathname(
        eventWithContext({ [PUBLIC_PATHNAME_CONTEXT_KEY]: 42 }),
      ),
    ).toBeUndefined();
  });

  it("keeps the request handler export compatible", () => {
    expect(getPublicFrameworkPathnameFromHandler).toBe(
      getPublicFrameworkPathname,
    );
  });

  it("keeps auth callers on the leaf module", () => {
    for (const file of ["auth.ts", "google-oauth.ts"]) {
      const source = readFileSync(
        new URL(`./${file}`, import.meta.url),
        "utf8",
      );
      expect(source).toContain(
        'getPublicFrameworkPathname } from "./framework-request-context.js"',
      );
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const handlerImports = sourceFile.statements.filter(
        (statement): statement is ts.ImportDeclaration =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "./framework-request-handler.js",
      );
      expect(
        handlerImports.every((statement) => statement.importClause?.isTypeOnly),
      ).toBe(true);
      expect(source).not.toContain('import("./framework-request-handler.js")');
    }
  });
});
