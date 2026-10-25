import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { filterStrictDiagnostics, oxlintArgs } from "./guard-strict-lint.ts";

const cwd = "/repo";
const file = "templates/mail/app/x.ts";
const diag = (code: string | undefined, line: number, filename = file) => ({
  message: `msg ${code}`,
  ...(code ? { code } : {}),
  filename,
  labels: [{ span: { line } }],
});
const out = (...diagnostics: object[]) => JSON.stringify({ diagnostics });
const added = new Map([[path.resolve(cwd, file), new Set([3, 4])]]);

test("reports a strict rule on an added line", () => {
  const r = filterStrictDiagnostics(
    out(diag("typescript(no-floating-promises)", 3)),
    added,
    cwd,
  );
  assert.deepEqual(r, {
    ok: true,
    findings: [
      {
        file,
        line: 3,
        rule: "typescript/no-floating-promises",
        message: "msg typescript(no-floating-promises)",
      },
    ],
  });
});

test("ignores a strict rule on an unchanged line or unchanged file", () => {
  const r = filterStrictDiagnostics(
    out(
      diag("typescript(no-explicit-any)", 10),
      diag("typescript(no-explicit-any)", 3, "other.ts"),
    ),
    added,
    cwd,
  );
  assert.deepEqual(r, { ok: true, findings: [] });
});

test("ignores rules outside the strict set even on added lines", () => {
  const r = filterStrictDiagnostics(
    out(
      diag("eslint(no-unused-vars)", 3),
      diag("typescript(no-base-to-string)", 4),
    ),
    added,
    cwd,
  );
  assert.deepEqual(r, { ok: true, findings: [] });
});

test("malformed JSON is could-not-run, not a pass", () => {
  const r = filterStrictDiagnostics("Failed to parse config", added, cwd);
  assert.equal(r.ok, false);
  assert.equal(filterStrictDiagnostics("{}", added, cwd).ok, false);
});

test("a rule-less diagnostic (syntax error) is could-not-run", () => {
  const r = filterStrictDiagnostics(out(diag(undefined, 3)), added, cwd);
  assert.equal(r.ok, false);
});

test("oxlint args deny all seven rules through the repo config", () => {
  const args = oxlintArgs(["a.ts"]);
  assert.equal(args.filter((a) => a === "-D").length, 7);
  assert.ok(args.includes("--type-aware") && args.includes(".oxlintrc.json"));
  assert.equal(args.at(-1), "a.ts");
});
