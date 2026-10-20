import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const specsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "specs",
);

/**
 * A spec that names an app by id asks for that app's stored session. When the
 * run's `apps` selection leaves the app out, global setup creates no session
 * for it, so a spec without a selection check fails with "No stored session"
 * instead of skipping. Textual, not behavioural: it cannot say a check covers
 * every test in the file, only that the file has one at all.
 */
export function ignoresAppSelection(source: string): boolean {
  return (
    /\bsiteById\(\s*["']/.test(source) &&
    !/\b(?:selectedSites|chatSites|authenticatableSites)\(\)/.test(source)
  );
}

function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(full);
    return entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

test("a spec that names an app by id honours the run's app selection", () => {
  const ignoring = specFiles(specsDir)
    .filter((file) => ignoresAppSelection(readFileSync(file, "utf8")))
    .map((file) => path.relative(specsDir, file));
  assert.deepEqual(
    ignoring,
    [],
    `These specs run for an app the run left out and fail on its missing session: ${ignoring.join(", ")}. Guard them with selectedSites() (test.skip when the app is not selected).`,
  );
});

test("the check tells a guarded spec from the one that failed on beta", () => {
  assert.equal(
    ignoresAppSelection(
      'import { originFor, siteById } from "../../lib/fleet";\nconst site = siteById("content");',
    ),
    true,
  );
  assert.equal(
    ignoresAppSelection(
      'import { selectedSites, siteById } from "../../lib/fleet";\nconst selected = new Set(selectedSites().map((s) => s.id));\nconst site = siteById("content");',
    ),
    false,
  );
  assert.equal(
    ignoresAppSelection("for (const site of chatSites()) {}"),
    false,
  );
});
