// Fetches every existing refactor-findings ticket and matches them against
// the run's targets (targets.json, or --systems/--files), so the caller skips
// what is already ticketed before spending time on a plan.
import { existsSync } from "node:fs";
import path from "node:path";

import {
  artifact,
  readTargets,
  type Target,
} from "../../fragility-common/lib/artifacts.ts";
import {
  argList,
  main,
  rel,
  runId,
  writeJson,
} from "../../fragility-common/lib/cli.ts";
import { type Finding, isDeclined, isOpen, Jira } from "./jira.ts";

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
      "jira-match --run <id> [--systems a,b --files x,y]   (writes jira-findings.json; matches targets.json, or the given systems and files, into jira-matches.json)",
    );
    return;
  }
  const id = runId(args);
  const jira = new Jira();
  const findings = await jira.findings();
  const findingsFile = artifact(id, "jiraFindings");
  writeJson(findingsFile, { fetchedAt: new Date().toISOString(), findings });
  console.log(
    `${rel(findingsFile)}: ${findings.length} existing ${jira.config.label} tickets`,
  );

  const targets = targetsFor(
    id,
    argList(args, "systems"),
    argList(args, "files"),
  );
  if (!targets) {
    console.log(
      "  no targets.json in this run and no --systems; skipped matching",
    );
    return;
  }
  const matches: Match[] = targets.map((t) => ({
    system: t.system,
    verdict: t.verdict,
    score: t.score,
    matches: findings
      .map((f) => ({ f, why: overlap(t.system, t.files, f) }))
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
  writeJson(artifact(id, "jiraMatches"), matches);
  for (const m of matches) {
    const label = m.matches.length
      ? m.matches
          .map((x) => `${x.key} [${x.status}] (${x.why.join("; ")})`)
          .join(", ")
      : "no existing ticket";
    console.log(`  ${m.system}: ${label}`);
  }
});

function targetsFor(
  id: string,
  systems: string[],
  files: string[],
): Pick<Target, "system" | "files" | "verdict" | "score">[] | null {
  if (systems.length)
    return systems.map((system) => ({ system, files, verdict: "", score: 0 }));
  return existsSync(path.join(artifact(id, "targets")))
    ? readTargets(id)
    : null;
}

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
