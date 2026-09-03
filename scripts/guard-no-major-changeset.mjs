#!/usr/bin/env node
/**
 * guard-no-major-changeset - refuse unattended major bumps and core minor bumps.
 *
 * On 2026-08-28 `.changeset/remove-chat-settings-mode.md` declared
 * `"@agent-native/core": major`. Changesets reads `major` on a 0.x package as
 * 0.176.1 -> 1.0.0, the version PR was force-merged by
 * `auto-merge-version-packages.yml`, and `auto-publish.yml` pushed 1.0.0 plus
 * 55 nightlies to npm. No human saw a version number at any point. These
 * packages are pre-1.0 on purpose.
 *
 * Changesets itself has no setting for this - non-patch bumps are legal -
 * so the refusal lives here, where every PR runs it.
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
      if (
        bumpType === "major" ||
        (packageName === "@agent-native/core" && bumpType === "minor")
      ) {
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
        "@agent-native/core is pre-beta and patch-only. A `minor` or `major`",
        "bump takes it out of the patch release train. A `major` bump also",
        "takes a 0.x package straight to 1.0.0, which is how core reached",
        "1.0.0 on 2026-08-28.",
        "",
        "Change the core bump to `patch`. A deliberate non-patch promotion is",
        "a human release decision, not an unattended changeset release.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `guard-no-major-changeset: OK (${entries.filter((e) => e.endsWith(".md")).length} changeset file(s) checked).`,
  );
}

main();
