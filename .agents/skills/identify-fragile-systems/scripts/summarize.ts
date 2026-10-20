// Writes <plansDir>/<run>/README.md: every hot system and what the run did
// with it. A hot system with no plan, no sighting, and no recorded decision is
// listed as UNDECIDED so an incomplete run cannot look finished.
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  artifact,
  readJiraResults,
} from "../../fragility-common/lib/artifacts.ts";
import {
  main,
  readJson,
  readJsonOr,
  rel,
  runDir,
  runId,
} from "../../fragility-common/lib/cli.ts";
import { readPlan } from "../../fragility-common/lib/plan-format.ts";
import { loadJiraConfig } from "../../jira-refactor-findings/scripts/jira.ts";
import { plansDir } from "../../refactor-plan/scripts/lib.ts";
import type { Analysis } from "../../system-history/scripts/analyze.ts";

main((args) => {
  if (args.help) {
    console.log(
      "summarize --run <id>   (reads analysis, plans, jira-results.json, decisions.json; writes the plans README)",
    );
    return;
  }
  const { baseUrl } = loadJiraConfig();
  const id = runId(args);
  const data = runDir(id);
  const out = plansDir(id);
  const analysis = readJson<Analysis>(artifact(id, "analysis"));
  const results = readJiraResults(id);
  const decisions = readJsonOr<Record<string, string>>(
    artifact(id, "decisions"),
    {},
  );
  const plans = readdirSync(out)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => ({ file: f, ...readPlan(path.join(out, f)) }));

  const rows = analysis.hotSystems.map((r) => {
    const plan = plans.find((p) => p.meta.systems.includes(r.system));
    const decision = decisions[r.system];
    let disposition: string;
    if (plan) {
      const ticket = plan.meta.jira
        ? `[${plan.meta.jira}](${baseUrl}/browse/${plan.meta.jira})`
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
