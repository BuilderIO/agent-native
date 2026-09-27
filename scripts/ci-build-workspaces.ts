/**
 * Build the CI-selected workspaces in two passes. Apps that prerender at
 * build time build last, one at a time: React Router gives each prerendered
 * path a fixed 10 second request with no retry, and a full rebuild running
 * every other workspace alongside starves that request until it times out.
 *
 *   node scripts/ci-build-workspaces.ts --full
 *   CI_WORKSPACE_FILTERS='["...{packages/core}..."]' node scripts/ci-build-workspaces.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function isPrerenderConfig(source: string): boolean {
  return /\bprerender\s*:/.test(source);
}

export function parseWorkspaceFilters(raw: string | undefined): string[] {
  if (!raw) {
    throw new Error(
      "CI_WORKSPACE_FILTERS is not set. Pass --full to build every workspace.",
    );
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((filter) => typeof filter === "string")
  ) {
    throw new Error("CI_WORKSPACE_FILTERS must be a JSON array of strings.");
  }
  return parsed;
}

/**
 * The pnpm argument lists for each pass. A full build keeps `pnpm build`'s
 * fail-fast behavior; an affected build keeps going so every failure shows.
 */
export function buildPasses(input: {
  full: boolean;
  filters: readonly string[];
  prerenderPackages: readonly string[];
  /**
   * An exclusion filter pulls the workspace root into `pnpm -r`, and the
   * root's own `build` is `pnpm -r build`, which would rebuild everything,
   * prerendering apps included, inside the first pass.
   */
  rootPackage: string;
}): string[][] {
  const mode = input.full ? [] : ["--no-bail", "--if-present"];
  const selection = input.filters.flatMap((filter) => ["--filter", filter]);
  const excluded = [input.rootPackage, ...input.prerenderPackages].flatMap(
    (name) => ["--filter", `!${name}`],
  );
  const passes = [["-r", ...mode, ...selection, ...excluded, "run", "build"]];
  if (input.prerenderPackages.length) {
    passes.push([
      "-r",
      ...mode,
      "--workspace-concurrency=1",
      ...input.prerenderPackages.flatMap((name) => ["--filter", name]),
      "run",
      "build",
    ]);
  }
  return passes;
}

export function selectedPrerenderPackages(
  filters: readonly string[],
): string[] {
  const listed = JSON.parse(
    execFileSync(
      "pnpm",
      [
        "-r",
        ...filters.flatMap((filter) => ["--filter", filter]),
        "ls",
        "--depth",
        "-1",
        "--json",
      ],
      { encoding: "utf8" },
    ),
  ) as Array<{ name?: string; path: string }>;
  return listed
    .filter((pkg) => {
      const config = path.join(pkg.path, "react-router.config.ts");
      return (
        pkg.name &&
        existsSync(config) &&
        isPrerenderConfig(readFileSync(config, "utf8"))
      );
    })
    .map((pkg) => pkg.name as string)
    .sort();
}

function main(): void {
  const full = process.argv.includes("--full");
  const filters = full
    ? []
    : parseWorkspaceFilters(process.env.CI_WORKSPACE_FILTERS);
  const prerenderPackages = selectedPrerenderPackages(filters);
  let failed = false;
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8")).name;
  for (const args of buildPasses({
    full,
    filters,
    prerenderPackages,
    rootPackage,
  })) {
    console.log(`\n$ pnpm ${args.join(" ")}`);
    const result = spawnSync("pnpm", args, { stdio: "inherit" });
    if (result.status === 0) continue;
    failed = true;
    if (full) break;
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
