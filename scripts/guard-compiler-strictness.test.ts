import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findAddedOptOuts,
  flagCausedDiagnostics,
  parseTscOutput,
} from "./guard-compiler-strictness.js";

const CWD = path.resolve("/repo/templates/mail");

describe("compiler strictness guard", () => {
  it("parses tsc diagnostics relative to the project", () => {
    const output = [
      "app/a.ts(3,7): error TS2532: Object is possibly 'undefined'.",
      "  continuation line",
      "Found 1 error.",
    ].join("\n");
    assert.deepEqual(parseTscOutput(output, CWD), [
      {
        file: path.join(CWD, "app/a.ts"),
        line: 3,
        code: "TS2532",
        message: "Object is possibly 'undefined'.",
      },
    ]);
  });

  it("reports only diagnostics the flags add", () => {
    const missingTypes = {
      file: "/repo/a.ts",
      line: 1,
      code: "TS2307",
      message: "Cannot find module './+types/root'.",
    };
    const indexRead = {
      file: "/repo/a.ts",
      line: 4,
      code: "TS2532",
      message: "Object is possibly 'undefined'.",
    };
    assert.deepEqual(
      flagCausedDiagnostics([missingTypes], [missingTypes, indexRead]),
      [indexRead],
    );
  });

  it("flags an added opt-out, and only an added one", () => {
    const source = [
      "{",
      '  "compilerOptions": {',
      '    "noUncheckedIndexedAccess": false,',
      '    "strict": false,',
      '    "noImplicitOverride": true',
      "  }",
      "}",
    ].join("\n");
    assert.deepEqual(
      findAddedOptOuts("tsconfig.json", source, new Set([4, 5])).map(
        (finding) => finding.line,
      ),
      [4],
    );
  });
});
