import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { judge, type Check } from "./ci-wait.ts";

const check = (name: string, bucket: string): Check => ({
  name,
  bucket,
  link: `https://example.test/${name}`,
});

describe("judge", () => {
  it("keeps waiting while nothing is reported or anything is pending", () => {
    assert.deepEqual(judge([], "abc"), { done: false });
    assert.deepEqual(
      judge([check("lint", "pass"), check("test", "pending")], "abc"),
      { done: false },
    );
  });

  it("passes when nothing failed, listing cancelled runs", () => {
    const verdict = judge(
      [check("lint", "pass"), check("e2e", "skipping"), check("old", "cancel")],
      "0123456789abcdef",
    );
    assert.equal(verdict.done && verdict.exit, 0);
    assert.match(
      verdict.done ? verdict.summary : "",
      /^head 0123456789ab: 1 passed, 0 failed, 1 cancelled, 1 skipped\nCANCELLED old /,
    );
  });

  it("fails and names each failed check", () => {
    const verdict = judge(
      [check("lint", "pass"), check("test", "fail")],
      "abc",
    );
    assert.equal(verdict.done && verdict.exit, 1);
    assert.match(verdict.done ? verdict.summary : "", /FAILED test https:/);
  });
});
