import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveNetlifyPrebuiltTarget } from "./netlify-prebuilt-target.ts";

type ProductionSites = Record<string, { host: string; siteId: string }>;

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type WorkspacePackage = { dir: string; pkg: PackageJson };

// Keep previews aligned with the first-party apps rendered by the docs /apps
// page. Internal and hidden templates must not get public PR preview URLs.
const docsAppSites = new Set([
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
]);
const docsSite = "fw";

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
      if (!docsAppSites.has(site)) return false;
      resolveNetlifyPrebuiltTarget("preview", site, repoRoot);
      return true;
    })
    .sort();
}

function withDocsSite(sites: string[], repoRoot: string): string[] {
  resolveNetlifyPrebuiltTarget("preview", docsSite, repoRoot);
  return [...sites, docsSite];
}

// Only these two workflows (and whatever they call) build/deploy previews;
// other workflow files under .github/ don't affect the preview matrix.
const sharedWorkflowFiles = new Set([
  ".github/workflows/deploy-netlify-pr-previews.yml",
  ".github/workflows/deploy-netlify-prebuilt.yml",
]);

// The scripts the two workflows above actually `node`/`import` (grepped from
// them directly) plus this file. A change to any other script doesn't touch
// the preview build/deploy path.
const sharedScriptFiles = new Set([
  "scripts/netlify-pr-preview-targets.ts",
  "scripts/cleanup-netlify-pr-previews.ts",
  "scripts/netlify-api-request.ts",
  "scripts/netlify-prebuilt-target.ts",
  "scripts/netlify-production-sites.json",
  "scripts/netlify-migration-url.ts",
  "scripts/check-function-size-baseline.mjs",
  "scripts/ssr-boot-smoke.mjs",
  "scripts/sync-netlify-preview-database.ts",
  "scripts/smoke-check-health.ts",
  "scripts/check-google-redirect-uris.ts",
  "scripts/check-production-cache-contract.mjs",
]);

// A change under one of these package dirs only affects sites whose
// package.json transitively depends on that package (see
// `sitesDependingOnPackageDir`), not every site.
const sharedPackageDirs = [
  "packages/core/",
  "packages/creative-context/",
  "packages/dispatch/",
  "packages/scheduling/",
  "packages/toolkit/",
];

