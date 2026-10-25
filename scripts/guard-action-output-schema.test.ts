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

  it("accepts an outputSchema, a spread, or the pragma", () => {
    const source = [
      "export const a = defineAction({",
      "  schema,",
      "  outputSchema: z.object({ ok: z.boolean() }),",
      "  run: async () => ({ ok: true }),",
      "});",
      "export const b = defineAction({ ...shared, run: async () => 1 });",
      "// guard:allow-no-output-schema — raw provider passthrough",
      "export const c = defineAction({ schema, run: async () => raw });",
    ].join("\n");
    assert.deepEqual(flagged(source), []);
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
