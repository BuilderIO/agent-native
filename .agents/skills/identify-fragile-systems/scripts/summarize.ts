// Writes <plansDir>/<run>/README.md: every hot system and what the run did
// with it. A hot system with no plan, no sighting, and no recorded decision is
// listed as UNDECIDED so an incomplete run cannot look finished.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Analysis } from "./analyze.ts";
import type { BugVerdict } from "./bug-verdict.ts";
import {
  loadConfig,
  main,
  plansDir,
  readJson,
  rel,
  runDir,
  runId,
} from "./lib.ts";
import { readPlan } from "./plan.ts";

main((args) => {
  if (args.help) {
    console.log(
      "summarize --run <id>   (reads analysis, plans, jira-results.json, decisions.json; verdict.json in a bug run)",
    );
    return;
  }
  const config = loadConfig();
  const id = runId(args);
  const data = runDir(config, id);
  const out = plansDir(config, id);
  const analysis = readJson<Analysis>(path.join(data, "analysis.json"));
  const results = optional<
    {
      action: string;
      key: string;
      url: string;
      plan?: string;
      system?: string;
    }[]
  >(path.join(data, "jira-results.json"), []);
  const decisions = optional<Record<string, string>>(
    path.join(data, "decisions.json"),
    {},
  );
  const plans = readdirSync(out)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => ({ file: f, ...readPlan(path.join(out, f)) }));

  if (analysis.bug) {
    const verdicts = optional<BugVerdict[]>(
      path.join(data, "verdict.json"),
      [],
    );
    const file = path.join(out, "README.md");
    writeFileSync(
      file,
      renderBug(id, analysis, verdicts, results, config.jira.baseUrl),
    );
    console.log(
      `${rel(file)}: ${verdicts.map((v) => `${v.symptom} → ${v.verdict}`).join(", ") || "no verdict"}`,
    );
    if (verdicts.length === 0) {
      console.error("bug run has no verdict; record one with bug-verdict");
      process.exitCode = 1;
    }
    return;
  }

  const rows = analysis.hotSystems.map((r) => {
    const plan = plans.find((p) => p.meta.systems.includes(r.system));
    const decision = decisions[r.system];
    let disposition: string;
    if (plan) {
      const ticket = plan.meta.jira
        ? `[${plan.meta.jira}](${config.jira.baseUrl}/browse/${plan.meta.jira})`
        : "no ticket yet";
      disposition = `plan [${plan.file}](./${plan.file}), ${ticket}`;
    } else if (results.some((x) => x.system === r.system)) {
      const hit = results.find((x) => x.system === r.system)!;
      disposition = `already ticketed: sighting on [${hit.key}](${hit.url})`;
    } else if (decision) {
      disposition = decision;
    } else {
      disposition = "**UNDECIDED**";
    }
    return `| \`${r.system}\` | ${r.verdict} | ${r.score} | ${r.window.commits}/${r.lookback.fixes} | ${disposition} |`;
  });
  const undecided = rows.filter((r) => r.includes("UNDECIDED")).length;
  const created = results.filter(
    (r) => r.action === "create" || r.action === "recurrence",
  );

  const md = [
    `# Fragile systems run ${id}`,
    "",
    `Window ${analysis.windowStart} to ${analysis.windowEnd}, head \`${analysis.head.slice(0, 9)}\`, ${analysis.hotSystems.length} hot systems, ${plans.length} plans, ${created.length} new tickets, ${undecided} undecided.`,
    "",
    "| System | Verdict | Score | Window commits / lookback fixes | Disposition |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "## Jira actions",
    "",
    ...(results.length
      ? results.map(
          (r) =>
            `- ${r.action}: [${r.key}](${r.url})${r.plan ? ` from \`${path.basename(r.plan)}\`` : ""}`,
        )
      : ["- none"]),
    "",
    `Raw data: \`${rel(data)}\` (commits.json, analysis.md, jira-matches.json).`,
    "",
  ].join("\n");
  const file = path.join(out, "README.md");
  writeFileSync(file, md);
  console.log(
    `${rel(file)}: ${plans.length} plans, ${created.length} new tickets, ${undecided} undecided`,
  );
  if (undecided) process.exitCode = 1;
});

function renderBug(
  id: string,
  analysis: Analysis,
  verdicts: BugVerdict[],
  results: { action: string; key: string; url: string }[],
  jiraBase: string,
): string {
  const bug = analysis.bug!;
  const label = {
    "one-off": "one-off bug",
    pattern: "systemic pattern",
    known: "known pattern",
    "needs-info": "undecided, needs info",
  };
  const lines = [
    `# Bug triage run ${id}`,
    "",
    `Report: ${bug.url ? `[${bug.title}](${bug.url})` : bug.title} (${bug.ref}). Head \`${analysis.head.slice(0, 9)}\`, lookback from ${analysis.lookbackStart.slice(0, 10)}.`,
    "",
  ];
  if (verdicts.length === 0) lines.push("**No verdict recorded.**", "");
  for (const v of verdicts) {
    const outcome =
      v.verdict === "one-off"
        ? `Suggested fix: ${v.fix}`
        : v.verdict === "needs-info"
          ? `Ask the reporter for: ${v.ask}`
          : v.ticket
            ? `${v.plan ? `Plan [${path.basename(v.plan)}](./${path.basename(v.plan)}), ticket` : "Ticket"} [${v.ticket}](${jiraBase}/browse/${v.ticket})`
            : `Plan [${path.basename(v.plan!)}](./${path.basename(v.plan!)}), not filed: ${v.unfiled}`;
    lines.push(
      `## ${v.symptom}: ${label[v.verdict]}`,
      "",
      `- Root cause (${v.evidence ?? "unstated"}): ${v.rootCause}`,
      ...(v.trigger ? [`- Why now: ${v.trigger}`] : []),
      ...(v.ruledOut ? [`- Ruled out: ${v.ruledOut}`] : []),
      `- Why: ${v.reason}`,
      `- ${outcome}`,
      "",
    );
  }
  lines.push(
    "## Systems examined",
    "",
    "| System | Verdict | Score | Lookback commits / fixes | Focus files (lookback fixes) |",
    "|---|---|---|---|---|",
    ...analysis.hotSystems.map(
      (r) =>
        `| \`${r.system}\` | ${r.verdict} | ${r.score} | ${r.lookback.commits}/${r.lookback.fixes} | ${(r.focus ?? []).map((f) => `\`${path.basename(f.path)}\` (${f.fixes})`).join(", ")} |`,
    ),
    "",
    "## Jira actions",
    "",
    ...(results.length
      ? results.map((r) => `- ${r.action}: [${r.key}](${r.url})`)
      : ["- none"]),
    "",
  );
  return lines.join("\n");
}

function optional<T>(file: string, fallback: T): T {
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as T)
    : fallback;
}
