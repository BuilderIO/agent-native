import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcile } from "./baseline.ts";
import type { Violation } from "./checks.ts";

function fail(rule: string, template: string): Violation {
  return { rule, template, severity: "fail", message: `${rule}:${template}` };
}

function warn(rule: string, template: string): Violation {
  return { rule, template, severity: "warn", message: `${rule}:${template}` };
}

describe("reconcile", () => {
  it("fails only on violations the baseline does not already list", () => {
    const result = reconcile(
      [fail("gitignore-source", "mail"), fail("gitignore-source", "chat")],
      [{ rule: "gitignore-source", template: "mail", note: "known gap" }],
    );
    assert.equal(result.newFailures.length, 1);
    assert.equal(result.newFailures[0]?.template, "chat");
    assert.equal(result.baselinedFailures.length, 1);
    assert.equal(result.baselinedFailures[0]?.template, "mail");
  });

  it("never fails on warn-severity violations, baselined or not", () => {
    const result = reconcile([warn("dep-version-band:zod", "brain")], []);
    assert.equal(result.newFailures.length, 0);
    assert.equal(result.warnings.length, 1);
  });

  it("surfaces baseline entries whose violation no longer reproduces", () => {
    const result = reconcile(
      [],
      [{ rule: "claude-md-symlink", template: "calendar", note: "fixed now" }],
    );
    assert.equal(result.staleBaselineEntries.length, 1);
    assert.equal(result.newFailures.length, 0);
  });
});
