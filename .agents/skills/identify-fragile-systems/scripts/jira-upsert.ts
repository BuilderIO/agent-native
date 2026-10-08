// Turns one finished plan file into Jira state, idempotently:
//   no ticket          → create (Pod, label, plan attached, run link)
//   open ticket        → record a sighting; comment + attach the new plan at most once per cooldown
//   fixed ticket       → create a recurrence ticket linked to the old one
//   declined ticket    → record the sighting only; never re-create
// Dry-run unless --apply. Re-running after a partial failure finishes the job.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  adf,
  type AdfNode,
  type Finding,
  type FindingProperty,
  isDeclined,
  isOpen,
  Jira,
  mergeSighting,
  runLink,
  type Sighting,
} from "./jira.ts";
import {
  argString,
  loadConfig,
  main,
  rel,
  runDir,
  ScriptError,
} from "./lib.ts";
import { type PlanMeta, readPlan, TODO, writePlan } from "./plan.ts";

type Action =
  | "create"
  | "recurrence"
  | "sighting-comment"
  | "sighting-silent"
  | "declined-sighting";

main(async (args) => {
  const planFile = argString(args, "plan");
  if (args.help || !planFile) {
    console.log(
      "jira-upsert --plan <file> [--apply] [--duplicate-of ENG-123] [--run-url <url> | --no-run-url] [--force-comment] [--over-cap]",
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const file = path.resolve(planFile);
  const { meta, body } = readPlan(file);
  assertFinished(meta, body, file);

  const link = argString(args, "run-url") ?? runLink().url;
  if (!link && !args["no-run-url"]) {
    throw new ScriptError(
      "no run link: set FRAGILITY_RUN_URL or pass --run-url; pass --no-run-url only for local runs with no shareable link",
      2,
    );
  }

  const jira = new Jira(config);
  const findings = await jira.findings();
  const duplicateOf = argString(args, "duplicate-of");
  const match =
    (duplicateOf && findings.find((f) => f.key === duplicateOf)) ||
    findings.find((f) => f.fingerprint === meta.fingerprint) ||
    null;
  if (duplicateOf && !match)
    throw new ScriptError(
      `--duplicate-of ${duplicateOf} is not a ${config.jira.label} ticket`,
    );

  const today = new Date().toISOString().slice(0, 10);
  const sighting: Sighting = {
    runId: meta.runId,
    date: today,
    score: meta.score,
    verdict: meta.verdict,
    windowCommits: meta.windowCommits,
    lookbackFixes: meta.lookbackFixes,
  };
  const action = decide(
    match,
    config.jira.sightingCooldownDays,
    Boolean(args["force-comment"]),
  );
  const attachmentName = `${path.basename(file, ".md")}-${meta.runId}.md`;
  const plan = {
    action,
    key: match?.key ?? null,
    fingerprint: meta.fingerprint,
    attachmentName,
    runLink: link,
  };

  if (
    (action === "create" || action === "recurrence") &&
    meta.confidence.toLowerCase() === "low"
  ) {
    throw new ScriptError(
      "low-confidence plans are not filed; record the system in decisions.json instead",
    );
  }
  if (!args.apply) {
    console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
    return;
  }

  const base = {
    fingerprint: meta.fingerprint,
    systems: meta.systems,
    paths: meta.paths,
  };
  let key: string;
  if (action === "create" || action === "recurrence") {
    const created = readResults(config, meta.runId).filter(
      (r) => r.action === "create" || r.action === "recurrence",
    ).length;
    if (created >= config.jira.maxNewTicketsPerRun && !args["over-cap"]) {
      throw new ScriptError(
        `run ${meta.runId} already created ${created} tickets (cap ${config.jira.maxNewTicketsPerRun}); keep the plan file and report it, or pass --over-cap if a human asked for more`,
      );
    }
    key = await create(jira, meta, link, match);
    await jira.setProperty(key, mergeSighting(null, base, sighting));
    await jira.attach(key, file, attachmentName);
    if (match) {
      await jira.request("POST", "/rest/api/3/issueLink", {
        type: { name: "Relates" },
        inwardIssue: { key },
        outwardIssue: { key: match.key },
      });
    }
  } else {
    key = match!.key;
    const existing = await currentProperty(jira, key, config.jira.propertyKey);
    if (action === "sighting-comment") {
      await jira.comment(
        key,
        sightingComment(meta, link, attachmentName, match!),
      );
      await jira.attach(key, file, attachmentName);
    } else if (
      action === "declined-sighting" &&
      shouldNudgeDeclined(existing, config.jira.sightingCooldownDays * 4)
    ) {
      await jira.comment(key, declinedComment(meta, link));
    }
    if (
      !match!.attachments.some((a) => a.startsWith(path.basename(file, ".md")))
    ) {
      await jira.attach(key, file, attachmentName);
    }
    await jira.setProperty(key, mergeSighting(existing, base, sighting));
  }

  writePlan(file, { ...meta, jira: key }, body);
  const result = {
    ...plan,
    key,
    url: jira.browseUrl(key),
    plan: rel(file),
    at: new Date().toISOString(),
  };
  appendResult(config, meta.runId, result);
  console.log(JSON.stringify(result, null, 2));
});

function assertFinished(meta: PlanMeta, body: string, file: string): void {
  const problems: string[] = [];
  if (body.includes(TODO) || meta.summary.includes(TODO))
    problems.push(`unfilled ${TODO} markers`);
  if (!["high", "medium", "low"].includes(meta.confidence.toLowerCase()))
    problems.push("confidence must be high, medium, or low");
  if (meta.systems.length === 0) problems.push("no systems listed");
  if (problems.length)
    throw new ScriptError(`${rel(file)} is not ready: ${problems.join("; ")}`);
}

function decide(
  match: Finding | null,
  cooldownDays: number,
  force: boolean,
): Action {
  if (!match) return "create";
  if (!isOpen(match))
    return isDeclined(match) ? "declined-sighting" : "recurrence";
  const last = match.sightings.at(-1)?.date;
  const stale =
    !last || Date.now() - Date.parse(last) >= cooldownDays * 86_400_000;
  return force || stale ? "sighting-comment" : "sighting-silent";
}

function shouldNudgeDeclined(
  existing: FindingProperty | null,
  days: number,
): boolean {
  const last = existing?.lastSeen;
  return !last || Date.now() - Date.parse(last) >= days * 86_400_000;
}

async function currentProperty(
  jira: Jira,
  key: string,
  propertyKey: string,
): Promise<FindingProperty | null> {
  const res = await jira.request<{ value: FindingProperty }>(
    "GET",
    `/rest/api/3/issue/${key}/properties/${propertyKey}`,
    undefined,
    { allow404: true },
  );
  return res?.value ?? null;
}

async function create(
  jira: Jira,
  meta: PlanMeta,
  link: string | null,
  previous: Finding | null,
): Promise<string> {
  const { projectKey, issueType, label, podField, podValue } = jira.config.jira;
  const summary = `[${meta.area}] Refactor: ${meta.title}`.slice(0, 250);
  const facts: AdfNode[][] = [
    [
      adf.text(
        `Verdict: ${meta.verdict}, confidence ${meta.confidence}, score ${meta.score ?? "n/a"}.`,
      ),
    ],
    [
      adf.text(
        `Signal: ${meta.windowCommits ?? "?"} commits in the review window, ${meta.lookbackFixes ?? "?"} fixes in the lookback.`,
      ),
    ],
    [adf.text("Systems: "), adf.code(meta.systems.join(", "))],
    link
      ? [adf.text("Analysis run: "), adf.text(link, link)]
      : [adf.text("Analysis run: local run, no shareable link")],
    [adf.text(`Full plan attached: ${meta.runId}.`)],
    [adf.text("Fingerprint: "), adf.code(meta.fingerprint)],
  ];
  if (previous)
    facts.unshift([
      adf.text("Recurrence of "),
      adf.text(previous.key, previous.url),
      adf.text(
        `, which was resolved as ${previous.resolution ?? previous.status}.`,
      ),
    ]);
  const res = await jira.request<{ key: string }>("POST", "/rest/api/3/issue", {
    fields: {
      project: { key: projectKey },
      issuetype: { name: issueType },
      summary,
      labels: [label],
      [podField]: [{ value: podValue }],
      description: adf.doc(
        adf.p(adf.text(meta.summary)),
        adf.bullets(...facts),
      ),
    },
  });
  if (!res?.key) throw new ScriptError("Jira create returned no issue key");
  return res.key;
}

function sightingComment(
  meta: PlanMeta,
  link: string | null,
  attachment: string,
  match: Finding,
): AdfNode {
  const first = match.sightings[0];
  return adf.doc(
    adf.p(
      adf.text(
        `Seen again in fragility run ${meta.runId}: ${meta.verdict}, score ${meta.score ?? "n/a"}, ${meta.windowCommits ?? "?"} window commits, ${meta.lookbackFixes ?? "?"} lookback fixes.`,
      ),
    ),
    adf.p(
      adf.text(
        `${match.sightings.length + 1} sightings${first ? ` since ${first.date}` : ""}. Updated plan attached as ${attachment}. `,
      ),
      ...(link ? [adf.text("Run", link)] : []),
    ),
  );
}

function declinedComment(meta: PlanMeta, link: string | null): AdfNode {
  return adf.doc(
    adf.p(
      adf.text(
        `This area still scores as ${meta.verdict} (score ${meta.score ?? "n/a"}) in run ${meta.runId}. No new ticket was opened because this one was declined. `,
      ),
      ...(link ? [adf.text("Run", link)] : []),
    ),
  );
}

function readResults(
  config: ReturnType<typeof loadConfig>,
  id: string,
): { action: Action }[] {
  const file = path.join(runDir(config, id), "jira-results.json");
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { action: Action }[])
    : [];
}

function appendResult(
  config: ReturnType<typeof loadConfig>,
  id: string,
  result: { action: Action },
): void {
  const file = path.join(runDir(config, id), "jira-results.json");
  writeFileSync(
    file,
    `${JSON.stringify([...readResults(config, id), result], null, 2)}\n`,
  );
}
