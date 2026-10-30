// Finds systems the review window touched repeatedly, then scores each over
// the lookback period to separate "fragile" (fixes keep re-landing on the same
// files week after week) from "fast-moving" (new code plus follow-up fixes).
// Scores are percentiles against every active system in the repo, because this
// codebase is fix-heavy everywhere and absolute thresholds flag all of it.
// The verdict is a triage label for the agent, not a conclusion.
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Target } from "../../fragility-common/lib/artifacts.ts";
import {
  argList,
  argNumber,
  argString,
  main,
  readJson,
  rel,
  repoRoot,
  runDir,
  runId,
  ScriptError,
  writeJson,
} from "../../fragility-common/lib/cli.ts";
import type { Collected, Commit } from "./collect.ts";
import {
  classifySubject,
  compile,
  type HistoryConfig,
  loadHistoryConfig,
  systemOf,
} from "./lib.ts";

const SWEEP_SYSTEMS = 12;
const MAIN_SHARE = 0.15;
const MEGA_PR_MAX_SYSTEMS = 3;
const TEST_FILE =
  /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(e2e|__tests__|tests?)\//;
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
  /** Days covered by the last weekly bucket (1 to 7). */
  lastWeekDays: number;
  weekly: { start: string; commits: number; fixes: number }[];
}

export interface CommitRef {
  sha: string;
  pr: number | null;
  date: string;
  subject: string;
}

export interface FocusFile {
  path: string;
  commits: number;
  fixes: number;
  fixCommits: CommitRef[];
  /** Wide commits that touched the file but don't count toward its system. */
  wideCommits: number;
}

export interface SystemReport {
  system: string;
  window: {
    commits: number;
    fixes: number;
    /** Code files the window's fix commits and mega-PRs changed in this system. */
    evidenceFiles: string[];
    prs: { number: number | null; subject: string }[];
  };
  lookback: Metrics;
  percentiles: Record<string, number>;
  score: number;
  verdict: Verdict;
  reasons: string[];
  topFiles: FileStat[];
  recentFixes: CommitRef[];
  focus?: FocusFile[];
}

export interface Analysis {
  runId: string;
  mode: "window" | "focus";
  label: { title: string; url: string | null } | null;
  focus: string[];
  regressionCandidates: (CommitRef & {
    kind: string;
    files: string[];
    wide: boolean;
  })[];
  related: {
    keywords: string[];
    commits: (CommitRef & { systems: string[]; touchesFocus: boolean })[];
  } | null;
  head: string;
  windowStart: string;
  windowEnd: string;
  lookbackStart: string;
  baseline: {
    systems: number;
    repoFixRatio: number;
    medians: Record<string, number>;
  };
  excluded: {
    releaseCommits: number;
    sweepCommits: number;
    /** Commits over SWEEP_SYSTEMS systems that counted only toward their main systems. */
    wideCommits: number;
    mechanicalSystems: string[];
  };
  /** Window PRs with many release notes; only non-launches become targets. */
  megaPrs: MegaPr[];
  hotSystems: SystemReport[];
}

export interface MegaPr extends CommitRef {
  kind: string;
  /** A feature launch: listed, not audited. */
  launch: boolean;
  /** Changelog entries plus changesets the PR added. */
  notes: number;
  /** Readable changelog entries by type. */
  changelog: Record<string, number>;
  unreadable: number;
  changesets: number;
  /** Its main systems, made hot targets, with their share of its code. */
  systems: Share[];
}

interface Share {
  system: string;
  share: number;
}

type Touch = { commit: Commit; files: Commit["files"]; primary: boolean };

