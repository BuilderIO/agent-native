#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function file(rel: string): string {
  return path.join(repoRoot, rel);
}

function read(rel: string): string {
  return fs.readFileSync(file(rel), "utf8");
}

function exists(rel: string): boolean {
  return fs.existsSync(file(rel));
}

function assertFilesExist(template: string, files: string[]) {
  for (const name of files) {
    assert.ok(
      exists(`templates/${template}/app/routes/${name}`),
      `${template} route file is missing: ${name}`,
    );
  }
}

function assertContains(rel: string, needle: string, message: string) {
  assert.ok(read(rel).includes(needle), message);
}

function assertMatches(rel: string, pattern: RegExp, message: string) {
  assert.match(read(rel), pattern, message);
}

function publicPaths(pluginRel: string): string[] {
  const src = read(pluginRel);
  const match = src.match(/publicPaths:\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function assertPublicPaths(pluginRel: string, expected: string[]) {
  const actual = publicPaths(pluginRel);
  for (const path of expected) {
    assert.ok(
      actual.includes(path),
      `${pluginRel} must keep ${path} public for anonymous share/media routes`,
    );
  }
}

assertFilesExist("videos", [
  "_index.tsx",
  "c.$compositionId.tsx",
  "components.tsx",
  "design-systems.tsx",
  "extensions.tsx",
  "extensions._index.tsx",
  "extensions.$id.tsx",
  "extensions.$id.$slug.tsx",
  "team.tsx",
  "$.tsx",
]);

assertFilesExist("slides", [
  "_index.tsx",
  "deck.$id.tsx",
  "deck.$id_.present.tsx",
  "design-systems.tsx",
  "extensions.tsx",
  "extensions._index.tsx",
  "extensions.$id.tsx",
  "extensions.$id.$slug.tsx",
  "share.$token.tsx",
  "slide.tsx",
  "team.tsx",
]);

assertFilesExist("clips", [
  "_index.tsx",
  "_app.tsx",
  "_app.library._index.tsx",
  "_app.library.folder.$folderId.tsx",
  "_app.spaces.$spaceId.tsx",
  "_app.spaces.$spaceId.folder.$folderId.tsx",
  "_app.extensions.tsx",
  "_app.extensions._index.tsx",
  "_app.extensions.$id.tsx",
  "_app.extensions.$id.$slug.tsx",
  "download.tsx",
  "embed.$shareId.tsx",
  "invite.$token.tsx",
  "r.$recordingId.tsx",
  "record.tsx",
  "share.$shareId.tsx",
]);

assertFilesExist("design", [
  "_index.tsx",
  "design.$id.tsx",
  "design-systems.tsx",
  "design-systems_.setup.tsx",
  "examples.tsx",
  "extensions.tsx",
  "extensions._index.tsx",
  "extensions.$id.tsx",
  "extensions.$id.$slug.tsx",
  "observability.tsx",
  "present.$id.tsx",
]);

assertMatches(
  "templates/clips/app/routes/_index.tsx",
  /export function loader[\s\S]*redirect\(buildTarget\((?:request|url)\)\)/,
  "clips / must keep a server loader redirect to /library",
);
assertMatches(
  "templates/clips/app/routes/_index.tsx",
  /export function clientLoader[\s\S]*redirect\(buildTarget\((?:request|url)\)\)/,
  "clips / must keep a client loader redirect for SPA navigations",
);
assertMatches(
  "templates/slides/app/routes/share.$token.tsx",
  /export async function loader[\s\S]*\/api\/share\/\$\{params\.token\}/,
  "slides share route must SSR-load the shared deck JSON",
);

assertPublicPaths("templates/slides/server/plugins/auth.ts", [
  "/share",
  "/api/share",
  "/__manifest",
]);
assertPublicPaths("templates/clips/server/plugins/auth.ts", [
  "/share",
  "/embed",
  "/download",
  "/__manifest",
  "/api/public-recording",
  "/api/media",
  "/api/video",
]);
const videosPackage = JSON.parse(read("templates/videos/package.json")) as {
  scripts?: Record<string, string>;
};
assert.equal(
  videosPackage.scripts?.typecheck,
  "agent-native typecheck",
  "videos is now cleaned up and must run the real typecheck (not the skip placeholder)",
);

console.log("qa-template-route-matrix: clean");
