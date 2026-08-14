import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyChangedPaths,
  isDocsPath,
  normalizeChangedPath,
} from "./ci-change-scope.ts";

test("recognizes the docs surfaces", () => {
  assert.equal(isDocsPath("packages/core/docs/content/actions.mdx"), true);
  assert.equal(isDocsPath("packages/docs/app/routes/docs.$slug.tsx"), true);
  assert.equal(isDocsPath("docs/environment-variables.md"), true);
  assert.equal(isDocsPath("README.md"), true);
  assert.equal(isDocsPath(".changeset/docs-refresh.md"), true);
  assert.equal(isDocsPath("scripts/i18n-raw-literal-baseline.txt"), true);
});

test("does not treat implementation and instruction paths as docs-only", () => {
  assert.equal(isDocsPath("packages/core/src/index.ts"), false);
  assert.equal(isDocsPath("templates/chat/AGENTS.md"), false);
  assert.equal(isDocsPath(".agents/skills/qa/SKILL.md"), false);
  assert.equal(isDocsPath(".github/workflows/ci.yml"), false);
  assert.equal(isDocsPath("scripts/ci-test-lanes.ts"), false);
});

test("normalizes paths from git output", () => {
  assert.equal(
    normalizeChangedPath("./packages/docs/app/routes/docs.tsx"),
    "packages/docs/app/routes/docs.tsx",
  );
  assert.equal(
    normalizeChangedPath("packages\\docs\\README.md"),
    "packages/docs/README.md",
  );
});

test("fails closed for empty and mixed change sets", () => {
  assert.equal(classifyChangedPaths([]).docsOnly, false);
  assert.equal(
    classifyChangedPaths([
      "packages/core/docs/content/actions.mdx",
      "packages/core/src/index.ts",
    ]).docsOnly,
    false,
  );
});

test("classifies an all-docs change set", () => {
  assert.deepEqual(
    classifyChangedPaths([
      "packages/core/docs/content/actions.mdx",
      "packages/docs/app/components/MarkdownRenderer.tsx",
      "README.md",
    ]),
    {
      changedPaths: [
        "packages/core/docs/content/actions.mdx",
        "packages/docs/app/components/MarkdownRenderer.tsx",
        "README.md",
      ],
      docsOnly: true,
      nonDocsPaths: [],
    },
  );
});
