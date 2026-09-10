import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveNetlifyPrebuiltTarget } from "./netlify-prebuilt-target.ts";

type ProductionSites = Record<string, { host: string; siteId: string }>;

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readProductionSites(repoRoot = REPO_ROOT): ProductionSites {
  return JSON.parse(
    readFileSync(
      path.join(repoRoot, "scripts", "netlify-production-sites.json"),
      "utf8",
    ),
  ) as ProductionSites;
}

function buildableSites(repoRoot = REPO_ROOT): string[] {
  return Object.keys(readProductionSites(repoRoot))
    .filter((site) => {
      if (site === "workspace") return false;
      resolveNetlifyPrebuiltTarget("preview", site, repoRoot);
      return true;
    })
    .sort();
}

const sharedBuildPaths = [
  ".github/",
  "packages/core/",
  "packages/creative-context/",
  "packages/dispatch/",
  "packages/scheduling/",
  "packages/toolkit/",
  "scripts/",
  "e2e/",
];

const rootBuildFiles = new Set([
  ".nvmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

export function previewSitesForChangedPaths(
  changedPaths: readonly string[],
  repoRoot = REPO_ROOT,
): string[] {
  const sites = buildableSites(repoRoot);
  const available = new Set(sites);
  const selected = new Set<string>();
  let allSites = false;

  for (const changedPath of changedPaths) {
    const file = changedPath.replaceAll("\\", "/").trim();
    if (!file || file.startsWith(".changeset/") || file.startsWith("docs/")) {
      continue;
    }
    if (
      rootBuildFiles.has(file) ||
      sharedBuildPaths.some((prefix) => file.startsWith(prefix))
    ) {
      allSites = true;
      continue;
    }
    if (file.startsWith("packages/docs/")) {
      selected.add("fw");
      continue;
    }

    const template = file.match(/^templates\/([^/]+)(?:\/|$)/)?.[1];
    if (template) {
      const site = template === "chat" ? "starter" : template;
      if (available.has(site)) selected.add(site);
      continue;
    }

    allSites = true;
  }

  return allSites ? sites : sites.filter((site) => selected.has(site));
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): void {
  const base = argumentValue("--base");
  const head = argumentValue("--head");
  if (!base || !head) {
    throw new Error(
      "Usage: netlify-pr-preview-targets.ts --base <sha> --head <sha> [--github-output <path>]",
    );
  }

  const changedPaths = execFileSync(
    "git",
    ["diff", "--name-only", base, head],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(Boolean);
  const matrix = {
    include: previewSitesForChangedPaths(changedPaths).map((site) => ({
      site,
    })),
  };
  const outputPath = argumentValue("--github-output");
  if (outputPath) {
    appendFileSync(outputPath, `matrix=${JSON.stringify(matrix)}\n`);
    appendFileSync(
      outputPath,
      `has_targets=${matrix.include.length > 0 ? "true" : "false"}\n`,
    );
  }
  console.log(
    JSON.stringify(
      { changedPaths, hasTargets: matrix.include.length > 0, ...matrix },
      null,
      2,
    ),
  );
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) main();
