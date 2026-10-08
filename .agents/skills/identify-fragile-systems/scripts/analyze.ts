// Finds systems the review window touched repeatedly, then scores each over
// the lookback period to separate "fragile" (fixes keep re-landing on the same
// files week after week) from "fast-moving" (new code plus follow-up fixes).
// Scores are percentiles against every active system in the repo, because this
// codebase is fix-heavy everywhere and absolute thresholds flag all of it.
// The verdict is a triage label for the agent, not a conclusion.
import { writeFileSync } from "node:fs";
import path from "node:path";

import type { Collected, Commit } from "./collect.ts";
import {
  classifySubject,
  compile,
  loadConfig,
  main,
  readJson,
  rel,
  runDir,
  runId,
  systemOf,
  writeJson,
} from "./lib.ts";

const SWEEP_SYSTEMS = 12;
const POPULATION_MIN_COMMITS = 8;
const DAY = 86_400_000;

export type Verdict =
  | "likely-fragile"
  | "likely-fast-moving"
  | "settling"
  | "coupled"
  | "mixed"
  | "insufficient-signal";

export interface FileStat {
  path: string;
  commits: number;
  fixes: number;
  reFixes: number;
  fixWeeks: number;
  added: boolean;
}

interface Metrics {
  commits: number;
  fixes: number;
  feats: number;
  refactors: number;
  reverts: number;
  authors: number;
  fixRatio: number;
  reFixRate: number;
  followUpRate: number;
  newFileShare: number;
  fixConcentration: number;
  persistence: number;
  primaryShare: number;
  weekly: { start: string; commits: number; fixes: number }[];
}

export interface SystemReport {
  system: string;
  window: {
    commits: number;
    fixes: number;
    prs: { number: number | null; subject: string }[];
  };
  lookback: Metrics;
  percentiles: Record<string, number>;
  score: number;
  verdict: Verdict;
  reasons: string[];
  topFiles: FileStat[];
  recentFixes: {
    sha: string;
    pr: number | null;
    date: string;
    subject: string;
  }[];
}

export interface Analysis {
  runId: string;
  head: string;
  windowStart: string;
  windowEnd: string;
  lookbackStart: string;
  prMetadata: Collected["prs"]["status"];
  baseline: {
    systems: number;
    repoFixRatio: number;
    medians: Record<string, number>;
  };
  excluded: {
    releaseCommits: number;
    sweepCommits: number;
    mechanicalSystems: string[];
  };
  hotSystems: SystemReport[];
}

type Touch = { commit: Commit; files: Commit["files"]; primary: boolean };

const TEST_FILE =
  /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(e2e|__tests__|tests?)\//;

