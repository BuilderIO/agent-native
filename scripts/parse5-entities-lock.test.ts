import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const WORKSPACE_MANIFESTS = [
  "package.json",
  "packages/core/package.json",
  "templates/design/package.json",
];

export function lockedParse5EntitiesMajor(
  lock: string,
  parse5Version: string,
): number | undefined {
  const snapshots = lock.split("\nsnapshots:\n")[1] ?? "";
  const block = snapshots.match(
    new RegExp(
      `\\n  parse5@${parse5Version.replace(/\./g, "\\.")}:\\n((?:    .*\\n)+)`,
    ),
  );
  const entities = block?.[1].match(/\n?\s+entities: (\d+)\./);
  return entities ? Number(entities[1]) : undefined;
}

const major = (spec: string) =>
  Number(spec.replace(/^[^\d]*/, "").split(".")[0]);

test("a manifest pinning both parse5 and entities uses the entities major parse5 locks", () => {
  const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
  for (const manifest of WORKSPACE_MANIFESTS) {
    const pkg = JSON.parse(readFileSync(join(ROOT, manifest), "utf8"));
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    if (!deps.parse5 || !deps.entities) continue;
    const parse5Version = deps.parse5.replace(/^[^\d]*/, "");
    const locked = lockedParse5EntitiesMajor(lock, parse5Version);
    assert.notEqual(
      locked,
      undefined,
      `${manifest}: parse5@${parse5Version} is not in pnpm-lock.yaml`,
    );
    assert.equal(
      major(deps.entities),
      locked,
      `${manifest}: entities ${deps.entities} must match the major parse5@${parse5Version} depends on, or Vite's optimizer resolves parse5's "entities/decode" to the wrong copy`,
    );
  }
});
