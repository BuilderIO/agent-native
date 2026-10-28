// Writes <plansDir>/<run>/README.md for a bug run: per symptom, the verdict,
// root cause, trigger, and the fix or ticket. Exit 1 until a verdict exists.
import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  artifact,
  type BugReport,
  readBug,
  readJiraResults,
} from "../../fragility-common/lib/artifacts.ts";
import {
  main,
  readJson,
  readJsonOr,
  rel,
  runId,
  ScriptError,
} from "../../fragility-common/lib/cli.ts";
import { loadJiraConfig } from "../../jira-refactor-findings/scripts/jira.ts";
import { plansDir } from "../../refactor-plan/scripts/lib.ts";
import type { Analysis } from "../../system-history/scripts/analyze.ts";
import type { BugVerdict } from "./bug-verdict.ts";

main((args) => {
  if (args.help) {
    console.log(
      "summarize --run <id>   (reads bug.json, verdict.json, analysis, jira-results.json; writes the plans README)",
    );
    return;
  }
  const { baseUrl } = loadJiraConfig();
  const id = runId(args);
  const bug = readBug(id);
  if (!bug)
    throw new ScriptError(
      `run ${id} has no bug.json; start it with bug-intake`,
    );
  const analysis = readJson<Analysis>(artifact(id, "analysis"));
  const verdicts = readJsonOr<BugVerdict[]>(artifact(id, "verdicts"), []);
  const file = path.join(plansDir(id), "README.md");
  writeFileSync(
    file,
    renderBug(id, bug, analysis, verdicts, readJiraResults(id), baseUrl),
  );
  console.log(
    `${rel(file)}: ${verdicts.map((v) => `${v.symptom} → ${v.verdict}`).join(", ") || "no verdict"}`,
  );
  if (verdicts.length === 0) {
    console.error("bug run has no verdict; record one with bug-verdict");
    process.exitCode = 1;
  }
});

function renderBug(
  id: string,
  bug: BugReport,
  analysis: Analysis,
  verdicts: BugVerdict[],
  results: { action: string; key: string; url: string }[],
  jiraBase: string,
): string {
  const label = {
    "one-off": "one-off bug",
    pattern: "systemic pattern",
    known: "known pattern",
    "needs-info": "undecided, needs info",
  };
  const lines = [
    `# Bug triage run ${id}`,
    "",
    `Report: ${bug.source.url ? `[${bug.title}](${bug.source.url})` : bug.title} (${bug.source.ref}). Head \`${analysis.head.slice(0, 9)}\`, lookback from ${analysis.lookbackStart.slice(0, 10)}.`,
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
