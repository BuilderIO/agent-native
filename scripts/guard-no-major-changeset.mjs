#!/usr/bin/env node
/**
 * guard-no-major-changeset - refuse unattended major bumps.
 *
 * On 2026-08-28 `.changeset/remove-chat-settings-mode.md` declared
 * `"@agent-native/core": major`. Changesets reads `major` on a 0.x package as
 * 0.176.1 -> 1.0.0, the version PR was force-merged by
 * `auto-merge-version-packages.yml`, and `auto-publish.yml` pushed 1.0.0 plus
 * 55 nightlies to npm. No human saw a version number at any point. These
 * packages are pre-1.0 on purpose.
 *
 * Changesets itself has no setting for this - major bumps are legal - so the
 * refusal lives here, where every PR runs it. Minor bumps remain valid for
 * intentional breaking changes to 0.x packages.
 *
 * The escape hatch is deliberately not a pragma in the file: promoting a major
 * version is a decision someone makes on purpose, so it is done by a human
 * merging the version PR in GitHub after this guard is removed or the changeset
 * is edited down.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CHANGESET_DIR = path.join(REPO_ROOT, ".changeset");

/**
 * Read the `---` delimited front matter of a changeset.
 * Returns the raw bump lines; a file without front matter yields none rather
 * than throwing, because `README.md` and `config.json` live in this directory.
 */
function bumpLines(contents) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents);
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  let entries;
  try {
    entries = readdirSync(CHANGESET_DIR);
  } catch (error) {
    console.error(
      `guard-no-major-changeset: cannot read .changeset (${String(error)})`,
    );
    process.exit(2);
  }

  const offenders = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry.toLowerCase() === "readme.md") continue;
    const file = path.join(CHANGESET_DIR, entry);
    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch (error) {
      console.error(
        `guard-no-major-changeset: cannot read ${entry} (${String(error)})`,
      );
      process.exit(2);
    }
    for (const line of bumpLines(contents)) {
      // `"@agent-native/core": major`
      const bump = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(
        line,
      );
      if (!bump) continue;
      const packageName = bump[1].trim();
      const bumpType = bump[2];
      if (bumpType === "major") {
        offenders.push(`.changeset/${entry}: ${line}`);
      }
    }
  }

  if (offenders.length > 0) {
    console.error(
      `guard-no-major-changeset: ${offenders.length} forbidden bump(s) declared.\n`,
    );
    for (const offender of offenders) console.error(`  ${offender}`);
    console.error(
      [
        "",
        "Major bumps remain blocked because a 0.x package major bump becomes",
        "1.0.0, which is how core reached 1.0.0 on 2026-08-28.",
        "",
        "Use a deliberate minor bump for an intentional breaking change in a",
        "0.x package. A major promotion still requires a human release decision.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `guard-no-major-changeset: OK (${entries.filter((e) => e.endsWith(".md")).length} changeset file(s) checked).`,
  );
}

main();
