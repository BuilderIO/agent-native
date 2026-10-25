import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findOutputSchemaProblems,
  isCheckedSourcePath,
} from "./guard-action-output-schema.js";

const FILE = "templates/mail/actions/archive-thread.ts";

function allLines(source: string) {
  return new Set(source.split("\n").map((_, index) => index + 1));
}

function flagged(source: string, added = allLines(source)) {
  return findOutputSchemaProblems(FILE, source, added).map(
    (finding) => `${finding.line}: ${finding.problem}`,
  );
}

describe("action outputSchema guard", () => {
  it("flags a new action without an outputSchema", () => {
    const source = [
      "export default defineAction({",
      '  description: "Archive a thread.",',
      "  schema,",
      "  run: async () => ({ ok: true }),",
      "});",
    ].join("\n");
    assert.deepEqual(flagged(source), ["1: missing-output-schema"]);
  });

  it("accepts an outputSchema or the pragma", () => {
    const source = [
      'import { z } from "zod";',
      "export const a = defineAction({",
      "  schema,",
      "  outputSchema: z.object({ ok: z.boolean() }),",
      "  run: async () => ({ ok: true }),",
      "});",
      "// guard:allow-no-output-schema — raw provider passthrough",
      "export const c = defineAction({ schema, run: async () => raw });",
    ].join("\n");
    assert.deepEqual(flagged(source), []);
  });

  it("fails closed on options it cannot read", () => {
    const source = [
      "export const a = defineAction({ ...shared, run: async () => 1 });",
      "export const b = defineAction(options);",
      "export const c = core.defineAction({ schema, run: async () => 1 });",
      "export const d = defineAction({ outputSchema: undefined, run });",
    ].join("\n");
    assert.deepEqual(flagged(source), [
      "1: missing-output-schema",
      "1: uninspectable-strategy-spread",
      "2: missing-output-schema",
      "3: missing-output-schema",
      "4: missing-output-schema",
    ]);
  });

  it("resolves aliased imports and identifier values", () => {
    const source = [
      'import { defineAction as makeAction } from "@agent-native/core";',
      'import { resultSchema } from "./schemas";',
      "const outputSchema = undefined;",
      "const declared = {};",
      "export const a = makeAction({ schema, run: async () => 1 });",
      "export const b = defineAction({ outputSchema, run });",
      "export const c = defineAction({ outputSchema: resultSchema, run });",
      "export const d = defineAction({ outputSchema: declared, run });",
      "export const e = (s) => defineAction({ outputSchema: s, run });",
    ].join("\n");
    assert.deepEqual(flagged(source), [
      "5: missing-output-schema",
      "6: missing-output-schema",
      "9: missing-output-schema",
    ]);
  });

  it("reads strategies through consts and rejects ones it cannot read", () => {
    const source = [
      'const FALLBACK = "fallback" as const;',
      'const WARN = "warn";',
      "const outputSchema = {};",
      "export default defineAction({",
      "  outputSchema,",
      "  outputErrorStrategy: FALLBACK,",
      "  run,",
      "});",
      "defineAction({ outputSchema, outputErrorStrategy: WARN, run });",
      "defineAction({ outputSchema, outputErrorStrategy: pick(), run });",
    ].join("\n");
    assert.deepEqual(flagged(source, new Set([6, 9, 10])), [
      "6: fallback-strategy",
      "10: non-literal-strategy",
    ]);
  });

  it("ignores an existing action whose body this branch edited", () => {
    const source = [
      "export default defineAction({",
      "  schema,",
      "  run: async () => ({ ok: true, more: 1 }),",
      "});",
    ].join("\n");
    assert.deepEqual(flagged(source, new Set([3])), []);
  });

  it("flags an added fallback strategy, even on an existing action", () => {
    const source = [
      "export default defineAction({",
      "  outputSchema,",
      '  outputErrorStrategy: "fallback",',
      "  run: async () => ({ ok: true }),",
      "});",
    ].join("\n");
    assert.deepEqual(flagged(source, new Set([3])), ["3: fallback-strategy"]);
  });

  it("fails closed on dynamic output schema expressions", () => {
    const source = [
      "const schema = {};",
      "const buildSchema = () => undefined;",
      "defineAction({ outputSchema: enabled ? schema : undefined, run });",
      "defineAction({ outputSchema: buildSchema(), run });",
    ].join("\n");
    assert.deepEqual(flagged(source), [
      "3: missing-output-schema",
      "4: missing-output-schema",
    ]);
  });

  it("recognizes local aliases of defineAction", () => {
    const source = [
      "const makeAction = defineAction;",
      "const makeSecondAction = makeAction;",
      "makeSecondAction({ schema, run });",
    ].join("\n");
    assert.deepEqual(flagged(source), ["3: missing-output-schema"]);
  });

  it("does not treat a shadowed Zod namespace as a schema factory", () => {
    const source = [
      'import { z } from "zod";',
      "function register(z: { object: () => undefined }) {",
      "  defineAction({ outputSchema: z.object(), run });",
      "}",
    ].join("\n");
    assert.deepEqual(flagged(source), ["3: missing-output-schema"]);
  });

  it("flags strategy values hidden by an options spread", () => {
    const source = [
      'const shared = { outputErrorStrategy: "fallback" };',
      "defineAction({ outputSchema: {}, ...shared, run });",
    ].join("\n");
    assert.deepEqual(flagged(source), ["2: uninspectable-strategy-spread"]);
  });

  it("checks a const strategy when its initializer changes", () => {
    const source = [
      'const STRATEGY = "fallback" as const;',
      "const outputSchema = {};",
      "defineAction({ outputSchema, outputErrorStrategy: STRATEGY, run });",
    ].join("\n");
    assert.deepEqual(flagged(source, new Set([1])), ["3: fallback-strategy"]);
  });

  it("scopes to shipped app and package source", () => {
    assert.equal(isCheckedSourcePath(FILE), true);
    assert.equal(isCheckedSourcePath("packages/core/src/a/b.ts"), true);
    assert.equal(
      isCheckedSourcePath("templates/mail/actions/a.spec.ts"),
      false,
    );
    assert.equal(isCheckedSourcePath("scripts/guard-x.ts"), false);
    assert.equal(isCheckedSourcePath("packages/core/dist/a.d.ts"), false);
  });
});
