// Collects first-parent commits on the base branch for the lookback period
// and marks the ones inside the review window. Uses only tree-level git data: this checkout may be a blobless partial clone,
// where --numstat/--stat/-p fetch every blob over the network and time out.
import path from "node:path";

import {
  argNumber,
  argString,
  commonConfig,
  main,
  rel,
  run,
  runDir,
  runId,
  ScriptError,
  writeJson,
} from "../../fragility-common/lib/cli.ts";
import {
  classifySubject,
  type CommitKind,
  loadHistoryConfig,
  prNumber,
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

export interface Collected {
  runId: string;
  repo: string;
  head: string;
  windowStart: string;
  windowEnd: string;
  lookbackStart: string;
  fetched: boolean;
  commits: Commit[];
}

const FIELD = "\x1f";
const RECORD = "\x1e";

main(async (args) => {
  if (args.help) {
    console.log(
      "collect --run <id> [--until <iso>] [--window-hours N] [--lookback-days N] [--no-fetch]",
    );
    return;
  }
  const config = loadHistoryConfig();
  const { repo } = commonConfig();
  const id = runId(args);
  const ref = `origin/${config.baseBranch}`;

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
  const lookbackDays = argNumber(args, "lookback-days", config.lookbackDays);
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

  const out: Collected = {
    runId: id,
    repo,
    head: commits[0].sha,
    windowStart: windowStart.toISOString(),
    windowEnd: until.toISOString(),
    lookbackStart: lookbackStart.toISOString(),
    fetched,
    commits,
  };
  const file = path.join(runDir(id), "commits.json");
  writeJson(file, out);

  const inWindow = commits.filter((c) => c.inWindow).length;
  console.log(
    `${rel(file)}: ${commits.length} commits in ${lookbackDays}d lookback, ${inWindow} in the ${windowHours}h window`,
  );
});
