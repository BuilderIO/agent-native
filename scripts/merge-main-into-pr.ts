import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type PrState = {
  mergeable: string;
  mergeStateStatus: string;
  headRefOid: string;
};

export type Decision = { allowed: true } | { allowed: false; reason: string };

export function decide(state: PrState): Decision {
  if (state.mergeable === "CONFLICTING" || state.mergeStateStatus === "DIRTY") {
    return { allowed: true };
  }
  if (state.mergeable === "UNKNOWN") {
    return {
      allowed: false,
      reason:
        "GitHub has not computed mergeability yet (mergeable=UNKNOWN). Re-run in a minute; do not merge main on a guess.",
    };
  }
  return {
    allowed: false,
    reason: `GitHub reports mergeable=${state.mergeable}, mergeStateStatus=${state.mergeStateStatus}: no conflict. Neither repo requires up-to-date branches, so a PR that is only behind main merges as is, and a merge would only re-run CI.`,
  };
}

function run(args: string[]): { status: number; stdout: string } {
  const r = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim() };
}

function readState(pr: string): PrState {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = spawnSync(
      "gh",
      ["pr", "view", pr, "--json", "mergeable,mergeStateStatus,headRefOid"],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error(`gh pr view ${pr} failed: ${r.stderr || r.error}`);
    }
    const state = JSON.parse(r.stdout) as PrState;
    if (state.mergeable !== "UNKNOWN") return state;
    spawnSync("sleep", ["3"]);
  }
  return { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", headRefOid: "" };
}

function main(argv: string[]): number {
  const pr = argv.find((a) => !a.startsWith("--"));
  if (!pr) {
    console.error(
      "usage: merge-main-into-pr.ts <pr-number-or-url> [--check]\nexit 0 merged (or allowed), 1 conflicts to resolve, 3 refused: no conflict reported",
    );
    return 2;
  }
  const state = readState(pr);
  const decision = decide(state);
  if (!decision.allowed) {
    console.error(`refused: ${decision.reason}`);
    return 3;
  }
  if (argv.includes("--check")) return 0;

  if (run(["git", "status", "--porcelain"]).stdout !== "") {
    console.error(
      "refused: working tree is not clean; commit your work first.",
    );
    return 2;
  }
  const head = run(["git", "rev-parse", "HEAD"]).stdout;
  if (head !== state.headRefOid) {
    console.error(
      `refused: HEAD ${head} is not the live PR head ${state.headRefOid}; fetch and check out the PR head first.`,
    );
    return 2;
  }
  if (run(["git", "fetch", "origin", "main"]).status !== 0) {
    console.error("refused: git fetch origin main failed.");
    return 2;
  }
  const merge = spawnSync("git", ["merge", "--no-edit", "origin/main"], {
    stdio: "inherit",
  });
  return merge.status === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
