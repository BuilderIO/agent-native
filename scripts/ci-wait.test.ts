import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { judge, parseArgs, type Check } from "./ci-wait.ts";

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

  it("passes only when nothing failed or was cancelled", () => {
    const verdict = judge(
      [check("lint", "pass"), check("e2e", "skipping"), check("old", "cancel")],
      "0123456789abcdef",
    );
    assert.equal(verdict.done && verdict.exit, 2);
    const clean = judge(
      [check("lint", "pass"), check("e2e", "skipping")],
      "abc",
    );
    assert.equal(clean.done && clean.exit, 0);
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

describe("parseArgs", () => {
  it("finds the PR wherever the options are", () => {
    assert.deepEqual(parseArgs(["--interval", "60", "8456"]), {
      pr: "8456",
      intervalMs: 60_000,
      maxMs: 540_000,
    });
    assert.equal(parseArgs(["8456", "--max-minutes", "5"])?.maxMs, 300_000);
  });

  it("rejects missing, invalid, or extra values", () => {
    for (const argv of [
      [],
      ["8456", "--interval"],
      ["8456", "--interval", "0"],
      ["8456", "--max-minutes", "soon"],
      ["8456", "8457"],
      ["main"],
    ])
      assert.equal(parseArgs(argv), null, argv.join(" "));
  });
});