main((args) => {
  if (args.help) {
    console.log(
      "analyze --run <id>   (reads commits.json, writes analysis.json + analysis.md)",
    );
    return;
  }
  const config = loadConfig();
  const id = runId(args);
  const dir = runDir(config, id);
  const data = readJson<Collected>(path.join(dir, "commits.json"));

  const ignoredSubject = compile(config.ignoreSubjects);
  const ignoredPath = compile(config.ignorePaths);
  const mechanical = compile(config.mechanicalPaths);

  let releaseCommits = 0;
  let sweepCommits = 0;
  let fixCommits = 0;
  let countedCommits = 0;
  const touches = new Map<string, Touch[]>();
  const mechanicalShare = new Map<
    string,
    { total: number; mechanical: number }
  >();

  for (const commit of data.commits) {
    commit.kind = classifySubject(commit.subject);
    if (ignoredSubject(commit.subject)) {
      releaseCommits++;
      continue;
    }
    const bySystem = new Map<string, Commit["files"]>();
    for (const file of commit.files) {
      if (ignoredPath(file.path)) continue;
      const system = systemOf(file.path, config);
      bySystem.set(system, [...(bySystem.get(system) ?? []), file]);
    }
    if (bySystem.size > SWEEP_SYSTEMS) {
      sweepCommits++;
      continue;
    }
    countedCommits++;
    if (isFix(commit)) fixCommits++;
    const largest = Math.max(...[...bySystem.values()].map((f) => f.length));
    for (const [system, files] of bySystem) {
      const share = mechanicalShare.get(system) ?? { total: 0, mechanical: 0 };
      share.total++;
      const substantive = files.filter((f) => !mechanical(f.path));
      if (substantive.length === 0) share.mechanical++;
      mechanicalShare.set(system, share);
      if (substantive.length)
        touches.set(system, [
          ...(touches.get(system) ?? []),
          { commit, files: substantive, primary: files.length === largest },
        ]);
    }
  }

  const mechanicalSystems = [...mechanicalShare]
    .filter(([, s]) => s.mechanical / s.total >= 0.8)
    .map(([system]) => system);

  const all = [...touches]
    .filter(([system]) => !mechanicalSystems.includes(system))
    .map(([system, list]) => measure(system, list, data, config.reFixDays));
  const population = all.filter(
    (s) => s.lookback.commits >= POPULATION_MIN_COMMITS,
  );
  const keys = [
    "fixRatio",
    "reFixRate",
    "fixConcentration",
    "persistence",
    "followUpRate",
    "newFileShare",
  ] as const;
  const sorted = Object.fromEntries(
    keys.map((k) => [
      k,
      population.map((s) => s.lookback[k]).sort((a, b) => a - b),
    ]),
  ) as Record<(typeof keys)[number], number[]>;

  const hot = all
    .filter((s) => s.window.commits >= config.minWindowCommits)
    .sort(
      (a, b) =>
        b.window.commits + b.window.fixes - (a.window.commits + a.window.fixes),
    )
    .slice(0, config.maxHotSystems)
    .map((s) => judge(s, sorted))
    .sort((a, b) => b.score - a.score);

  const analysis: Analysis = {
    runId: id,
    head: data.head,
    windowStart: data.windowStart,
    windowEnd: data.windowEnd,
    lookbackStart: data.lookbackStart,
    prMetadata: data.prs.status,
    baseline: {
      systems: population.length,
      repoFixRatio: round(countedCommits ? fixCommits / countedCommits : 0),
      medians: Object.fromEntries(
        keys.map((k) => [k, round(quantile(sorted[k], 0.5))]),
      ),
    },
    excluded: { releaseCommits, sweepCommits, mechanicalSystems },
    hotSystems: hot,
  };
  writeJson(path.join(dir, "analysis.json"), analysis);
  const md = path.join(dir, "analysis.md");
  writeFileSync(md, renderMarkdown(analysis));
  console.log(
    `${rel(md)}: ${hot.length} hot systems (baseline: ${population.length} systems, repo fix ratio ${pct(analysis.baseline.repoFixRatio)})`,
  );
  for (const r of hot) {
    console.log(
      `  ${String(r.score).padStart(3)}  ${r.verdict.padEnd(19)} ${r.system}  window ${r.window.commits}c/${r.window.fixes}f  lookback ${r.lookback.commits}c/${r.lookback.fixes}f  weekly fixes ${r.lookback.weekly.map((w) => w.fixes).join("→")}`,
    );
  }
});

function isFix(commit: Commit): boolean {
  return commit.kind === "fix" || commit.kind === "revert";
}

type Measured = Omit<
  SystemReport,
  "percentiles" | "score" | "verdict" | "reasons"
>;

