// Fetches every existing refactor-findings ticket from the configured tracker
// and matches them against the run's targets (targets.json, or
// --systems/--files), so the caller skips what is already ticketed before
// spending time on a plan.
import { existsSync } from "node:fs";

import { artifact, readTargets, type Target } from "../lib/artifacts.ts";
import { argList, main, rel, runId, writeJson } from "../lib/cli.ts";
import { loadTracker, overlap } from "../lib/findings.ts";

export interface Match {
  system: string;
  verdict: string;
  score: number;
  matches: {
    key: string;
    url: string;
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
      "findings-match --run <id> [--systems a,b --files x,y]   (writes findings.json; matches targets.json, or the given systems and files, into finding-matches.json)",
    );
    return;
  }
  const id = runId(args);
  const tracker = (await loadTracker()).createTracker();
  const findings = await tracker.findings();
  const findingsFile = artifact(id, "findings");
  writeJson(findingsFile, {
    tracker: tracker.name,
    fetchedAt: new Date().toISOString(),
    findings,
  });
  console.log(
    `${rel(findingsFile)}: ${findings.length} existing ${tracker.label} tickets in ${tracker.name}`,
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
        url: f.url,
        summary: f.summary,
        status: f.status,
        open: f.open,
        declined: f.declined,
        why,
      })),
  }));
  writeJson(artifact(id, "findingMatches"), matches);
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
  return existsSync(artifact(id, "targets")) ? readTargets(id) : null;
}
