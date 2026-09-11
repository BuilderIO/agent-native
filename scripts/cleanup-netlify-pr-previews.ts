import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { requestNetlifyApi } from "./netlify-api-request.ts";
import { previewEligibleSiteNames } from "./netlify-pr-preview-targets.ts";

type ProductionSites = Record<string, { host: string; siteId: string }>;

export type PrPreviewDeployTarget = {
  deployId: string;
  siteId: string;
  siteName: string;
  source: "github" | "netlify-branch" | "legacy-title";
};

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const LEGACY_TITLE_SCAN_MAX_PAGES = 5;

export function parseNetlifyDeployIdFromPreviewUrl(url: string): string | null {
  const match = /^https:\/\/([0-9a-f]+)--/i.exec(url.trim());
  return match?.[1] ?? null;
}

export function previewBranchForPullRequest(prNumber: number): string {
  return `pr-${prNumber}`;
}

export function previewDeployTitlePrefix(prNumber: number): string {
  return `GitHub Actions PR preview #${prNumber} `;
}

export function previewEnvironmentForSite(
  prNumber: number,
  siteName: string,
): string {
  return `pr-${prNumber}-${siteName}`;
}

function targetKey(siteId: string, deployId: string): string {
  return `${siteId}:${deployId}`;
}

function readProductionSites(repoRoot = REPO_ROOT): ProductionSites {
  return JSON.parse(
    readFileSync(
      path.join(repoRoot, "scripts", "netlify-production-sites.json"),
      "utf8",
    ),
  ) as ProductionSites;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function githubRequest(
  pathname: string,
  token: string,
): Promise<Response> {
  const [owner, repo] = process.env.GITHUB_REPOSITORY?.split("/") ?? [];
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must be set to owner/repo.");
  }

  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API ${pathname} failed with ${response.status}: ${body}`,
    );
  }
  return response;
}

async function githubPaginate<T>(
  pathname: string,
  token: string,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const separator = pathname.includes("?") ? "&" : "?";
    const response = await githubRequest(
      `${pathname}${separator}per_page=100&page=${page}`,
      token,
    );
    const pageItems = (await response.json()) as T[];
    items.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  return items;
}

export async function collectTargetsFromGithubDeployments(input: {
  owner: string;
  prNumber: number;
  repo: string;
  siteNames: readonly string[];
  sites: ProductionSites;
  token: string;
}): Promise<Map<string, PrPreviewDeployTarget>> {
  const targets = new Map<string, PrPreviewDeployTarget>();
  for (const siteName of input.siteNames) {
    const site = input.sites[siteName];
    if (!site?.siteId) continue;

    const environment = previewEnvironmentForSite(input.prNumber, siteName);
    const deployments = await githubPaginate<{ id: number }>(
      `/repos/${input.owner}/${input.repo}/deployments?environment=${encodeURIComponent(environment)}`,
      input.token,
    );
    for (const deployment of deployments) {
      const statuses = await githubPaginate<{
        environment_url?: string | null;
      }>(
        `/repos/${input.owner}/${input.repo}/deployments/${deployment.id}/statuses`,
        input.token,
      );
      for (const status of statuses) {
        const deployId = parseNetlifyDeployIdFromPreviewUrl(
          status.environment_url ?? "",
        );
        if (!deployId) continue;
        const key = targetKey(site.siteId, deployId);
        targets.set(key, {
          deployId,
          siteId: site.siteId,
          siteName,
          source: "github",
        });
      }
    }
  }
  return targets;
}

type NetlifyDeploy = {
  branch?: string | null;
  id: string;
  title?: string | null;
};

async function listNetlifyDeploys(input: {
  authToken: string;
  branch?: string;
  page: number;
  siteId: string;
}): Promise<NetlifyDeploy[]> {
  const params = new URLSearchParams({
    page: String(input.page),
    per_page: "100",
  });
  if (input.branch) params.set("branch", input.branch);

  const response = await requestNetlifyApi(
    `https://api.netlify.com/api/v1/sites/${input.siteId}/deploys?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${input.authToken}`,
      },
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Netlify listSiteDeploys for ${input.siteId} failed with ${response.status}: ${body}`,
    );
  }
  return (await response.json()) as NetlifyDeploy[];
}

export async function collectTargetsFromNetlifyBranch(input: {
  authToken: string;
  prNumber: number;
  siteNames: readonly string[];
  sites: ProductionSites;
  titlePrefix: string;
}): Promise<Map<string, PrPreviewDeployTarget>> {
  const targets = new Map<string, PrPreviewDeployTarget>();
  const branch = previewBranchForPullRequest(input.prNumber);

  for (const siteName of input.siteNames) {
    const site = input.sites[siteName];
    if (!site?.siteId) continue;

    for (let page = 1; ; page += 1) {
      const deploys = await listNetlifyDeploys({
        authToken: input.authToken,
        branch,
        page,
        siteId: site.siteId,
      });
      for (const deploy of deploys) {
        const title = deploy.title ?? "";
        if (!title.startsWith(input.titlePrefix)) continue;
        const key = targetKey(site.siteId, deploy.id);
        targets.set(key, {
          deployId: deploy.id,
          siteId: site.siteId,
          siteName,
          source: "netlify-branch",
        });
      }
      if (deploys.length < 100) break;
    }
  }
  return targets;
}

export async function collectTargetsFromLegacyTitleScan(input: {
  authToken: string;
  maxPages: number;
  prNumber: number;
  siteNames: readonly string[];
  sites: ProductionSites;
  titlePrefix: string;
}): Promise<Map<string, PrPreviewDeployTarget>> {
  const targets = new Map<string, PrPreviewDeployTarget>();

  for (const siteName of input.siteNames) {
    const site = input.sites[siteName];
    if (!site?.siteId) continue;

    for (let page = 1; page <= input.maxPages; page += 1) {
      const deploys = await listNetlifyDeploys({
        authToken: input.authToken,
        page,
        siteId: site.siteId,
      });
      for (const deploy of deploys) {
        const title = deploy.title ?? "";
        if (!title.startsWith(input.titlePrefix)) continue;
        const key = targetKey(site.siteId, deploy.id);
        targets.set(key, {
          deployId: deploy.id,
          siteId: site.siteId,
          siteName,
          source: "legacy-title",
        });
      }
      if (deploys.length < 100) break;
    }
  }
  return targets;
}

export function mergeDeployTargets(
  ...groups: Array<Map<string, PrPreviewDeployTarget>>
): PrPreviewDeployTarget[] {
  const merged = new Map<string, PrPreviewDeployTarget>();
  for (const group of groups) {
    for (const [key, target] of group) {
      merged.set(key, target);
    }
  }
  return [...merged.values()].sort((left, right) =>
    `${left.siteName}:${left.deployId}`.localeCompare(
      `${right.siteName}:${right.deployId}`,
    ),
  );
}

async function deleteNetlifyDeploy(input: {
  authToken: string;
  deployId: string;
  siteId: string;
}): Promise<void> {
  const response = await requestNetlifyApi(
    `https://api.netlify.com/api/v1/sites/${input.siteId}/deploys/${input.deployId}`,
    {
      headers: {
        Authorization: `Bearer ${input.authToken}`,
      },
      method: "DELETE",
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Netlify deleteSiteDeploy ${input.deployId} failed with ${response.status}: ${body}`,
    );
  }
}

export async function deactivateGithubPreviewDeployments(input: {
  owner: string;
  prNumber: number;
  repo: string;
  siteNames: readonly string[];
  token: string;
}): Promise<void> {
  for (const siteName of input.siteNames) {
    const environment = previewEnvironmentForSite(input.prNumber, siteName);
    const deployments = await githubPaginate<{ id: number }>(
      `/repos/${input.owner}/${input.repo}/deployments?environment=${encodeURIComponent(environment)}`,
      input.token,
    );
    for (const deployment of deployments) {
      const createStatus = await fetch(
        `https://api.github.com/repos/${input.owner}/${input.repo}/deployments/${deployment.id}/statuses`,
        {
          body: JSON.stringify({ state: "inactive" }),
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${input.token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          method: "POST",
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!createStatus.ok) {
        const body = await createStatus.text();
        throw new Error(
          `GitHub createDeploymentStatus for ${deployment.id} failed with ${createStatus.status}: ${body}`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const prNumberRaw = argumentValue("--pr");
  if (!prNumberRaw) {
    throw new Error("Usage: cleanup-netlify-pr-previews.ts --pr <number>");
  }
  const prNumber = Number(prNumberRaw);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`Invalid PR number: ${prNumberRaw}`);
  }

  const authToken = process.env.NETLIFY_AUTH_TOKEN;
  if (!authToken) {
    throw new Error("NETLIFY_AUTH_TOKEN is required.");
  }
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is required.");
  }
  const [owner, repo] = process.env.GITHUB_REPOSITORY?.split("/") ?? [];
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must be set to owner/repo.");
  }

  const sites = readProductionSites();
  const siteNames = previewEligibleSiteNames();
  const titlePrefix = previewDeployTitlePrefix(prNumber);

  const githubTargets = await collectTargetsFromGithubDeployments({
    owner,
    prNumber,
    repo,
    siteNames,
    sites,
    token: githubToken,
  });
  const branchTargets = await collectTargetsFromNetlifyBranch({
    authToken,
    prNumber,
    siteNames,
    sites,
    titlePrefix,
  });
  const legacyTargets =
    githubTargets.size === 0 && branchTargets.size === 0
      ? await collectTargetsFromLegacyTitleScan({
          authToken,
          maxPages: LEGACY_TITLE_SCAN_MAX_PAGES,
          prNumber,
          siteNames,
          sites,
          titlePrefix,
        })
      : new Map<string, PrPreviewDeployTarget>();

  const targets = mergeDeployTargets(
    githubTargets,
    branchTargets,
    legacyTargets,
  );

  console.log(
    `Resolved ${targets.length} PR preview deploy(s) for #${prNumber} ` +
      `(github=${githubTargets.size}, branch=${branchTargets.size}, legacy=${legacyTargets.size}).`,
  );

  const deleteErrors: unknown[] = [];
  try {
    for (const target of targets) {
      console.log(
        `Deleting ${target.siteName} PR preview deploy ${target.deployId} (${target.source}).`,
      );
      try {
        await deleteNetlifyDeploy({
          authToken,
          deployId: target.deployId,
          siteId: target.siteId,
        });
      } catch (error) {
        deleteErrors.push(error);
      }
    }
  } finally {
    await deactivateGithubPreviewDeployments({
      owner,
      prNumber,
      repo,
      siteNames,
      token: githubToken,
    });
  }

  if (deleteErrors.length === 1) {
    throw deleteErrors[0];
  }
  if (deleteErrors.length > 1) {
    throw new AggregateError(
      deleteErrors,
      "Netlify PR preview deploy deletion failed.",
    );
  }
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
