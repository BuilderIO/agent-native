import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  previewEligibleSiteNames,
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

test("previewEligibleSiteNames succeeds with only the cleanup job's sparse-checked-out manifests", () => {
  // Mirrors .github/workflows/deploy-netlify-pr-previews.yml's cleanup job
  // sparse-checkout list: only the scripts JSON plus each site's
  // package.json/netlify.toml, nothing else. If the workflow's sparse list
  // ever drifts from what resolveNetlifyPrebuiltTarget requires, this throws
  // instead of the cleanup job silently failing before it deletes anything.
  const repoRoot = mkdtempSync(path.join(tmpdir(), "netlify-preview-"));
  mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "scripts", "netlify-production-sites.json"),
    JSON.stringify({
      analytics: { siteId: "s-analytics", host: "analytics.example.com" },
      assets: { siteId: "s-assets", host: "assets.example.com" },
      calendar: { siteId: "s-calendar", host: "calendar.example.com" },
      clips: { siteId: "s-clips", host: "clips.example.com" },
      content: { siteId: "s-content", host: "content.example.com" },
      design: { siteId: "s-design", host: "design.example.com" },
      dispatch: { siteId: "s-dispatch", host: "dispatch.example.com" },
      forms: { siteId: "s-forms", host: "forms.example.com" },
      mail: { siteId: "s-mail", host: "mail.example.com" },
      plan: { siteId: "s-plan", host: "plan.example.com" },
      slides: { siteId: "s-slides", host: "slides.example.com" },
      starter: { siteId: "s-starter", host: "starter.example.com" },
      fw: { siteId: "s-fw", host: "www.example.com" },
    }),
  );

  // templates/*/package.json + templates/*/netlify.toml, per the sparse list.
  const templateDirs = [
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
    "chat", // starter's site maps to the "chat" template dir
  ];
  for (const dir of templateDirs) {
    const templateDir = path.join(repoRoot, "templates", dir);
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(path.join(templateDir, "package.json"), "{}");
    writeFileSync(path.join(templateDir, "netlify.toml"), "");
  }

  // packages/docs/package.json + packages/docs/netlify.toml, per the sparse list.
  const docsDir = path.join(repoRoot, "packages", "docs");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(path.join(docsDir, "package.json"), "{}");
  writeFileSync(path.join(docsDir, "netlify.toml"), "");

  assert.deepEqual(previewEligibleSiteNames(repoRoot), [
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
