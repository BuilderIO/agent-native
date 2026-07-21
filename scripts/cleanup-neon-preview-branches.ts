#!/usr/bin/env tsx

// Cleanup for orphaned Neon preview branches.

// HOW IT WORKS
//   1. Fetches the set of currently OPEN PR numbers for the repo via `gh`.
//   2. For each Neon project (mirrors the workflow matrix), lists every branch
//      (paginated).
//   3. Flags a branch as an ORPHAN when ALL of these hold:
//        - name matches `preview/pr-<n>` (never touches main/other branches),
//        - it is not the project's default branch and not protected,
//        - its PR number is NOT in the open-PR set (PR merged/closed/deleted),
//        - it is older than --min-age-days. Default value is 30
//   4. Dry-run prints what it WOULD delete. With --delete it calls the Neon
//      delete-branch API for each orphan. 429/5xx are retried with backoff so a
//      large sweep does not trip Neon rate limits.
//
// REQUIREMENTS
//   - NEON_API_KEY exported in the environment (same value as the CI secret).
//   - `gh` CLI authenticated with read access to the repo's PRs. If the open-PR
//     count prints as 0 when PRs are actually open, the `gh` account lacks
//     access — fix that before using --delete, or every open PR looks orphaned.
//
// USAGE
//   tsx scripts/cleanup-neon-preview-branches.ts                    # dry-run, all projects, branches > 30d
//   tsx scripts/cleanup-neon-preview-branches.ts --delete           # actually delete
//   tsx scripts/cleanup-neon-preview-branches.ts --min-age-days 60  # override age guard (default 30; 0 disables)
//   tsx scripts/cleanup-neon-preview-branches.ts --project <id>     # limit to one project id
//   CLEANUP_REPO=owner/name tsx scripts/... # override repo (default BuilderIO/agent-native)
//
// Recommended: run the dry-run first, sanity-check the counts, then re-run with
// --delete. Exits non-zero if any delete fails.

import { execFileSync } from "node:child_process";

const NEON_API = "https://console.neon.tech/api/v2";
const REPO = process.env.CLEANUP_REPO ?? "BuilderIO/agent-native";
const BRANCH_RE = /^preview\/pr-(\d+)$/;

// Mirrors the matrix in .github/workflows/neon-preview-branches.yml.
const PROJECTS: Array<{ template: string; projectId: string }> = [
  { template: "brain", projectId: "lingering-band-25891811" },
  { template: "mail", projectId: "patient-cake-44789837" },
  { template: "plan", projectId: "late-pine-39936033" },
  { template: "slides", projectId: "hidden-thunder-16834477" },
  { template: "analytics", projectId: "dry-shadow-75673589" },
  { template: "calendar", projectId: "super-fire-75593365" },
  { template: "clips", projectId: "aged-glitter-95425960" },
  { template: "content", projectId: "quiet-heart-51077706" },
  { template: "forms", projectId: "curly-glade-91979555" },
];

type NeonBranch = {
  id: string;
  name: string;
  created_at: string;
  default?: boolean;
  protected?: boolean;
};

type Options = {
  apply: boolean;
  minAgeDays: number;
  onlyProject: string | undefined;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    apply: false,
    minAgeDays: 30,
    onlyProject: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--delete" || arg === "--apply") opts.apply = true;
    else if (arg === "--min-age-days") {
      opts.minAgeDays = Number(argv[++i]);
      if (!Number.isFinite(opts.minAgeDays) || opts.minAgeDays < 0) {
        console.error("--min-age-days requires a non-negative number");
        process.exit(1);
      }
    } else if (arg === "--project") opts.onlyProject = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: tsx scripts/cleanup-neon-preview-branches.ts [--delete] [--min-age-days N] [--project <id>]",
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

const apiKey = process.env.NEON_API_KEY;
if (!apiKey) {
  console.error("NEON_API_KEY is not set. Export it and re-run.");
  process.exit(1);
}

const authHeaders = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function neonFetch(path: string, init?: RequestInit): Promise<Response> {
  // Retry on 429/5xx with backoff so a large sweep does not trip rate limits.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${NEON_API}${path}`, {
      ...init,
      headers: { ...authHeaders, ...(init?.headers ?? {}) },
    });
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt >= 5) return res;
    await sleep(1000 * 2 ** attempt);
  }
}

async function listBranches(projectId: string): Promise<NeonBranch[]> {
  const branches: NeonBranch[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const res = await neonFetch(`/projects/${projectId}/branches?${query}`);
    if (!res.ok) {
      throw new Error(
        `Failed to list branches for ${projectId}: HTTP ${res.status} ${await res.text()}`,
      );
    }
    const data = (await res.json()) as {
      branches: NeonBranch[];
      pagination?: { next?: string };
    };
    branches.push(...data.branches);
    cursor = data.pagination?.next;
  } while (cursor);
  return branches;
}

async function deleteBranch(
  projectId: string,
  branchId: string,
): Promise<void> {
  const res = await neonFetch(`/projects/${projectId}/branches/${branchId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${await res.text()}`);
  }
}

function openPrNumbers(): Set<number> {
  const raw = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      REPO,
      "--state",
      "open",
      "--limit",
      "5000",
      "--json",
      "number",
    ],
    { encoding: "utf8" },
  );
  const list = JSON.parse(raw) as Array<{ number: number }>;
  return new Set(list.map((p) => p.number));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    opts.apply ? "MODE: DELETE" : "MODE: dry-run (pass --delete to remove)",
  );

  console.log(`Fetching open PRs`);

  const openPrs = openPrNumbers();
  console.log(`Open PRs in ${REPO}: ${openPrs.size}`);

  const now = Date.now();
  const ageCutoff =
    opts.minAgeDays > 0 ? now - opts.minAgeDays * 86_400_000 : null;

  const projects = opts.onlyProject
    ? PROJECTS.filter((p) => p.projectId === opts.onlyProject)
    : PROJECTS;

  let totalOrphans = 0;
  let totalDeleted = 0;
  let totalFailed = 0;

  for (const { template, projectId } of projects) {
    let branches: NeonBranch[];
    try {
      branches = await listBranches(projectId);
    } catch (err) {
      console.error(`\n[${template}] ${projectId}: ${(err as Error).message}`);
      continue;
    }

    const orphans = branches.filter((b) => {
      const match = BRANCH_RE.exec(b.name);
      if (!match) return false;
      if (b.default || b.protected) return false;
      if (openPrs.has(Number(match[1]))) return false;
      if (ageCutoff !== null && new Date(b.created_at).getTime() > ageCutoff)
        return false;
      return true;
    });

    const previewCount = branches.filter((b) => BRANCH_RE.test(b.name)).length;
    console.log(
      `\n[${template}] ${projectId}: ${branches.length} branches, ` +
        `${previewCount} preview, ${orphans.length} orphaned`,
    );
    totalOrphans += orphans.length;

    for (const branch of orphans) {
      if (!opts.apply) {
        console.log(
          `  would delete ${branch.name} (${branch.id}, ${branch.created_at})`,
        );
        continue;
      }
      try {
        await deleteBranch(projectId, branch.id);
        totalDeleted++;
        console.log(`  deleted ${branch.name} (${branch.id})`);
        await sleep(200);
      } catch (err) {
        totalFailed++;
        console.error(
          `  FAILED ${branch.name} (${branch.id}): ${(err as Error).message}`,
        );
      }
    }
  }

  console.log(
    `\nSummary: ${totalOrphans} orphaned` +
      (opts.apply
        ? `, ${totalDeleted} deleted, ${totalFailed} failed`
        : " (dry-run)"),
  );
  if (totalFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