main((args) => {
  if (args.help) {
    console.log(
      'analyze --run <id> [--focus <file,file>] [--label "<title>"] [--label-url <url>] [--regression-days N] [--keywords <word,word>]   (reads commits.json, writes analysis.json, analysis.md, targets.json)\n  --focus scores the systems containing these files instead of the window\'s hot systems, and lists every recent change to them as regression candidates.\n  --keywords lists lookback fixes anywhere whose subject matches, to find the same bug class elsewhere.',
    );
    return;
  }
  const config = loadHistoryConfig();
  const id = runId(args);
  const dir = runDir(id);
  const data = readJson<Collected>(path.join(dir, "commits.json"));
  const focus = argList(args, "focus").map((f) => f.replace(/^\.\//, ""));
  const keywords = argList(args, "keywords");
  const regressionDays = argNumber(
    args,
    "regression-days",
    config.regressionDays,
  );
  const labelTitle = argString(args, "label");
  const focused = focus.length > 0;
  const regressionSince = Date.parse(data.windowEnd) - regressionDays * DAY;
  if (focused && regressionSince < Date.parse(data.lookbackStart)) {
    throw new ScriptError(
      `--regression-days ${regressionDays} reaches before the collected history (from ${data.lookbackStart}); re-run collect with --lookback-days ${regressionDays} or more`,
    );
  }
  assertFocusFiles(focus, data);

  const ignoredSubject = compile(config.ignoreSubjects);
  const ignoredPath = compile(config.ignorePaths);
  const mechanical = compile(config.mechanicalPaths);

  if (data.commits.some((c) => !Array.isArray(c.changelog))) {
    throw new ScriptError(
      `${rel(path.join(dir, "commits.json"))} predates changelog collection; re-run collect for run ${id}`,
    );
  }

  let releaseCommits = 0;
  let sweepCommits = 0;
  let fixCommits = 0;
  // Commits over SWEEP_SYSTEMS systems, with the systems each counts toward.
  const wide = new Map<string, Set<string>>();
  let countedCommits = 0;
  const megaPrs: MegaPr[] = [];
  const megaShas = new Set<string>();
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
    const allCode = new Map<string, Commit["files"]>();
    for (const [system, files] of bySystem) {
      // A commit that only edits a system's tests says nothing about its code.
      const code = files.filter(
        (f) => !mechanical(f.path) && !TEST_FILE.test(f.path),
      );
      if (code.length) allCode.set(system, code);
    }
    const mainShares = mainSystems(allCode);
    // A commit over SWEEP_SYSTEMS systems counts only toward its main systems:
    // its long tail of small touches is noise in every system it reaches. With
    // no main system it is a repo-wide rename or ratchet, and is left out.
    let scored: Set<string> = new Set(bySystem.keys());
    if (bySystem.size > SWEEP_SYSTEMS) {
      scored = new Set(mainShares.map((m) => m.system));
      wide.set(commit.sha, scored);
      if (scored.size === 0) {
        sweepCommits++;
        continue;
      }
    }
    const mega = focused
      ? null
      : megaPr(commit, mainShares, config.megaPrNotes);
    if (mega) megaPrs.push(mega);
    if (mega && !mega.launch) megaShas.add(commit.sha);
    countedCommits++;
    if (isFix(commit)) fixCommits++;
    for (const [system, files] of bySystem) {
      if (!scored.has(system)) continue;
      const share = mechanicalShare.get(system) ?? { total: 0, mechanical: 0 };
      share.total++;
      if (files.every((f) => mechanical(f.path))) share.mechanical++;
      mechanicalShare.set(system, share);
    }
    const codeBySystem = new Map(
      [...allCode].filter(([system]) => scored.has(system)),
    );
    // One primary per commit, picked from the same code files that are scored,
    // even on a tie, so primaryShare isn't inflated or stolen by test churn.
    const primarySystem = largestSystem(codeBySystem);
    for (const [system, code] of codeBySystem) {
      touches.set(system, [
        ...(touches.get(system) ?? []),
        { commit, files: code, primary: system === primarySystem },
      ]);
    }
  }

  const mechanicalSystems = [...mechanicalShare]
    .filter(([, s]) => s.mechanical / s.total >= 0.8)
    .map(([system]) => system);

  const all = [...touches]
    .filter(([system]) => !mechanicalSystems.includes(system))
    .map(([system, list]) =>
      measure(system, list, data, config.reFixDays, megaShas),
    );
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

  const measuredBySystem = new Map(all.map((s) => [s.system, s]));
  const measured = (system: string): Measured =>
    measuredBySystem.get(system) ??
    measure(
      system,
      touches.get(system) ?? [],
      data,
      config.reFixDays,
      megaShas,
    );
  const focusSystems = [...new Set(focus.map((f) => systemOf(f, config)))];
  const hot: SystemReport[] = focus.length
    ? focusSystems
        .map((system) => ({
          ...judge(measured(system), sorted),
          focus: focus
            .filter((f) => systemOf(f, config) === system)
            .map((f) =>
              focusFile(f, system, data.commits, ignoredSubject, wide),
            ),
        }))
        .sort((a, b) => b.score - a.score)
    : [
        ...new Set([
          ...all
            .filter((s) => s.window.commits >= config.minWindowCommits)
            .sort(
              (a, b) =>
                b.window.commits +
                b.window.fixes -
                (a.window.commits + a.window.fixes),
            )
            .slice(0, config.maxHotSystems)
            .map((s) => s.system),
          // A mega-PR's main systems are targets even below minWindowCommits
          // or past maxHotSystems.
          ...megaPrs
            .filter((m) => !m.launch)
            .flatMap((m) => m.systems.map((s) => s.system)),
        ]),
      ]
        .map((system) => {
          const report = judge(measured(system), sorted);
          report.reasons.push(...megaPrReasons(system, megaPrs));
          return report;
        })
        .sort((a, b) => b.score - a.score);

  const analysis: Analysis = {
    runId: id,
    mode: focused ? "focus" : "window",
    label: labelTitle
      ? { title: labelTitle, url: argString(args, "label-url") ?? null }
      : null,
    focus,
    regressionCandidates: focused
      ? regressionCandidates(focus, data.commits, regressionSince, {
          ignoredSubject,
          wide,
        })
      : [],
    related: keywords.length
      ? {
          keywords,
          commits: relatedFixes(keywords, data.commits, focus, config, {
            ignoredSubject,
            ignoredPath,
          }),
        }
      : null,
    head: data.head,
    windowStart: data.windowStart,
    windowEnd: data.windowEnd,
    lookbackStart: data.lookbackStart,
    baseline: {
      systems: population.length,
      repoFixRatio: round(countedCommits ? fixCommits / countedCommits : 0),
      medians: Object.fromEntries(
        keys.map((k) => [k, round(quantile(sorted[k], 0.5))]),
      ),
    },
    excluded: {
      releaseCommits,
      sweepCommits,
      wideCommits: wide.size - sweepCommits,
      mechanicalSystems,
    },
    megaPrs,
    hotSystems: hot,
  };
  writeJson(path.join(dir, "analysis.json"), analysis);
  writeJson(path.join(dir, "targets.json"), hot.map(toTarget));
  const md = path.join(dir, "analysis.md");
  writeFileSync(md, renderMarkdown(analysis, config.megaPrNotes));
  console.log(
    `${rel(md)}: ${hot.length} hot systems (baseline: ${population.length} systems, repo fix ratio ${pct(analysis.baseline.repoFixRatio)})`,
  );
  for (const m of megaPrs)
    console.log(
      `  ${m.launch ? "launch, not audited:" : "mega-PR"} #${m.pr ?? "?"} [${m.kind}] ${m.notes} release notes → ${m.systems.map((s) => `${s.system} (${pct(s.share)})`).join(", ")}`,
    );
  if (analysis.regressionCandidates.length) {
    console.log(
      `  ${analysis.regressionCandidates.length} changes to the traced path in the last ${regressionDays}d (read each with pr.ts):`,
    );
    for (const c of analysis.regressionCandidates.slice(0, 12)) {
      console.log(
        `    ${c.date} #${c.pr ?? "?"} [${c.kind}${c.wide ? ", wide" : ""}] ${c.subject.slice(0, 80)} — ${c.files.map((f) => path.basename(f)).join(", ")}`,
      );
    }
  }
  for (const r of hot) {
    for (const f of r.focus ?? [])
      console.log(
        `  focus ${f.path}: ${f.commits} commits, ${f.fixes} fixes in the lookback${f.wideCommits ? ` (+${f.wideCommits} wide commits not counted)` : ""}`,
      );
    console.log(
      `  ${String(r.score).padStart(3)}  ${r.verdict.padEnd(19)} ${r.system}  ${focused ? "" : `window ${r.window.commits}c/${r.window.fixes}f  `}lookback ${r.lookback.commits}c/${r.lookback.fixes}f  weekly fixes ${r.lookback.weekly.map((w) => w.fixes).join("→")}`,
    );
  }
});

/** The systems holding at least MAIN_SHARE of a commit's code files, largest first. */
function mainSystems(codeBySystem: Map<string, Commit["files"]>): Share[] {
  const total = [...codeBySystem.values()].reduce((n, f) => n + f.length, 0);
  return [...codeBySystem]
    .map(([system, files]) => ({ system, share: files.length / total }))
    .filter((s) => s.share >= MAIN_SHARE)
    .sort((a, b) => b.share - a.share);
}

// Many release notes in one PR mean its main systems needed a sweep, so they
// become targets and the run audits what the sweep left behind.
function megaPr(
  commit: Commit,
  mainShares: Share[],
  minNotes: number,
): MegaPr | null {
  const notes = commit.changelog.length + commit.changesets;
  if (!commit.inWindow || notes < minNotes || mainShares.length === 0)
    return null;
  const types = commit.changelog.flatMap((e) =>
    e.type === null ? [] : [e.type],
  );
  const fixed = types.filter((t) => t === "fixed").length;
  const changelog: Record<string, number> = {};
  for (const type of types) changelog[type] = (changelog[type] ?? 0) + 1;
  return {
    ...commitRef(commit),
    kind: commit.kind,
    // A launch ships many notes too, for new code: fast motion, not a sweep.
    // A feat subject over mostly "fixed" entries is a sweep after all.
    launch:
      commit.kind === "feat" &&
      !(types.length > 0 && fixed * 2 >= types.length),
    notes,
    changelog,
    unreadable: commit.changelog.length - types.length,
    changesets: commit.changesets,
    systems: mainShares
      .slice(0, MEGA_PR_MAX_SYSTEMS)
      .map((s) => ({ system: s.system, share: round(s.share) })),
  };
}

function megaPrReasons(system: string, megaPrs: MegaPr[]): string[] {
  return megaPrs.flatMap((m) => {
    const here = m.launch
      ? undefined
      : m.systems.find((s) => s.system === system);
    return here
      ? [
          `mega-PR #${m.pr ?? "?"} (${m.notes} release notes) put ${pct(here.share)} of its code here; audit what it left behind`,
        ]
      : [];
  });
}

function largestSystem(bySystem: Map<string, unknown[]>): string | null {
  let best: string | null = null;
  let size = -1;
  for (const [system, files] of bySystem) {
    if (files.length > size) [best, size] = [system, files.length];
  }
  return best;
}

function toTarget(r: SystemReport): Target {
  return {
    system: r.system,
    files: [
      ...new Set([
        ...(r.focus ?? []).map((f) => f.path),
        ...r.topFiles.map((f) => f.path),
      ]),
    ],
    evidenceFiles: r.focus
      ? r.focus.map((f) => f.path)
      : r.window.evidenceFiles,
    score: r.score,
    verdict: r.verdict,
    windowCommits: r.focus ? null : r.window.commits,
    lookbackFixes: r.lookback.fixes,
    weeklyFixes: r.lookback.weekly.map((w) => w.fixes),
  };
}

function assertFocusFiles(focus: string[], data: Collected): void {
  const known = new Set(
    data.commits.flatMap((c) => c.files.map((f) => f.path)),
  );
  const bad = focus.filter((f) => {
    const abs = path.join(repoRoot(), f);
    const isFile = existsSync(abs) && statSync(abs).isFile();
    return !isFile && !known.has(f);
  });
  if (bad.length) {
    throw new ScriptError(
      `--focus takes repo-relative file paths; not a file in the working tree or the lookback: ${bad.join(", ")}`,
    );
  }
}

function commitRef(commit: Commit): CommitRef {
  return {
    sha: commit.sha.slice(0, 9),
    pr: commit.pr,
    date: commit.date.slice(0, 10),
    subject: commit.subject,
  };
}

function focusFile(
  file: string,
  system: string,
  commits: Commit[],
  ignoredSubject: (s: string) => boolean,
  wide: Map<string, Set<string>>,
): FocusFile {
  const touching = commits.filter(
    (c) => !ignoredSubject(c.subject) && c.files.some((f) => f.path === file),
  );
  // A wide commit that doesn't count toward this system is excluded from its
  // score, so it is excluded here too, or the file and system counts disagree.
  const counted = touching.filter((c) => wide.get(c.sha)?.has(system) ?? true);
  const fixes = counted.filter(isFix);
  return {
    path: file,
    commits: counted.length,
    fixes: fixes.length,
    fixCommits: fixes.map(commitRef),
    wideCommits: touching.length - counted.length,
  };
}

// Every kind of commit counts here, not only fixes: features and refactors
// break things too, and "got busted" reports are usually a recent change.
// Wide commits are kept and flagged: a wide shared-contract change that
// touched the path is often the trigger, even when it's left out of scores.
function regressionCandidates(
  focus: string[],
  commits: Commit[],
  since: number,
  filters: {
    ignoredSubject: (s: string) => boolean;
    wide: Map<string, Set<string>>;
  },
): Analysis["regressionCandidates"] {
  const focusSet = new Set(focus);
  return commits
    .filter(
      (c) => Date.parse(c.date) >= since && !filters.ignoredSubject(c.subject),
    )
    .map((c) => ({
      ...commitRef(c),
      kind: c.kind,
      files: c.files.map((f) => f.path).filter((p) => focusSet.has(p)),
      wide: filters.wide.has(c.sha),
    }))
    .filter((c) => c.files.length > 0);
}

function relatedFixes(
  keywords: string[],
  commits: Commit[],
  focus: string[],
  config: HistoryConfig,
  filters: {
    ignoredSubject: (s: string) => boolean;
    ignoredPath: (s: string) => boolean;
  },
): NonNullable<Analysis["related"]>["commits"] {
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`\\b(${escaped.join("|")})`, "i");
  const focusSet = new Set(focus);
  return commits
    .filter(
      (c) =>
        isFix(c) &&
        !filters.ignoredSubject(c.subject) &&
        pattern.test(c.subject),
    )
    .slice(0, 50)
    .map((c) => {
      const files = c.files.filter((f) => !filters.ignoredPath(f.path));
      return {
        ...commitRef(c),
        systems: [...new Set(files.map((f) => systemOf(f.path, config)))].slice(
          0,
          5,
        ),
        touchesFocus: files.some((f) => focusSet.has(f.path)),
      };
    });
}

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
  megaShas: Set<string>,
): Measured {
  const ordered = [...list].sort(
    (a, b) => Date.parse(a.commit.date) - Date.parse(b.commit.date),
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
  const evidence = windowList.filter(
    ({ commit }) => isFix(commit) || megaShas.has(commit.sha),
  );
  return {
    system,
    window: {
      commits: windowList.length,
      fixes: windowList.filter(({ commit }) => isFix(commit)).length,
      evidenceFiles: [
        ...new Set(
          evidence.flatMap(({ files: changed }) => changed.map((f) => f.path)),
        ),
      ],
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
      lastWeekDays: Math.min(
        7,
        Math.max(1, Math.ceil((end - start) / DAY - (totalWeeks - 1) * 7)),
      ),
      weekly,
    },
    topFiles,
    recentFixes: fixList
      .slice(-10)
      .reverse()
      .map(({ commit }) => commitRef(commit)),
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

  // The last bucket can be shorter than a week; compare its weekly rate. A day
  // or two is too short a sample to call a trend, so then the last full week
  // is the one compared.
  const short = m.lastWeekDays < 3;
  const weeks = short ? m.weekly.slice(0, -1) : m.weekly;
  const lastDays = short ? 7 : m.lastWeekDays;
  const last = round((weeks.at(-1)?.fixes ?? 0) * (7 / lastDays));
  const earlier = weeks.slice(0, -1);
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
      `fixes fell from ~${earlierAvg.toFixed(1)}/wk to ${last}/wk in the latest ${lastDays < 7 ? `${lastDays} days` : "full week"}`,
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

function renderMarkdown(a: Analysis, megaPrNotes: number): string {
  const scope =
    a.mode === "focus"
      ? [
          `${a.label ? `Subject: ${a.label.url ? `[${a.label.title}](${a.label.url})` : a.label.title}. ` : ""}Lookback from ${a.lookbackStart} to ${a.windowEnd}. Head \`${a.head.slice(0, 9)}\`.`,
          `Systems below are the ones containing the focus files (${a.focus.map((f) => `\`${f}\``).join(", ")}). Window counts do not apply in focus mode.`,
          "",
          "## Regression candidates",
          "",
          "Every recent change (any kind, not only fixes) to a file on the traced path, newest first. Read each diff with pr.ts and say whether it broke a hop's precondition.",
          "",
          ...(a.regressionCandidates.length
            ? a.regressionCandidates.map(
                (c) =>
                  `- ${c.date} #${c.pr ?? "?"} [${c.kind}${c.wide ? ", wide" : ""}] ${c.subject} — ${c.files.map((f) => `\`${f}\``).join(", ")}`,
              )
            : ["- none in the regression window"]),
          "",
        ]
      : [
          `Window ${a.windowStart} to ${a.windowEnd}. Lookback from ${a.lookbackStart}. Head \`${a.head.slice(0, 9)}\`.`,
        ];
  const lines = [
    `# Fragility triage ${a.runId}`,
    "",
    ...scope,
    `Baseline: ${a.baseline.systems} systems with ${POPULATION_MIN_COMMITS}+ lookback commits; repo-wide fix ratio ${pct(a.baseline.repoFixRatio)}.`,
    `Excluded: ${a.excluded.releaseCommits} release or dependency commits, ${a.excluded.sweepCommits} broad commits (over ${SWEEP_SYSTEMS} systems, none holding ${pct(MAIN_SHARE)} of the code), mechanical systems: ${a.excluded.mechanicalSystems.join(", ") || "none"}. ${a.excluded.wideCommits} more commits over ${SWEEP_SYSTEMS} systems counted only toward the systems holding ${pct(MAIN_SHARE)}+ of their code.`,
    "",
    "Verdicts come from commit-subject heuristics. Confirm each one against diffs before planning.",
    "",
    ...(a.mode === "window" ? megaPrSection(a.megaPrs, megaPrNotes) : []),
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
    for (const f of r.focus ?? []) {
      lines.push(
        "",
        `Focus file \`${f.path}\`: ${f.commits} commits, ${f.fixes} fixes in the lookback${f.wideCommits ? `, plus ${f.wideCommits} wide commits not counted` : ""}.`,
      );
      for (const c of f.fixCommits) lines.push(`- ${c.date} ${c.subject}`);
    }
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
  if (a.related) {
    lines.push(
      "",
      `## Fixes matching ${a.related.keywords.map((k) => `"${k}"`).join(", ")}`,
      "",
      "The same bug class landing in other systems points to a shared root cause. Subjects only; read the diffs before counting one.",
      "",
    );
    if (a.related.commits.length === 0) lines.push("- none");
    for (const c of a.related.commits) {
      lines.push(
        `- ${c.date} ${c.subject} — ${c.systems.map((s) => `\`${s}\``).join(", ")}${c.touchesFocus ? " (touches a focus file)" : ""}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function megaPrSection(megaPrs: MegaPr[], minNotes: number): string[] {
  const sweeps = megaPrs.filter((m) => !m.launch);
  const launches = megaPrs.filter((m) => m.launch);
  return [
    "## Mega-PRs",
    "",
    `PRs merged in the window with ${minNotes} or more release notes (changelog entries plus changesets), in systems holding ${pct(MAIN_SHARE)}+ of their code. Each one's main systems are hot targets: audit what the sweep left behind.`,
    "",
    ...(sweeps.length ? sweeps.map(describeMegaPr) : ["- none in the window"]),
    ...(launches.length
      ? [
          "",
          "Skipped as feature launches (a feat subject without mostly `fixed` entries). Audit one anyway if its description reads like a sweep:",
          "",
          ...launches.map(describeMegaPr),
        ]
      : []),
    "",
  ];
}

function describeMegaPr(m: MegaPr): string {
  return `- #${m.pr ?? "?"} [${m.kind}] ${m.subject}: ${m.notes} release notes (${describeNotes(m)}). Main systems: ${m.systems.map((s) => `\`${s.system}\` (${pct(s.share)})`).join(", ")}.`;
}

function describeNotes(m: MegaPr): string {
  const types = Object.entries(m.changelog)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${type} ${n}`);
  if (m.unreadable) types.push(`${m.unreadable} unreadable`);
  const parts = types.length ? [`changelog ${types.join(", ")}`] : [];
  if (m.changesets)
    parts.push(`${m.changesets} changeset${m.changesets === 1 ? "" : "s"}`);
  return parts.join("; ");
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
