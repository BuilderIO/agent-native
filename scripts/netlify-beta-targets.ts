import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  packageDependsOn,
  packageNameForDir,
  workspacePackages,
} from "./netlify-pr-preview-targets.ts";
import { resolveNetlifyPrebuiltTarget } from "./netlify-prebuilt-target.ts";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Only these paths can be attributed to specific sites. Anything else (root
// config, workflows, scripts, lockfile, unknown roots) rebuilds every site.
const IGNORED_PREFIXES = [".changeset/", "docs/"];

export function betaSiteIds(repoRoot = REPO_ROOT): string[] {
  const sites = JSON.parse(
    readFileSync(
      path.join(repoRoot, "scripts", "netlify-beta-sites.json"),
      "utf8",
    ),
  ) as Array<{ id: string }>;
  if (sites.length === 0) throw new Error("No beta sites configured.");
  return sites.map(({ id }) => id);
}

function workspaceDirForPath(file: string): string | undefined {
  const [parent, name] = file.split("/");
  if (!name || (parent !== "packages" && parent !== "templates")) {
    return undefined;
  }
  return `${parent}/${name}`;
}

/**
 * Beta sites whose build inputs changed. `changedPaths === null` means the
 * change set is unknown, which selects every site.
 */
export function betaSitesForChangedPaths(
  changedPaths: readonly string[] | null,
  repoRoot = REPO_ROOT,
): string[] {
  const sites = betaSiteIds(repoRoot);
  if (changedPaths === null) return sites;

  const packages = workspacePackages(repoRoot);
  const sitePackages = new Map(
    sites.map((site) => {
      const target = resolveNetlifyPrebuiltTarget("beta", site, repoRoot);
      const dir = path.posix.dirname(target.publishDirectory);
      const name = packageNameForDir(packages, dir);
      if (!name) {
        throw new Error(
          `Beta site ${site} has no workspace package at ${dir}.`,
        );
      }
      return [site, name] as const;
    }),
  );

  const selected = new Set<string>();
  for (const changedPath of changedPaths) {
    const file = changedPath.replaceAll("\\", "/").trim();
    if (!file) continue;
    if (IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;

    const dir = workspaceDirForPath(file);
    const changedPackage = dir ? packageNameForDir(packages, dir) : undefined;
    if (!changedPackage) return sites;

    for (const [site, sitePackage] of sitePackages) {
      if (packageDependsOn(packages, sitePackage, changedPackage)) {
        selected.add(site);
      }
    }
  }
  return sites.filter((site) => selected.has(site));
}

/** Published source commit per site; null when unknown. */
export type SiteBases = Record<string, string | null>;

export type SourceRelation = "behind" | "same-or-newer" | "unrelated";

/**
 * Sites to publish given each site's currently published source: sites with
 * an unknown or unrelated base publish, sites already at or past the source
 * skip, and the rest publish only when their build inputs changed.
 */
export function betaSitesToPublish(
  bases: SiteBases,
  relation: (base: string) => SourceRelation,
  changedSince: (base: string) => readonly string[] | null,
  repoRoot = REPO_ROOT,
): string[] {
  const affectedByBase = new Map<string, Set<string>>();
  return betaSiteIds(repoRoot).filter((site) => {
    const base = bases[site];
    if (!base) return true;
    const related = relation(base);
    if (related === "same-or-newer") return false;
    if (related === "unrelated") return true;
    let affected = affectedByBase.get(base);
    if (!affected) {
      affected = new Set(
        betaSitesForChangedPaths(changedSince(base), repoRoot),
      );
      affectedByBase.set(base, affected);
    }
    return affected.has(site);
  });
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function gitRelation(source: string) {
  return (base: string): SourceRelation => {
    if (isAncestor(source, base)) return "same-or-newer";
    return isAncestor(base, source) ? "behind" : "unrelated";
  };
}

function gitChangedSince(source: string) {
  return (base: string): string[] | null => {
    try {
      return execFileSync("git", ["diff", "--name-only", base, source], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      })
        .split("\n")
        .filter(Boolean);
    } catch {
      return null;
    }
  };
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): void {
  const basesFile = argumentValue("--site-bases");
  const source = argumentValue("--source");
  if (basesFile && !source) throw new Error("--site-bases requires --source.");
  const bases = basesFile
    ? (JSON.parse(readFileSync(basesFile, "utf8")) as SiteBases)
    : null;
  const sites =
    bases && source
      ? betaSitesToPublish(bases, gitRelation(source), gitChangedSince(source))
      : betaSiteIds();
  const matrix = { include: sites.map((site) => ({ site })) };
  const outputPath = argumentValue("--github-output");
  if (outputPath) {
    appendFileSync(
      outputPath,
      `matrix=${JSON.stringify(matrix)}\nhas_sites=${sites.length > 0}\n`,
    );
  }
  if (bases) {
    for (const site of betaSiteIds()) {
      console.log(
        `${site}: published ${bases[site] ?? "unknown"} -> ${sites.includes(site) ? "publish" : "up to date"}`,
      );
    }
  }
  console.log(
    `Publishing ${sites.length} beta sites: ${sites.join(", ") || "none"}.`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
