import { describe, expect, it } from "vitest";

import {
  codeFilesWithoutTest,
  isExemptFromRegressionTest,
  isTestFile,
} from "./regression-test-policy.js";

describe("isTestFile", () => {
  it.each([
    "templates/forms/app/components/FormList.spec.tsx",
    "templates/forms/app/components/FormList.test.tsx",
    "server/lib/sorting.spec.ts",
    "server/lib/sorting.test.ts",
    "scripts/check.spec.js",
    "scripts/check.test.mjs",
    "packages/core/src/__tests__/helpers.ts",
    "templates/design/e2e/editor.ts",
    "e2e/beta/lib/session.ts",
    "packages/docs/tests/links.ts",
    "templates/mail/test/send.js",
    "SERVER/LIB/SORTING.SPEC.TS",
  ])("takes %s for a test", (file) => {
    expect(isTestFile(file)).toBe(true);
  });

  it.each([
    "server/lib/sorting.ts",
    "server/lib/spec.ts",
    "server/lib/testing.ts",
    "server/lib/contest.ts",
    "templates/forms/app/latest/page.tsx",
    "templates/design/e2e/README.md",
    "templates/design/e2e/shot.png",
    "templates/forms/fixtures/forms.json",
    "server/lib/sorting.spec.ts.bak",
    "server/lib/sorting.spec.json",
  ])("does not take %s for a test", (file) => {
    expect(isTestFile(file)).toBe(false);
  });
});

describe("isExemptFromRegressionTest", () => {
  it.each([
    "README.md",
    "docs/content/guide.mdx",
    "templates/factory/AGENTS.md",
    ".agents/skills/factory-workflows/SKILL.md",
    ".changeset/small-fix.md",
    ".changeset/config.json",
    "pnpm-lock.yaml",
    "templates/forms/package-lock.json",
    "yarn.lock",
    "package.json",
    "templates/forms/package.json",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "templates/forms/tsconfig.build.json",
    "vite.config.ts",
    "templates/forms/tailwind.config.js",
    "netlify.toml",
    "docker-compose.yml",
    ".gitignore",
    ".npmrc",
    ".github/workflows/ci.yml",
    "CHANGELOG.MD",
  ])("exempts %s: no test goes with it", (file) => {
    expect(isExemptFromRegressionTest(file)).toBe(true);
  });

  it.each([
    "templates/forms/app/components/FormList.tsx",
    "templates/factory/actions/get-factory-pull-request.ts",
    "server/db/migrations/0031_add_column.sql",
    "templates/forms/app/styles.css",
    "templates/factory/server/workflow/stories/02-builder-to-merge/workflow.json",
    "templates/forms/app/config.ts",
    "templates/forms/src/package.json.ts",
    "templates/forms/.hidden/run.ts",
  ])("does not exempt %s", (file) => {
    expect(isExemptFromRegressionTest(file)).toBe(false);
  });
});

describe("codeFilesWithoutTest", () => {
  it("names the code files when no changed file is a test", () => {
    expect(
      codeFilesWithoutTest([
        "templates/forms/app/FormList.tsx",
        "templates/forms/app/sort.ts",
        "templates/forms/README.md",
      ]),
    ).toEqual([
      "templates/forms/app/FormList.tsx",
      "templates/forms/app/sort.ts",
    ]);
  });

  it("names nothing once any changed file is a test", () => {
    expect(
      codeFilesWithoutTest([
        "templates/forms/app/FormList.tsx",
        "templates/forms/app/FormList.spec.tsx",
      ]),
    ).toEqual([]);
    expect(
      codeFilesWithoutTest([
        "templates/forms/app/FormList.tsx",
        "templates/design/e2e/form-list.ts",
      ]),
    ).toEqual([]);
  });

  it("names nothing for a change that is only a test, only docs, or only a dependency or config change", () => {
    expect(codeFilesWithoutTest(["server/lib/sorting.spec.ts"])).toEqual([]);
    expect(
      codeFilesWithoutTest(["docs/guide.md", ".changeset/docs-fix.md"]),
    ).toEqual([]);
    expect(
      codeFilesWithoutTest([
        "package.json",
        "pnpm-lock.yaml",
        "templates/forms/package.json",
      ]),
    ).toEqual([]);
    expect(
      codeFilesWithoutTest(["tsconfig.json", "vite.config.ts", ".npmrc"]),
    ).toEqual([]);
  });

  it("does not let one exempt file excuse a code file beside it", () => {
    expect(
      codeFilesWithoutTest([
        "package.json",
        "pnpm-lock.yaml",
        "templates/forms/app/FormList.tsx",
      ]),
    ).toEqual(["templates/forms/app/FormList.tsx"]);
  });

  it("names nothing for an empty list, which the gate reports as unreadable on its own", () => {
    expect(codeFilesWithoutTest([])).toEqual([]);
  });
});
