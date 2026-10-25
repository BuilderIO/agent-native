import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findExtendsWeakening,
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

  it("catches a strict sub-flag switched off under strict", () => {
    assert.deepEqual(
      findWeakenedOptions(
        "tsconfig.json",
        '{ "compilerOptions": { "strict": true } }',
        '{ "compilerOptions": { "strict": true, "strictNullChecks": false } }',
      ),
      ["strictNullChecks: null -> false"],
    );
  });

  it("judges a changed extends by the effective config", () => {
    const base =
      '{ "extends": "./strict.json", "compilerOptions": { "noUncheckedIndexedAccess": false } }';
    const head =
      '{ "extends": "./loose.json", "compilerOptions": { "noUncheckedIndexedAccess": false } }';
    const allOn = {
      strict: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      noUncheckedIndexedAccess: false,
    };
    assert.deepEqual(
      findExtendsWeakening("tsconfig.json", base, head, () => allOn),
      [],
    );
    assert.deepEqual(
      findExtendsWeakening("tsconfig.json", base, head, () => ({
        ...allOn,
        strictNullChecks: false,
      })),
      ['extends "./loose.json" leaves strictNullChecks off'],
    );
    assert.deepEqual(
      findExtendsWeakening("tsconfig.json", base, base, () => {
        throw new Error("an unchanged extends needs no effective config");
      }),
      [],
    );
  });
});
