import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isTestOnlyPath,
  runTestTitleGuard,
} from "./guard-test-title-production.ts";

const pullRequestEventFixture = {
  action: "opened",
  pull_request: {
    title: "test: guard test PR production changes",
    base: {
      ref: "main",
      sha: "1111111111111111111111111111111111111111",
    },
    head: {
      ref: "test/guard-production-changes",
      sha: "2222222222222222222222222222222222222222",
    },
  },
};

const changedPathsFixture = (...paths: string[]) => `${paths.join("\0")}\0`;

describe("test-title production guard", () => {
  it("allows explicitly test-scoped sources, fixtures, workflows, and configs", () => {
    const changedPaths = [
      "templates/design/app/components/Canvas.spec.tsx",
      "templates/design/app/components/Canvas.test.tsx",
      "templates/design/e2e/overlap-drag.spec.ts",
      "templates/design/app/__fixtures__/canvas.json",
      ".github/workflows/design-e2e.yml",
      ".github/actions/design-e2e/action.yml",
      "templates/design/e2e/README.md",
      "scripts/test-title-production-harness.ts",
      "templates/design/playwright.config.ts",
    ];
    const result = runTestTitleGuard(
      "pull_request",
      pullRequestEventFixture,
      (baseSha, headSha) => {
        assert.equal(baseSha, pullRequestEventFixture.pull_request.base.sha);
        assert.equal(headSha, pullRequestEventFixture.pull_request.head.sha);
        return changedPathsFixture(...changedPaths);
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.message, /passed; checked 9 changed path/);
    assert.equal(isTestOnlyPath("templates/design/app/Canvas.test.tsx"), true);
    assert.equal(isTestOnlyPath("templates/design/app/Canvas.tsx"), false);
  });

  it("rejects a Design production file on a test: PR", () => {
    const result = runTestTitleGuard(
      "pull_request",
      pullRequestEventFixture,
      () => changedPathsFixture("templates/design/app/Editor.tsx"),
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.message, /production-code paths changed/);
    assert.match(result.message, /templates\/design\/app\/Editor\.tsx/);
  });

  it("protects the guard and CI selection paths from test-title PRs", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      ".github/workflows/deploy-production-sites-prebuilt.yml",
      ".github/actions/setup-pnpm/action.yml",
      "scripts/ci-change-scope.ts",
      "scripts/ci-change-scope.test.ts",
      "scripts/ci-test-lanes.ts",
      "scripts/guard-design-e2e-workflow.ts",
      "scripts/guard-test-title-production.ts",
      "scripts/run-guards.ts",
      "AGENTS.md",
      "templates/design/README.md",
      "templates/design/app/tests/Canvas.tsx",
      "templates/design/e2e/helper.ts",
      "docs/design-parity.md",
    ]) {
      assert.equal(isTestOnlyPath(path), false, path);
    }

    const result = runTestTitleGuard(
      "pull_request",
      pullRequestEventFixture,
      () =>
        changedPathsFixture(
          "scripts/guard-test-title-production.ts",
          "scripts/guard-design-e2e-workflow.ts",
          "scripts/ci-test-lanes.ts",
          ".github/workflows/production.yml",
          "templates/design/e2e/helper.ts",
          "templates/design/e2e/canvas-invariants.spec.ts",
        ),
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.message, /scripts\/guard-test-title-production\.ts/);
    assert.match(result.message, /scripts\/guard-design-e2e-workflow\.ts/);
    assert.match(result.message, /scripts\/ci-test-lanes\.ts/);
    assert.match(result.message, /\.github\/workflows\/production\.yml/);
    assert.match(result.message, /templates\/design\/e2e\/helper\.ts/);
  });

  it("explicitly skips titles that do not start with test:", () => {
    let diffWasRead = false;
    const result = runTestTitleGuard(
      "pull_request",
      {
        ...pullRequestEventFixture,
        pull_request: {
          ...pullRequestEventFixture.pull_request,
          title: "fix: a normal production change",
        },
      },
      () => {
        diffWasRead = true;
        throw new Error("a skipped title should not read the diff");
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.message, /SKIPPED/);
    assert.equal(diffWasRead, false);
  });

  it("skips cleanly outside pull request events", () => {
    const result = runTestTitleGuard(undefined, undefined, () => {
      throw new Error("local invocation must not request PR diff context");
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.message, /SKIPPED; only pull_request events/);
  });

  it("returns exit 2 when required PR context is unavailable", () => {
    const result = runTestTitleGuard(
      "pull_request",
      { pull_request: { title: "test: missing base and head" } },
      () => {
        throw new Error("diff must not be read without PR context");
      },
    );

    assert.equal(result.exitCode, 2);
    assert.match(
      result.message,
      /missing a title, base\/head ref, or full commit SHA/,
    );
  });

  it("returns exit 2 and reports a loud error when the PR diff is unavailable", () => {
    const result = runTestTitleGuard(
      "pull_request",
      pullRequestEventFixture,
      () => {
        throw new Error("fatal: bad object");
      },
    );

    assert.equal(result.exitCode, 2);
    assert.match(result.message, /::error::/);
    assert.match(
      result.message,
      /could not read the PR diff: fatal: bad object/,
    );
  });
});
