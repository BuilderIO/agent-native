// Records the outcome of a bug-report run, one entry per symptom:
//   one-off  → a local defect; the root cause and the suggested local fix
//   pattern  → an instance of a systemic problem; a plan (filed or not)
//   known    → an existing refactor-findings ticket already covers it
//   needs-info → cannot be decided from code and history; what to ask for
// Re-running with the same --symptom replaces that entry.
import path from "node:path";

import {
  artifact,
  readBug,
  readJiraResults,
} from "../../fragility-common/lib/artifacts.ts";
import {
  argString,
  main,
  readJsonOr,
  rel,
  runId,
  ScriptError,
  writeJson,
} from "../../fragility-common/lib/cli.ts";
import { readPlan } from "../../fragility-common/lib/plan-format.ts";
import { loadJiraConfig } from "../../jira-refactor-findings/scripts/jira.ts";

export interface BugVerdict {
  symptom: string;
  verdict: "one-off" | "pattern" | "known" | "needs-info";
  rootCause: string;
  trigger: string | null;
  ruledOut: string | null;
  evidence: "reproduced" | "traced" | "inferred";
  reason: string;
  fix: string | null;
  plan: string | null;
  ticket: string | null;
  ticketUrl: string | null;
  unfiled: string | null;
  ask: string | null;
  at: string;
}

const VERDICTS = ["one-off", "pattern", "known", "needs-info"] as const;
const EVIDENCE = ["reproduced", "traced", "inferred"] as const;

main((args) => {
  const verdict = argString(args, "verdict");
  const rootCause = argString(args, "root-cause");
  const reason = argString(args, "reason");
  if (args.help || !verdict || !rootCause || !reason) {
    console.log(
      'bug-verdict --run <id> --verdict one-off|pattern|known|needs-info --root-cause "<file:line, what goes wrong>" --reason "<why>" [--symptom "<label>"] [--fix "<local fix>"] [--plan <file>] [--unfiled "<why no ticket>"] [--ticket ENG-123] [--ask "<what to get from the reporter>"] --evidence reproduced|traced|inferred --trigger "<what changed to break it now, or none-found: what you checked>" --ruled-out "<other explanations and the check that ruled each out>"\n  one-off needs --fix; pattern needs --plan; known needs --ticket with a sighting recorded in this run; needs-info needs --ask.\n  --trigger and --ruled-out are required for one-off and pattern.',
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  if (!(VERDICTS as readonly string[]).includes(verdict))
    throw new ScriptError(`--verdict must be one of ${VERDICTS.join(", ")}`);
  const evidence = argString(args, "evidence");
  if (!evidence || !(EVIDENCE as readonly string[]).includes(evidence))
    throw new ScriptError(`--evidence must be one of ${EVIDENCE.join(", ")}`);
  const trigger = argString(args, "trigger") ?? null;
  const ruledOut = argString(args, "ruled-out") ?? null;
  // A decided verdict must explain "why now" and survive at least one rival
  // explanation; a single plausible story is how the real cause gets missed.
  if (
    (verdict === "one-off" || verdict === "pattern") &&
    (!trigger || !ruledOut)
  ) {
    throw new ScriptError(
      `${verdict} needs --trigger (the recent change that broke it, or "none-found: <what you checked>") and --ruled-out (rival explanations and the check that ruled each out)`,
    );
  }
  const id = runId(args);
  if (!readBug(id))
    throw new ScriptError(
      `run ${id} has no bug.json; start it with bug-intake`,
    );

  const fix = argString(args, "fix") ?? null;
  const planArg = argString(args, "plan");
  const unfiled = argString(args, "unfiled") ?? null;
  const ask = argString(args, "ask") ?? null;
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
  if (verdict === "needs-info") {
    if (!ask)
      throw new ScriptError(
        "needs-info needs --ask with the log, repro, or detail that would decide it",
      );
    if (planArg || ticket)
      throw new ScriptError("needs-info takes no --plan or --ticket");
  }
  if (verdict === "known") {
    if (!ticket) throw new ScriptError("known needs --ticket ENG-123");
    const results = readJiraResults(id);
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
    trigger,
    ruledOut,
    evidence: evidence as BugVerdict["evidence"],
    reason,
    fix,
    plan,
    ticket,
    ticketUrl: ticket ? `${loadJiraConfig().baseUrl}/browse/${ticket}` : null,
    unfiled,
    ask,
    at: new Date().toISOString(),
  };
  const file = artifact(id, "verdicts");
  const existing = readJsonOr<BugVerdict[]>(file, []);
  writeJson(file, [
    ...existing.filter((v) => v.symptom !== entry.symptom),
    entry,
  ]);
  console.log(`${rel(file)}: ${entry.symptom} → ${entry.verdict}`);
});
