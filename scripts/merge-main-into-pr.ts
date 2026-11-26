import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const USAGE = `usage: node scripts/merge-main-into-pr.ts <pr-number-or-url> [--check]
Merges origin/main into the checked-out PR branch only when GitHub reports a conflict.
Exit codes:
  0  merged cleanly, or --check and a merge is allowed
  1  merge left unresolved conflicts: resolve, git commit --no-edit, push
  2  usage error or precondition failed (dirty tree or git status failed, HEAD is not the live PR head, fetch failed)
  3  refused: GitHub reports no conflict, mergeability still UNKNOWN, or the PR base is not main
  4  git merge failed without conflicts: inspect git status, do not resolve
  5  GitHub query failed (gh error or unparseable JSON)`;

export const EXIT = {
  ok: 0,
  conflicts: 1,
  precondition: 2,
  refused: 3,
  mergeFailed: 4,
  githubFailed: 5,
} as const;

export type PrState = {
  mergeable: string;
  mergeStateStatus: string;
  headRefOid: string;
  baseRefName: string;
};

export type Decision = { allowed: true } | { allowed: false; reason: string };

export function decide(state: PrState): Decision {
  if (state.mergeable === "UNKNOWN") {
    return {
      allowed: false,
      reason:
        "GitHub has not computed mergeability yet (mergeable=UNKNOWN). Re-run in a minute; do not merge main on a guess.",
    };
  }
  if (state.baseRefName !== "main") {
    return {
      allowed: false,
      reason: `PR targets ${state.baseRefName}, not main: GitHub's mergeability describes that base, so it cannot authorize merging origin/main.`,
    };
  }
  if (state.mergeable === "CONFLICTING" || state.mergeStateStatus === "DIRTY") {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `GitHub reports mergeable=${state.mergeable}, mergeStateStatus=${state.mergeStateStatus}: no conflict. Neither repo requires up-to-date branches, so a PR that is only behind main merges as is, and a merge would only re-run CI.`,
  };
}

export type Deps = {
  readState: (pr: string) => PrState;
  run: (args: string[]) => { status: number; stdout: string };
  merge: () => number;
  log: (message: string) => void;
};

const AGENT_BOOKKEEPING_PATHS = [
  ":(top,exclude)learnings.md",
  ":(top,exclude)bridge/**",
  ":(top,exclude)data/**",
];

export function mergeMainIntoPr(argv: string[], deps: Deps): number {
  const pr = argv.find((a) => !a.startsWith("--"));
  if (!pr) {
    deps.log(USAGE);
    return EXIT.precondition;
  }
  let state: PrState;
  try {
    state = deps.readState(pr);
  } catch (error) {
    deps.log(
      `github query failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EXIT.githubFailed;
  }
  const decision = decide(state);
  if (!decision.allowed) {
    deps.log(`refused: ${decision.reason}`);
    return EXIT.refused;
  }
  if (argv.includes("--check")) return EXIT.ok;

  const status = deps.run([
    "git",
    "status",
    "--porcelain",
    "--",
    ":/",
    ...AGENT_BOOKKEEPING_PATHS,
  ]);
  if (status.status !== 0) {
    deps.log("refused: git status failed, so the tree cannot be shown clean.");
    return EXIT.precondition;
  }
  if (status.stdout !== "") {
    deps.log("refused: working tree is not clean; commit your work first.");
    return EXIT.precondition;
  }
  const head = deps.run(["git", "rev-parse", "HEAD"]).stdout;
  if (head !== state.headRefOid) {
    deps.log(
      `refused: HEAD ${head} is not the live PR head ${state.headRefOid}; fetch and check out the PR head first.`,
    );
    return EXIT.precondition;
  }
  if (deps.run(["git", "fetch", "origin", "main"]).status !== 0) {
    deps.log("refused: git fetch origin main failed.");
    return EXIT.precondition;
  }
  if (deps.merge() === 0) return EXIT.ok;

  const unmerged = deps.run(["git", "diff", "--name-only", "--diff-filter=U"]);
  if (unmerged.status === 0 && unmerged.stdout !== "") return EXIT.conflicts;
  deps.log(
    "git merge failed but left no unresolved conflicts; check `git status` and the merge output above.",
  );
  return EXIT.mergeFailed;
}

function run(args: string[]): { status: number; stdout: string } {
  const r = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim() };
}

function readState(pr: string): PrState {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = spawnSync(
      "gh",
      [
        "pr",
        "view",
        pr,
        "--json",
        "mergeable,mergeStateStatus,headRefOid,baseRefName",
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error(`gh pr view ${pr} failed: ${r.stderr || r.error}`);
    }
    const state = JSON.parse(r.stdout) as PrState;
    if (state.mergeable !== "UNKNOWN") return state;
    spawnSync("sleep", ["3"]);
  }
  return {
    mergeable: "UNKNOWN",
    mergeStateStatus: "UNKNOWN",
    headRefOid: "",
    baseRefName: "",
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(
    mergeMainIntoPr(process.argv.slice(2), {
      readState,
      run,
      merge: () =>
        spawnSync("git", ["merge", "--no-edit", "origin/main"], {
          stdio: "inherit",
        }).status ?? 1,
      log: (m) => console.error(m),
    }),
  );
}