const rootBuildFiles = new Set([
  ".nvmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

function packageDirsUnder(parentDir: string, repoRoot: string): string[] {
  const absParent = path.join(repoRoot, parentDir);
  if (!existsSync(absParent)) return [];
  return readdirSync(absParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parentDir}/${entry.name}`)
    .filter((dir) => existsSync(path.join(repoRoot, dir, "package.json")));
}

// Ports the same dependency-graph algorithm
// cancel-stale-netlify-main-deploys.yml uses, as pure functions reading
// package.json directly (no shelling out to pnpm).
export function workspacePackages(
  repoRoot: string,
): Map<string, WorkspacePackage> {
  // A partial checkout (e.g. a sparse-checkout missing both manifest roots)
  // must not silently compute a fan-out of zero packages/sites — that reads
  // as "no site depends on this change" instead of "the checkout can't tell".
  if (
    !existsSync(path.join(repoRoot, "packages")) &&
    !existsSync(path.join(repoRoot, "templates"))
  ) {
    throw new Error(
      `workspacePackages: neither packages/ nor templates/ exists under ${repoRoot}; the checkout is missing the manifests needed to compute the preview fan-out.`,
    );
  }
  const packages = new Map<string, WorkspacePackage>();
  for (const dir of [
    ...packageDirsUnder("packages", repoRoot),
    ...packageDirsUnder("templates", repoRoot),
  ]) {
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, dir, "package.json"), "utf8"),
    ) as PackageJson;
    if (pkg.name) packages.set(pkg.name, { dir, pkg });
  }
  return packages;
}

function dependencyNames(pkg: PackageJson): string[] {
  return [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.peerDependencies,
    pkg.optionalDependencies,
  ].flatMap((deps) => (deps ? Object.keys(deps) : []));
}

function packageDependsOn(
  packages: Map<string, WorkspacePackage>,
  fromName: string,
  targetName: string,
  seen: Set<string> = new Set(),
): boolean {
  if (fromName === targetName) return true;
  if (seen.has(fromName)) return false;
  seen.add(fromName);
  const entry = packages.get(fromName);
  if (!entry) return false;
  return dependencyNames(entry.pkg).some((dependency) =>
    packageDependsOn(packages, dependency, targetName, seen),
  );
}

function packageNameForDir(
  packages: Map<string, WorkspacePackage>,
  dir: string,
): string | undefined {
  for (const [name, entry] of packages) {
    if (entry.dir === dir) return name;
  }
  return undefined;
}

function templateDirForSite(site: string): string {
  return site === "starter" ? "chat" : site;
}

// Which app sites (and whether the docs site) transitively depend on the
// package that lives in `packageDir` (a `sharedPackageDirs` entry, no
// trailing slash).
function sitesDependingOnPackageDir(
  packages: Map<string, WorkspacePackage>,
  sites: readonly string[],
  packageDir: string,
): { appSites: string[]; docsSiteAffected: boolean } {
  const targetName = packageNameForDir(packages, packageDir);
  if (!targetName) return { appSites: [], docsSiteAffected: false };

  const appSites = sites.filter((site) => {
    const siteName = packageNameForDir(
      packages,
      `templates/${templateDirForSite(site)}`,
    );
    return siteName ? packageDependsOn(packages, siteName, targetName) : false;
  });

  const docsName = packageNameForDir(packages, "packages/docs");
  const docsSiteAffected = docsName
    ? packageDependsOn(packages, docsName, targetName)
    : false;

  return { appSites, docsSiteAffected };
}

export function previewEligibleSiteNames(repoRoot = REPO_ROOT): string[] {
  return withDocsSite(buildableSites(repoRoot), repoRoot);
}

export function previewSitesForChangedPaths(
  changedPaths: readonly string[],
  repoRoot = REPO_ROOT,
): string[] {
  const sites = buildableSites(repoRoot);
  const available = new Set(sites);
  const selected = new Set<string>();
  let allSites = false;
  let docsSiteChanged = false;
  const packages = workspacePackages(repoRoot);

  for (const changedPath of changedPaths) {
    const file = changedPath.replaceAll("\\", "/").trim();
    if (!file || file.startsWith(".changeset/") || file.startsWith("docs/")) {
      continue;
    }
    if (
      file === "packages/docs/CHANGELOG.md" ||
      file === "packages/docs/README.md" ||
      file.startsWith("packages/docs/changelog/")
    ) {
      continue;
    }
    if (
      file.startsWith("packages/docs/") ||
      file.startsWith("packages/core/docs/")
    ) {
      docsSiteChanged = true;
      continue;
    }
    if (
      rootBuildFiles.has(file) ||
      sharedWorkflowFiles.has(file) ||
      sharedScriptFiles.has(file)
    ) {
      allSites = true;
      continue;
    }
    if (
      file.startsWith(".github/") ||
      file.startsWith("e2e/") ||
      file.startsWith("scripts/")
    ) {
      // Not part of the preview build/deploy path (see sharedWorkflowFiles /
      // sharedScriptFiles above) — previews don't run e2e at all.
      continue;
    }
    const sharedPackageDir = sharedPackageDirs.find((prefix) =>
      file.startsWith(prefix),
    );
    if (sharedPackageDir) {
      const { appSites, docsSiteAffected } = sitesDependingOnPackageDir(
        packages,
        sites,
        sharedPackageDir.slice(0, -1),
      );
      for (const site of appSites) selected.add(site);
      if (docsSiteAffected) docsSiteChanged = true;
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

  const appSites = allSites
    ? sites
    : sites.filter((site) => selected.has(site));
  return allSites || docsSiteChanged
    ? withDocsSite(appSites, repoRoot)
    : appSites;
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
