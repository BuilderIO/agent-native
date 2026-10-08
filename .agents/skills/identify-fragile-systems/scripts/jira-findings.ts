// Fetches every existing refactor-findings ticket and matches them against
// this run's hot systems, so the agent skips systems that are already
// ticketed before spending time on a plan.
import { existsSync } from "node:fs";
import path from "node:path";

import type { Analysis } from "./analyze.ts";
import { type Finding, isDeclined, isOpen, Jira } from "./jira.ts";
import {
  loadConfig,
  main,
  readJson,
  rel,
  runDir,
  runId,
  writeJson,
} from "./lib.ts";

export interface Match {
  system: string;
  verdict: string;
  score: number;
  matches: {
    key: string;
    summary: string;
    status: string;
    open: boolean;
    declined: boolean;
    why: string[];
  }[];
}

main(async (args) => {
  if (args.help) {
    console.log(
      "jira-findings --run <id>   (writes jira-findings.json and, if analysis.json exists, jira-matches.json)",
    );
    return;
  }
  const config = loadConfig();
  const id = runId(args);
  const dir = runDir(config, id);
  const jira = new Jira(config);
  const findings = await jira.findings();
  writeJson(path.join(dir, "jira-findings.json"), {
    fetchedAt: new Date().toISOString(),
    findings,
  });
  console.log(
    `${rel(path.join(dir, "jira-findings.json"))}: ${findings.length} existing ${config.jira.label} tickets`,
  );

  const analysisFile = path.join(dir, "analysis.json");
  if (!existsSync(analysisFile)) {
    console.log("  no analysis.json in this run yet; skipped matching");
    return;
  }
  const analysis = readJson<Analysis>(analysisFile);
  const matches: Match[] = analysis.hotSystems.map((r) => ({
    system: r.system,
    verdict: r.verdict,
    score: r.score,
    matches: findings
      .map((f) => ({
        f,
        why: overlap(
          r.system,
          [
            ...(r.focus ?? []).map((t) => t.path),
            ...r.topFiles.map((t) => t.path),
          ],
          f,
        ),
      }))
      .filter(({ why }) => why.length > 0)
      .map(({ f, why }) => ({
        key: f.key,
        summary: f.summary,
        status: f.status,
        open: isOpen(f),
        declined: isDeclined(f),
        why,
      })),
  }));
  writeJson(path.join(dir, "jira-matches.json"), matches);
  for (const m of matches) {
    const label = m.matches.length
      ? m.matches
          .map((x) => `${x.key} [${x.status}] (${x.why.join("; ")})`)
          .join(", ")
      : "no existing ticket";
    console.log(`  ${m.system}: ${label}`);
  }
});

function overlap(system: string, files: string[], finding: Finding): string[] {
  const why: string[] = [];
  if (finding.fingerprint?.startsWith(`fsys:${system.toLowerCase()}:`))
    why.push("fingerprint anchor");
  for (const s of finding.systems) {
    if (s === system) why.push("same system");
    else if (s.startsWith(`${system}/`) || system.startsWith(`${s}/`))
      why.push(`nested system ${s}`);
  }
  const shared = files.filter((f) => finding.paths.includes(f));
  if (shared.length)
    why.push(
      `${shared.length} shared file(s): ${shared.slice(0, 3).join(", ")}`,
    );
  return [...new Set(why)];
}
