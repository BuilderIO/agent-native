// Scaffolds a plan file for one systemic fix. Evidence comes straight from
// analysis.json so numbers in the plan always match the run; the reasoning
// sections are left as TODO markers that jira-upsert refuses to ship.
import { existsSync } from "node:fs";
import path from "node:path";

import type { Analysis } from "./analyze.ts";
import {
  argString,
  fingerprintFor,
  loadConfig,
  main,
  plansDir,
  readJson,
  rel,
  runDir,
  runId,
  ScriptError,
} from "./lib.ts";
import { TODO, writePlan } from "./plan.ts";

main((args) => {
  const slug = argString(args, "slug");
  const title = argString(args, "title");
  const systemsArg = argString(args, "systems");
  if (args.help || !slug || !title || !systemsArg) {
    console.log(
      'new-plan --run <id> --slug <kebab-id> --title "<one line>" --systems a,b [--area Framework|Slides|Design|...] [--duplicate-ok]',
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  if (!/^[a-z0-9-]+$/.test(slug))
    throw new ScriptError("--slug must be kebab-case");
  const config = loadConfig();
  const id = runId(args);
  const analysis = readJson<Analysis>(
    path.join(runDir(config, id), "analysis.json"),
  );
  const systems = systemsArg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const reports = systems.map((system) => {
    const report = analysis.hotSystems.find((r) => r.system === system);
    if (!report) {
      throw new ScriptError(
        `${system} is not a ${analysis.bug ? "focus" : "hot"} system in ${id}. Systems: ${analysis.hotSystems.map((r) => r.system).join(", ")}`,
      );
    }
    return report;
  });

  const file = path.join(plansDir(config, id), `${slug}.md`);
  if (existsSync(file) && !args.force)
    throw new ScriptError(`${rel(file)} exists; pass --force to overwrite`);

  const lead = [...reports].sort((a, b) => b.score - a.score)[0];
  const bug = analysis.bug;
  const paths = [
    ...new Set(
      reports.flatMap((r) => [
        ...(r.focus ?? []).map((f) => f.path),
        ...r.topFiles.map((f) => f.path),
      ]),
    ),
  ];
  const focusEvidence = reports.flatMap((r) =>
    (r.focus ?? []).flatMap((f) => [
      `- Focus file \`${f.path}\`: ${f.commits} commits, ${f.fixes} fixes in the lookback.`,
      ...f.fixCommits.map((c) => `  - ${c.date} ${c.subject}`),
    ]),
  );
  const relatedEvidence = analysis.related
    ? [
        `Fixes elsewhere matching ${analysis.related.keywords.map((k) => `"${k}"`).join(", ")}:`,
        ...analysis.related.commits
          .slice(0, 15)
          .map((c) => `- ${c.date} ${c.subject} (${c.systems.join(", ")})`),
        "",
      ]
    : [];
  const evidence = reports.flatMap((r) => [
    `### \`${r.system}\` — ${r.verdict} (score ${r.score})`,
    "",
    `- Window: ${r.window.commits} commits, ${r.window.fixes} fixes. Lookback: ${r.lookback.commits} commits, ${r.lookback.fixes} fixes, ${r.lookback.authors} authors.`,
    `- Weekly fixes: ${r.lookback.weekly.map((w) => `${w.start}: ${w.fixes}`).join(", ")}.`,
    ...r.reasons.map((reason) => `- ${reason}`),
    "",
    "Top files (commits / fixes / re-fixes / weeks with a fix):",
    ...r.topFiles.map(
      (f) =>
        `- \`${f.path}\` ${f.commits}/${f.fixes}/${f.reFixes}/${f.fixWeeks}`,
    ),
    "",
    "Recent fixes:",
    ...r.recentFixes.map((f) => `- ${f.date} ${f.subject}`),
    "",
  ]);

  const body = [
    `# ${title}`,
    "",
    bug
      ? `Run ${id}, triggered by a bug report, lookback ${analysis.lookbackStart} to ${analysis.windowEnd}, head \`${analysis.head.slice(0, 9)}\`.`
      : `Run ${id}, window ${analysis.windowStart} to ${analysis.windowEnd}, head \`${analysis.head.slice(0, 9)}\`.`,
    "",
    ...(bug
      ? [
          "## Trigger",
          "",
          `Bug report: ${bug.url ? `[${bug.title}](${bug.url})` : bug.title} (${bug.ref}).`,
          "",
          `${TODO}: where the defect is (file:line), what goes wrong, and why it is one instance of the pattern below rather than a local mistake.`,
          "",
        ]
      : []),
    "## Verdict",
    "",
    `${TODO}: fragile or fast-moving, and why. Cite the diffs you read (PR numbers) and state what would change your mind.`,
    "",
    "## Evidence",
    "",
    ...evidence,
    ...(focusEvidence.length ? [...focusEvidence, ""] : []),
    ...relatedEvidence,
    bug
      ? `${TODO}: name the repeated mechanism. Cite earlier fixes of the same kind (PR numbers) and other call sites that carry the same construct today (file:line). The reported bug alone is one instance, not a pattern.`
      : `${TODO}: what the diffs showed. Name the repeated mechanism (the same guard, special case, or retry added again), not just the counts.`,
    "",
    "## Root problem",
    "",
    `${TODO}: the boundary or abstraction that keeps forcing local patches.`,
    "",
    "## Proposed change",
    "",
    `${TODO}: scope, the new contract, what gets deleted.`,
    "",
    "## Likely affected files",
    "",
    `${TODO}: confirm or trim the list below.`,
    "",
    ...paths.map((p) => `- \`${p}\``),
    "",
    "## Migration",
    "",
    `${TODO}: numbered, incremental steps. Each step ships on its own.`,
    "",
    "## Risks",
    "",
    `${TODO}: what can break, how you would notice, rollback.`,
    "",
    "## Order of operations",
    "",
    `${TODO}: where this sits relative to other plans in this run, and any prerequisite spike.`,
    "",
  ].join("\n");

  writePlan(
    file,
    {
      fingerprint: fingerprintFor(systems, slug),
      title,
      area: argString(args, "area") ?? "Framework",
      systems,
      paths,
      verdict: lead.verdict,
      confidence: "TODO",
      score: lead.score,
      windowCommits: bug
        ? null
        : reports.reduce((s, r) => s + r.window.commits, 0),
      lookbackFixes: reports.reduce((s, r) => s + r.lookback.fixes, 0),
      runId: id,
      trigger: bug ? "bug" : "nightly",
      source: bug ? (bug.url ?? bug.ref) : null,
      jira: null,
      summary: TODO,
    },
    body,
  );
  console.log(rel(file));
});
