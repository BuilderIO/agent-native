import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const NETLIFY_CLI = "netlify";
const API_OUTPUT_LIMIT = 20 * 1024 * 1024;
const REQUEST_CONCURRENCY = 6;

const PENDING_STATES = new Set([
  "new",
  "building",
  "enqueued",
  "preparing",
  "processing",
  "uploading",
]);

type NetlifySite = {
  id: string;
  name: string;
  account_slug?: string | null;
};

type NetlifyDeploy = {
  id: string;
  context?: string | null;
  state?: string | null;
  review_id?: number | null;
  branch?: string | null;
  commit_ref?: string | null;
};

type ClearOptions = {
  account?: string;
  dryRun: boolean;
  site?: string;
};

type DeployTarget = NetlifyDeploy & {
  site: NetlifySite;
};

type SiteFailure = {
  error: string;
  site: NetlifySite;
};

function printHelp(): void {
  console.log(`Usage: npm run clear:deploy-previews -- [options]
   or: pnpm clear:deploy-previews [options]

Cancel queued and running Netlify deploy previews without touching production.

Options:
  --account <slug>  Limit the scan to one Netlify account slug
  --site <id/name>  Limit the scan to one Netlify site
  --dry-run         List matching previews without canceling them
  --help            Show this help

The Netlify CLI must be installed and authenticated in the current shell.`);
}

function parseOptions(args: string[]): ClearOptions | "help" {
  const options: ClearOptions = { dryRun: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      return "help";
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--account" || arg === "--site") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--account") options.account = value;
      else options.site = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

async function runNetlifyApi<T>(
  method: string,
  data: Record<string, unknown>,
): Promise<T> {
  try {
    const result = await execFile(
      NETLIFY_CLI,
      ["api", method, "--data", JSON.stringify(data)],
      { encoding: "utf8", maxBuffer: API_OUTPUT_LIMIT },
    );
    return JSON.parse(String(result.stdout)) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`netlify api ${method} failed: ${detail}`);
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  callback: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await callback(values[index]);
      }
    }),
  );

  return results;
}

function matchesSite(site: NetlifySite, options: ClearOptions): boolean {
  if (options.account && site.account_slug !== options.account) return false;
  if (!options.site) return true;
  return site.id === options.site || site.name === options.site;
}

function isPendingPreview(deploy: NetlifyDeploy): boolean {
  return (
    deploy.context === "deploy-preview" &&
    PENDING_STATES.has(deploy.state ?? "")
  );
}

function describeTarget(target: DeployTarget): string {
  const review = target.review_id ? `PR #${target.review_id}` : "unlinked";
  const branch = target.branch ? ` ${target.branch}` : "";
  return `${target.site.name} ${target.id} ${review}${branch}`;
}

async function main(): Promise<void> {
  const parsed = parseOptions(process.argv.slice(2));
  if (parsed === "help") {
    printHelp();
    return;
  }

  const sites = await runNetlifyApi<NetlifySite[]>("listSites", {});
  const selectedSites = sites.filter((site) => matchesSite(site, parsed));
  if (!selectedSites.length) {
    throw new Error("No Netlify sites matched the requested filter");
  }

  const siteResults = await mapWithConcurrency(
    selectedSites,
    REQUEST_CONCURRENCY,
    async (
      site,
    ): Promise<{ deploys?: NetlifyDeploy[]; failure?: SiteFailure }> => {
      try {
        return {
          deploys: await runNetlifyApi<NetlifyDeploy[]>("listSiteDeploys", {
            site_id: site.id,
          }),
        };
      } catch (error) {
        return {
          failure: {
            site,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  );

  const failures = siteResults.flatMap((result) =>
    result.failure ? [result.failure] : [],
  );
  const targets = siteResults.flatMap((result, index) =>
    (result.deploys ?? [])
      .filter(isPendingPreview)
      .map((deploy) => ({ ...deploy, site: selectedSites[index] })),
  );

  console.log(
    `${parsed.dryRun ? "Found" : "Targeting"} ${targets.length} pending deploy preview${targets.length === 1 ? "" : "s"} across ${selectedSites.length} site${selectedSites.length === 1 ? "" : "s"}.`,
  );
  for (const failure of failures) {
    console.error(`${failure.site.name}: ${failure.error}`);
  }

  if (parsed.dryRun) {
    for (const target of targets) console.log(`  ${describeTarget(target)}`);
    if (failures.length) process.exitCode = 1;
    return;
  }

  const cancelResults = await mapWithConcurrency(
    targets,
    REQUEST_CONCURRENCY,
    async (target): Promise<{ target: DeployTarget; error?: string }> => {
      try {
        await runNetlifyApi("cancelSiteDeploy", { deploy_id: target.id });
        return { target };
      } catch (error) {
        return {
          target,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  const canceled = cancelResults.filter((result) => !result.error);
  const cancelFailures = cancelResults.filter(
    (result): result is { target: DeployTarget; error: string } =>
      Boolean(result.error),
  );

  console.log(
    `Canceled ${canceled.length} deploy preview${canceled.length === 1 ? "" : "s"}.`,
  );
  for (const failure of cancelFailures) {
    console.error(`${describeTarget(failure.target)}: ${failure.error}`);
  }

  if (failures.length || cancelFailures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
