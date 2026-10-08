// Collects first-parent commits on the base branch for the lookback period,
// marks the ones inside the review window, and enriches window PRs from GitHub.
// Uses only tree-level git data: this checkout may be a blobless partial clone,
// where --numstat/--stat/-p fetch every blob over the network and time out.
import path from "node:path";

import {
  argNumber,
  argString,
  classifySubject,
  type CommitKind,
  isBugRun,
  loadConfig,
  main,
  prNumber,
  rel,
  run,
  runDir,
  runId,
  ScriptError,
  writeJson,
} from "./lib.ts";

export interface FileChange {
  status: string;
  path: string;
}

export interface Commit {
  sha: string;
  author: string;
  date: string;
  subject: string;
  kind: CommitKind;
  pr: number | null;
  inWindow: boolean;
  files: FileChange[];
}

export interface PrMeta {
  number: number;
  title: string;
  author: string | null;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  body: string;
}

export interface Collected {
  runId: string;
  repo: string;
  head: string;
  windowStart: string;
  windowEnd: string;
  lookbackStart: string;
  fetched: boolean;
  commits: Commit[];
  prs:
    | { status: "ok"; items: PrMeta[] }
    | { status: "unavailable"; error: string };
}

const FIELD = "\x1f";
const RECORD = "\x1e";

main(async (args) => {
  if (args.help) {
    console.log(
      "collect --run <id> [--until <iso>] [--window-hours N] [--lookback-days N] [--no-fetch] [--no-prs]\n  In a bug run (bug.json present) the lookback defaults to bugLookbackDays and window PRs are skipped.",
    );
    return;
  }
  const config = loadConfig();
  const id = runId(args);
  const ref = `origin/${config.baseBranch}`;
  // A bug run has no review window; it needs a longer history for the
  // files the bug lives in, and no window PR metadata.
  const bug = isBugRun(config, id);

  let fetched = false;
  if (!args["no-fetch"]) {
    run("git", ["fetch", "--no-tags", "--quiet", "origin", config.baseBranch], {
      timeoutMs: 180_000,
    });
    fetched = true;
  }

  const until = argString(args, "until")
    ? new Date(argString(args, "until")!)
    : new Date();
  if (Number.isNaN(until.getTime()))
    throw new ScriptError("--until is not a valid date");
  const windowHours = argNumber(args, "window-hours", config.windowHours);
  const lookbackDays = argNumber(
    args,
    "lookback-days",
    bug ? config.bugLookbackDays : config.lookbackDays,
  );
  if (!(windowHours > 0) || !(lookbackDays > 0)) {
    throw new ScriptError(
      "--window-hours and --lookback-days must be positive",
    );
  }
  if (windowHours > lookbackDays * 24) {
    throw new ScriptError("the review window must fit inside the lookback");
  }
  const windowStart = new Date(until.getTime() - windowHours * 3_600_000);
  const lookbackStart = new Date(until.getTime() - lookbackDays * 86_400_000);

  const raw = run(
    "git",
    [
      "-c",
      "core.quotepath=off",
      "log",
      ref,
      "--first-parent",
      "--diff-merges=first-parent",
      "--no-renames",
      "--name-status",
      `--since=${lookbackStart.toISOString()}`,
      `--until=${until.toISOString()}`,
      `--format=${RECORD}%H${FIELD}%an${FIELD}%cI${FIELD}%s`,
    ],
    { timeoutMs: 120_000 },
  );

  const commits: Commit[] = [];
  for (const chunk of raw.split(RECORD)) {
    if (!chunk.trim()) continue;
    const [header, ...lines] = chunk.split("\n");
    const [sha, author, date, subject] = header.split(FIELD);
    const files = lines
      .filter((line) => line.trim())
      .map((line) => {
        const [status, ...rest] = line.split("\t");
        return { status: status.charAt(0), path: rest[rest.length - 1] };
      });
    commits.push({
      sha,
      author,
      date,
      subject,
      kind: classifySubject(subject),
      pr: prNumber(subject),
      inWindow: new Date(date) >= windowStart,
      files,
    });
  }
  if (commits.length === 0) {
    throw new ScriptError(
      `no commits on ${ref} since ${lookbackStart.toISOString()}`,
    );
  }

  const windowPrs = [
    ...new Set(commits.filter((c) => c.inWindow && c.pr).map((c) => c.pr!)),
  ];
  const prs: Collected["prs"] = bug
    ? { status: "unavailable", error: "bug run: no review window" }
    : args["no-prs"]
      ? { status: "unavailable", error: "skipped with --no-prs" }
      : fetchPrs(config.repo, windowPrs);

  const out: Collected = {
    runId: id,
    repo: config.repo,
    head: commits[0].sha,
    windowStart: windowStart.toISOString(),
    windowEnd: until.toISOString(),
    lookbackStart: lookbackStart.toISOString(),
    fetched,
    commits,
    prs,
  };
  const file = path.join(runDir(config, id), "commits.json");
  writeJson(file, out);

  const inWindow = commits.filter((c) => c.inWindow).length;
  console.log(
    `${rel(file)}: ${bug ? "bug run, " : ""}${commits.length} commits in ${lookbackDays}d lookback, ${inWindow} in the ${windowHours}h window; PR metadata ${prs.status}${prs.status === "ok" ? ` (${prs.items.length}/${windowPrs.length})` : `: ${prs.error}`}`,
  );
});

function fetchPrs(repo: string, numbers: number[]): Collected["prs"] {
  const [owner, name] = repo.split("/");
  const items: PrMeta[] = [];
  try {
    for (let i = 0; i < numbers.length; i += 20) {
      const batch = numbers.slice(i, i + 20);
      const fields = batch
        .map(
          (n) =>
            `p${n}: pullRequest(number: ${n}) { number title body mergedAt additions deletions changedFiles author { login } labels(first: 10) { nodes { name } } }`,
        )
        .join("\n");
      const query = `query { repository(owner: "${owner}", name: "${name}") { ${fields} } }`;
      const response = withRetry(() =>
        run("gh", ["api", "graphql", "-f", `query=${query}`], {
          timeoutMs: 60_000,
        }),
      );
      const parsed = JSON.parse(response) as {
        data?: { repository?: Record<string, RawPr | null> };
        errors?: { message: string }[];
      };
      const repoData = parsed.data?.repository;
      if (!repoData) {
        throw new Error(
          parsed.errors?.map((e) => e.message).join("; ") ?? "empty response",
        );
      }
      for (const pr of Object.values(repoData)) {
        if (!pr) continue;
        items.push({
          number: pr.number,
          title: pr.title,
          author: pr.author?.login ?? null,
          mergedAt: pr.mergedAt,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changedFiles,
          labels: pr.labels.nodes.map((l) => l.name),
          body: pr.body.slice(0, 2000),
        });
      }
    }
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { status: "ok", items };
}

interface RawPr {
  number: number;
  title: string;
  body: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { login: string } | null;
  labels: { nodes: { name: string }[] };
}

function withRetry<T>(fn: () => T, attempts = 3): T {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