function measure(
  system: string,
  list: Touch[],
  data: Collected,
  reFixDays: number,
): Measured {
  const ordered = [...list].sort((a, b) =>
    a.commit.date.localeCompare(b.commit.date),
  );
  const start = Date.parse(data.lookbackStart);
  const end = Date.parse(data.windowEnd);
  const weekOf = (at: number) => Math.floor((at - start) / (7 * DAY));
  const files = new Map<string, FileStat & { weeks: Set<number> }>();
  const lastFix = new Map<string, number>();
  const lastFeat = new Map<string, number>();
  const authors = new Set<string>();
  let reFixCommits = 0;
  let followUpFixes = 0;
  let fileTouches = 0;
  let addTouches = 0;

  for (const { commit, files: changed } of ordered) {
    const at = Date.parse(commit.date);
    authors.add(commit.author);
    let reFixed = false;
    let followUp = false;
    for (const file of changed) {
      if (TEST_FILE.test(file.path)) continue;
      const stat = files.get(file.path) ?? {
        path: file.path,
        commits: 0,
        fixes: 0,
        reFixes: 0,
        fixWeeks: 0,
        added: false,
        weeks: new Set<number>(),
      };
      stat.commits++;
      fileTouches++;
      if (file.status === "A" && commit.kind !== "refactor") {
        stat.added = true;
        addTouches++;
      }
      if (isFix(commit)) {
        stat.fixes++;
        stat.weeks.add(weekOf(at));
        const prev = lastFix.get(file.path);
        if (prev !== undefined && at - prev <= reFixDays * DAY) {
          stat.reFixes++;
          reFixed = true;
        }
        const feat = lastFeat.get(file.path);
        if (feat !== undefined && at - feat <= reFixDays * DAY) followUp = true;
        lastFix.set(file.path, at);
      } else if (commit.kind === "feat") {
        lastFeat.set(file.path, at);
      }
      files.set(file.path, stat);
    }
    if (reFixed) reFixCommits++;
    if (followUp) followUpFixes++;
  }

  const fixList = ordered.filter(({ commit }) => isFix(commit));
  const fixes = fixList.length;
  const commits = ordered.length;
  const fileStats = [...files.values()].map(({ weeks, ...rest }) => ({
    ...rest,
    fixWeeks: weeks.size,
  }));
  const repeatFixFiles = new Set(
    fileStats.filter((f) => f.fixes >= 3).map((f) => f.path),
  );
  const concentrated = fixList.filter(({ files: changed }) =>
    changed.some((f) => repeatFixFiles.has(f.path)),
  ).length;
  const totalWeeks = Math.max(1, Math.ceil((end - start) / (7 * DAY)));
  const topFiles = fileStats
    .sort((a, b) => b.fixes - a.fixes || b.commits - a.commits)
    .slice(0, 6);

  const weekly: Metrics["weekly"] = [];
  for (let w = 0; w < totalWeeks; w++) {
    const inWeek = ordered.filter(
      ({ commit }) => weekOf(Date.parse(commit.date)) === w,
    );
    weekly.push({
      start: new Date(start + w * 7 * DAY).toISOString().slice(0, 10),
      commits: inWeek.length,
      fixes: inWeek.filter(({ commit }) => isFix(commit)).length,
    });
  }

  const windowList = ordered.filter(({ commit }) => commit.inWindow);
  return {
    system,
    window: {
      commits: windowList.length,
      fixes: windowList.filter(({ commit }) => isFix(commit)).length,
      prs: windowList.map(({ commit }) => ({
        number: commit.pr,
        subject: commit.subject,
      })),
    },
    lookback: {
      commits,
      fixes,
      feats: ordered.filter(({ commit }) => commit.kind === "feat").length,
      refactors: ordered.filter(({ commit }) => commit.kind === "refactor")
        .length,
      reverts: ordered.filter(({ commit }) => commit.kind === "revert").length,
      authors: authors.size,
      fixRatio: round(commits ? fixes / commits : 0),
      reFixRate: round(fixes ? reFixCommits / fixes : 0),
      followUpRate: round(fixes ? followUpFixes / fixes : 0),
      newFileShare: round(fileTouches ? addTouches / fileTouches : 0),
      fixConcentration: round(fixes ? concentrated / fixes : 0),
      persistence: round((topFiles[0]?.fixWeeks ?? 0) / totalWeeks),
      primaryShare: round(
        commits ? ordered.filter((t) => t.primary).length / commits : 0,
      ),
      weekly,
    },
    topFiles,
    recentFixes: fixList
      .slice(-10)
      .reverse()
      .map(({ commit }) => ({
        sha: commit.sha.slice(0, 9),
        pr: commit.pr,
        date: commit.date.slice(0, 10),
        subject: commit.subject,
      })),
  };
}

