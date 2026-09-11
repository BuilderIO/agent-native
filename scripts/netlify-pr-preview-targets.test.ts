import assert from "node:assert/strict";
import test from "node:test";

import { previewSitesForChangedPaths } from "./netlify-pr-preview-targets.ts";

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

test("expands root build files to every docs app site", () => {
  assert.deepEqual(previewSitesForChangedPaths(["package.json"]), [
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
