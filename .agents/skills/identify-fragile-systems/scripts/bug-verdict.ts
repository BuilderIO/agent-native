// Records the outcome of a bug-report run, one entry per symptom:
//   one-off  → a local defect; the root cause and the suggested local fix
//   pattern  → an instance of a systemic problem; a plan (filed or not)
//   known    → an existing refactor-findings ticket already covers it
// Re-running with the same --symptom replaces that entry.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  argString,
  isBugRun,
  loadConfig,
  main,
  readJson,
  rel,
  runDir,
  runId,
  ScriptError,
  writeJson,
} from "./lib.ts";
import { readPlan } from "./plan.ts";

export interface BugVerdict {
  symptom: string;
  verdict: "one-off" | "pattern" | "known";
  rootCause: string;
  reason: string;
  fix: string | null;
  plan: string | null;
  ticket: string | null;
  ticketUrl: string | null;
  unfiled: string | null;
  at: string;
}

const VERDICTS = ["one-off", "pattern", "known"] as const;

main((args) => {
  const verdict = argString(args, "verdict");
  const rootCause = argString(args, "root-cause");
  const reason = argString(args, "reason");
  if (args.help || !verdict || !rootCause || !reason) {
    console.log(
      'bug-verdict --run <id> --verdict one-off|pattern|known --root-cause "<file:line, what goes wrong>" --reason "<why>" [--symptom "<label>"] [--fix "<local fix>"] [--plan <file>] [--unfiled "<why no ticket>"] [--ticket ENG-123]\n  one-off needs --fix; pattern needs --plan; known needs --ticket with a sighting recorded in this run.',
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  if (!(VERDICTS as readonly string[]).includes(verdict))
    throw new ScriptError(`--verdict must be one of ${VERDICTS.join(", ")}`);
  const config = loadConfig();
  const id = runId(args);
  if (!isBugRun(config, id))
    throw new ScriptError(
      `run ${id} has no bug.json; start it with bug-intake`,
    );
  const dir = runDir(config, id);

  const fix = argString(args, "fix") ?? null;
  const planArg = argString(args, "plan");
  const unfiled = argString(args, "unfiled") ?? null;
  let ticket = argString(args, "ticket") ?? null;
  let plan: string | null = null;

  if (verdict === "one-off") {
    if (!fix) throw new ScriptError("one-off needs --fix with the local fix");
    if (planArg || ticket)
      throw new ScriptError("one-off takes no --plan or --ticket");
  }
  if (verdict === "pattern") {
    if (!planArg) throw new ScriptError("pattern needs --plan <file>");
    const file = path.resolve(planArg);
    const { meta } = readPlan(file);
    if (meta.runId !== id)
      throw new ScriptError(
        `${planArg} belongs to run ${meta.runId}, not ${id}`,
      );
    plan = rel(file);
    ticket = meta.jira;
    if (!ticket && !unfiled) {
      throw new ScriptError(
        `${planArg} has no ticket. File it with jira-upsert --apply, or pass --unfiled "<reason>" (low confidence, ticket cap)`,
      );
    }
  }
  if (verdict === "known") {
    if (!ticket) throw new ScriptError("known needs --ticket ENG-123");
    const results = resultsFor(dir);
    if (!results.some((r) => r.key === ticket)) {
      throw new ScriptError(
        `no sighting on ${ticket} in this run; run jira-sighting --key ${ticket} --system <system> --note "..." --apply first`,
      );
    }
  }

  const entry: BugVerdict = {
    symptom: argString(args, "symptom") ?? "main",
    verdict: verdict as BugVerdict["verdict"],
    rootCause,
    reason,
    fix,
    plan,
    ticket,
    ticketUrl: ticket ? `${config.jira.baseUrl}/browse/${ticket}` : null,
    unfiled,
    at: new Date().toISOString(),
  };
  const file = path.join(dir, "verdict.json");
  const existing = existsSync(file) ? readJson<BugVerdict[]>(file) : [];
  writeJson(file, [
    ...existing.filter((v) => v.symptom !== entry.symptom),
    entry,
  ]);
  console.log(`${rel(file)}: ${entry.symptom} → ${entry.verdict}`);
});

function resultsFor(dir: string): { key: string }[] {
  const file = path.join(dir, "jira-results.json");
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { key: string }[])
    : [];
}
