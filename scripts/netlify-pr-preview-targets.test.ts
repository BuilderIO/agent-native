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

test("expands shared runtime changes to every buildable site", () => {
  const sites = previewSitesForChangedPaths(["packages/core/src/index.ts"]);

  assert.ok(sites.includes("slides"));
  assert.ok(sites.includes("design"));
  assert.ok(!sites.includes("workspace"));
});

test("maps docs changes to the docs site and skips prose-only changes", () => {
  assert.deepEqual(
    previewSitesForChangedPaths(["packages/docs/content/guide.md"]),
    ["fw"],
  );
  assert.deepEqual(previewSitesForChangedPaths(["docs/netlify.md"]), []);
});
