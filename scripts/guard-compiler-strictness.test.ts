import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findWeakenedOptions,
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

  it("flags every way a tsconfig change weakens a ratcheted option", () => {
    const base = `{
      // comments are allowed
      "compilerOptions": {
        "strict": true,
        "noImplicitOverride": true,
        "noUncheckedIndexedAccess": false
      }
    }`;
    const head = `{
      "compilerOptions": {
        "noImplicitOverride":
          false,
        "exactOptionalPropertyTypes": false
      }
    }`;
    assert.deepEqual(findWeakenedOptions("tsconfig.json", base, head), [
      "exactOptionalPropertyTypes: null -> false",
      "noImplicitOverride: true -> false",
      "strict: true -> null",
    ]);
  });

  it("allows removing an opt-out or turning a flag on", () => {
    const base = '{ "compilerOptions": { "noUncheckedIndexedAccess": false } }';
    const head = '{ "compilerOptions": { "noImplicitOverride": true } }';
    assert.deepEqual(findWeakenedOptions("tsconfig.json", base, head), []);
  });

  it("treats an explicit false in a new tsconfig as an opt-out", () => {
    assert.deepEqual(
      findWeakenedOptions(
        "tsconfig.json",
        null,
        '{ "compilerOptions": { "strict": false } }',
      ),
      ["strict: null -> false"],
    );
  });
});
