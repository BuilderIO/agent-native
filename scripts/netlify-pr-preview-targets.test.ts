import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  previewSitesForChangedPaths,
  workspacePackages,
} from "./netlify-pr-preview-targets.ts";

test("workspacePackages throws when a checkout has neither packages/ nor templates/", () => {
  const emptyRepoRoot = mkdtempSync(path.join(tmpdir(), "netlify-preview-"));
  assert.throws(
    () => workspacePackages(emptyRepoRoot),
    /neither packages\/ nor templates\/ exists/,
  );
});

test("selects the app sites touched by a PR", () => {
  assert.deepEqual(
    previewSitesForChangedPaths([
      "templates/slides/src/routes.ts",
      "templates/design/README.md",
      "templates/chat/app.tsx",
    ]),
    ["design", "slides", "starter"],
  );
});

test("expands shared runtime changes to every docs app site", () => {
  const sites = previewSitesForChangedPaths(["packages/core/src/index.ts"]);

  assert.deepEqual(sites, [
    "analytics",
    "assets",
    "calendar",
    "clips",
    "content",
    "design",
    "dispatch",
    "forms",
    "mail",
    "plan",
    "slides",
    "starter",
    "fw",
  ]);
});

test("normalizes shared paths before selecting the preview matrix", () => {
  assert.deepEqual(
    previewSitesForChangedPaths(["scripts\\netlify-pr-preview-targets.ts"]),
    [
      "analytics",
      "assets",
      "calendar",
      "clips",
      "content",
      "design",
      "dispatch",
      "forms",
      "mail",
      "plan",
      "slides",
      "starter",
      "fw",
    ],
  );
});

test("previews the docs site for app changes but skips prose and hidden templates", () => {
  assert.deepEqual(
    previewSitesForChangedPaths(["packages/docs/app/routes/apps.tsx"]),
    ["fw"],
  );
  assert.deepEqual(
    previewSitesForChangedPaths(["packages/core/docs/content/guide.md"]),
    ["fw"],
  );
  assert.deepEqual(
    previewSitesForChangedPaths(["packages/docs/changelog/release.md"]),
    [],
  );
  assert.deepEqual(
    previewSitesForChangedPaths(["templates/brain/app.tsx"]),
    [],
  );
  assert.deepEqual(
    previewSitesForChangedPaths(["templates/macros/app.tsx"]),
    [],
  );
  assert.deepEqual(previewSitesForChangedPaths(["templates/crm/app.tsx"]), []);
  assert.deepEqual(
    previewSitesForChangedPaths(["templates/factory/app.tsx"]),
    [],
  );
  assert.deepEqual(previewSitesForChangedPaths(["docs/netlify.md"]), []);
});

test("ignores scripts and workflow files that aren't part of the preview build/deploy path", () => {
  assert.deepEqual(
    previewSitesForChangedPaths(["scripts/agent-friction-report.mjs"]),
    [],
  );
  assert.deepEqual(
    previewSitesForChangedPaths([".github/workflows/desktop-canary.yml"]),
    [],
  );
  assert.deepEqual(previewSitesForChangedPaths(["e2e/mail.spec.ts"]), []);
});

test("expands a workflow file the preview pipeline actually runs to every site", () => {
  assert.deepEqual(
    previewSitesForChangedPaths([
      ".github/workflows/deploy-netlify-pr-previews.yml",
    ]),
    [
      "analytics",
      "assets",
      "calendar",
      "clips",
      "content",
      "design",
      "dispatch",
      "forms",
      "mail",
      "plan",
      "slides",
      "starter",
      "fw",
    ],
  );
});

test("expands a root lockfile change to every site", () => {
  assert.deepEqual(previewSitesForChangedPaths(["pnpm-lock.yaml"]), [
    "analytics",
    "assets",
    "calendar",
    "clips",
    "content",
    "design",
    "dispatch",
    "forms",
    "mail",
    "plan",
    "slides",
    "starter",
    "fw",
  ]);
});

test("limits a dependency-scoped package change to sites that depend on it", () => {
  assert.deepEqual(
    previewSitesForChangedPaths(["packages/dispatch/src/x.ts"]),
    ["dispatch"],
  );
});

test("keeps hidden templates out of the shared preview fanout", () => {
  assert.deepEqual(
    previewSitesForChangedPaths([
      "packages/core/src/index.ts",
      "templates/crm/app.tsx",
      "templates/macros/app.tsx",
    ]),
    [
      "analytics",
      "assets",
      "calendar",
      "clips",
      "content",
      "design",
      "dispatch",
      "forms",
      "mail",
      "plan",
      "slides",
      "starter",
      "fw",
    ],
  );
});