function judge(s: Measured, sorted: Record<string, number[]>): SystemReport {
  const m = s.lookback;
  const p = Object.fromEntries(
    Object.keys(sorted).map((k) => [
      k,
      percentileOf(sorted[k], m[k as keyof Metrics] as number),
    ]),
  );
  const score = Math.round(
    100 *
      (0.25 * p.reFixRate +
        0.2 * p.fixConcentration +
        0.2 * p.persistence +
        0.15 * p.fixRatio +
        0.1 * (1 - p.followUpRate) +
        0.1 * (1 - p.newFileShare)) *
      Math.min(1, m.fixes / 8),
  );

  const reasons: string[] = [];
  const say = (key: string, label: string, value: number) =>
    reasons.push(
      `${label} ${pct(value)} (p${Math.round(p[key] * 100)} of active systems)`,
    );
  say("reFixRate", "re-fix rate", m.reFixRate);
  say("fixConcentration", "fixes on files fixed 3+ times", m.fixConcentration);
  say("persistence", "weeks the top file needed a fix", m.persistence);
  say("fixRatio", "fix ratio", m.fixRatio);
  if (p.followUpRate >= 0.75)
    say("followUpRate", "fixes following a recent feat", m.followUpRate);
  if (p.newFileShare >= 0.75)
    say("newFileShare", "new-file share", m.newFileShare);

  const last = m.weekly.at(-1)?.fixes ?? 0;
  const earlier = m.weekly.slice(0, -1);
  const earlierAvg = earlier.length
    ? earlier.reduce((sum, w) => sum + w.fixes, 0) / earlier.length
    : 0;
  const falling = earlierAvg >= 3 && last <= earlierAvg * 0.4;
  const coupled = m.primaryShare < 0.4;
  if (coupled)
    reasons.push(
      `only ${pct(m.primaryShare)} of commits touching it are mainly about it; it mostly changes as a side effect of other work`,
    );
  if (falling)
    reasons.push(
      `fixes fell from ~${earlierAvg.toFixed(1)}/wk to ${last} in the latest week`,
    );

  let verdict: Verdict;
  const newCode = p.newFileShare >= 0.8 || p.followUpRate >= 0.8;
  if (m.fixes < 4) verdict = "insufficient-signal";
  else if (coupled) verdict = "coupled";
  else if (newCode && score < 65) verdict = "likely-fast-moving";
  else if (score >= 60 && m.persistence >= 0.66 && !falling)
    verdict = "likely-fragile";
  else if (falling) verdict = "settling";
  else if (score < 40) verdict = "likely-fast-moving";
  else verdict = "mixed";

  return {
    ...s,
    percentiles: Object.fromEntries(
      Object.entries(p).map(([k, v]) => [k, round(v)]),
    ),
    score,
    verdict,
    reasons,
  };
}

function percentileOf(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return (below + equal / 2) / sorted.length;
}

function quantile(sorted: number[], q: number): number {
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    : 0;
}

function renderMarkdown(a: Analysis): string {
  const lines = [
    `# Fragility triage ${a.runId}`,
    "",
    `Window ${a.windowStart} to ${a.windowEnd}. Lookback from ${a.lookbackStart}. Head \`${a.head.slice(0, 9)}\`. PR metadata: ${a.prMetadata}.`,
    `Baseline: ${a.baseline.systems} systems with ${POPULATION_MIN_COMMITS}+ lookback commits; repo-wide fix ratio ${pct(a.baseline.repoFixRatio)}.`,
    `Excluded: ${a.excluded.releaseCommits} release or dependency commits, ${a.excluded.sweepCommits} sweep commits touching more than ${SWEEP_SYSTEMS} systems, mechanical systems: ${a.excluded.mechanicalSystems.join(", ") || "none"}.`,
    "",
    "Verdicts come from commit-subject heuristics. Confirm each one against diffs before planning.",
    "",
    "| Score | Verdict | System | Window c/f | Lookback c/f | Weekly fixes |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of a.hotSystems) {
    lines.push(
      `| ${r.score} | ${r.verdict} | \`${r.system}\` | ${r.window.commits}/${r.window.fixes} | ${r.lookback.commits}/${r.lookback.fixes} | ${r.lookback.weekly.map((w) => w.fixes).join(" → ")} |`,
    );
  }
  for (const r of a.hotSystems) {
    lines.push("", `## \`${r.system}\` — ${r.verdict} (${r.score})`, "");
    for (const reason of r.reasons) lines.push(`- ${reason}`);
    lines.push(
      "",
      "Top files (commits / fixes / re-fixes / weeks with a fix):",
    );
    for (const f of r.topFiles) {
      lines.push(
        `- \`${f.path}\` ${f.commits}/${f.fixes}/${f.reFixes}/${f.fixWeeks}${f.added ? " (new)" : ""}`,
      );
    }
    lines.push("", "Window commits:");
    for (const c of r.window.prs) lines.push(`- ${c.subject}`);
    lines.push("", "Recent fixes in lookback:");
    for (const f of r.recentFixes) lines.push(`- ${f.date} ${f.subject}`);
  }
  return `${lines.join("\n")}\n`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
