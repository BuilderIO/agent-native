// Fetches every existing refactor-findings ticket and matches them against
// the run's targets (targets.json, or --systems/--files), so the caller skips
// what is already ticketed before spending time on a plan. A match is by
// system, but a ticket only covers the evidence files on its paths: in a big
// system, one ticket must not absorb fixes to an unrelated problem.
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
import { isDeclined, isOpen, Jira, overlap } from "./jira.ts";

export interface Match {
  system: string;
  verdict: string;
  score: number;
  /** How many evidence files the run has for the system. */
  evidenceFiles: number;
  /** Evidence files on no matched open or declined ticket's paths. */
  uncovered: string[];
  matches: {
    key: string;
    summary: string;
    status: string;
    open: boolean;
    declined: boolean;
    why: string[];
    /** How many of the system's evidence files are on this ticket's paths. */
    covers: number;
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
  const matches: Match[] = targets.map((t) => {
    const matched = findings
      .map((f) => ({ f, why: overlap(t.system, t.files, f) }))
      .filter(({ why }) => why.length > 0);
    const covering = matched
      .filter(({ f }) => isOpen(f) || isDeclined(f))
      .flatMap(({ f }) => f.paths);
    return {
      system: t.system,
      verdict: t.verdict,
      score: t.score,
      evidenceFiles: t.evidenceFiles.length,
      uncovered: t.evidenceFiles.filter((file) => !covering.includes(file)),
      matches: matched.map(({ f, why }) => ({
        key: f.key,
        summary: f.summary,
        status: f.status,
        open: isOpen(f),
        declined: isDeclined(f),
        why,
        covers: t.evidenceFiles.filter((file) => f.paths.includes(file)).length,
      })),
    };
  });
  writeJson(artifact(id, "jiraMatches"), matches);
  for (const m of matches) {
    if (!m.matches.length) {
      console.log(`  ${m.system}: no existing ticket`);
      continue;
    }
    const tickets = m.matches
      .map(
        (x) =>
          `${x.key} [${x.status}] (${x.why.join("; ")}) covers ${x.covers}/${m.evidenceFiles}`,
      )
      .join(", ");
    const gap = m.uncovered.length
      ? `; ${m.uncovered.length} uncovered: ${m.uncovered.slice(0, 4).join(", ")}${m.uncovered.length > 4 ? ", …" : ""}`
      : m.evidenceFiles
        ? "; all evidence covered"
        : "; no evidence files in this run";
    console.log(`  ${m.system}: ${tickets}${gap}`);
  }
});

function targetsFor(
  id: string,
  systems: string[],
  files: string[],
):
  | Pick<Target, "system" | "files" | "evidenceFiles" | "verdict" | "score">[]
  | null {
  if (systems.length)
    return systems.map((system) => ({
      system,
      files,
      evidenceFiles: files,
      verdict: "",
      score: 0,
    }));
  return existsSync(path.join(artifact(id, "targets")))
    ? readTargets(id)
    : null;
}
