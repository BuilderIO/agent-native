// The only script that writes refactor findings to Jira. Two inputs, one path:
//   --plan <file>               a finished plan
//   --key KEY --system <system> a hot system already covered by KEY (no plan)
// Outcomes, idempotent on re-run:
//   no ticket        → create (Pod, label, plan attached, run link)
//   open ticket      → sighting; comment (+ updated plan) at most once per cooldown
//   declined ticket  → sighting; comment at most once per four cooldowns
//   fixed ticket     → plan: create a linked recurrence ticket; system: refuse
// A sighting with a bug source always comments once per run: a real bug traced
// to the pattern is new evidence, not nightly noise. Dry-run unless --apply.
import path from "node:path";

import {
  appendJiraResult,
  type JiraResult,
  readJiraResults,
  readTargets,
} from "../../fragility-common/lib/artifacts.ts";
import {
  type Args,
  argList,
  argString,
  main,
  rel,
  runId,
  ScriptError,
} from "../../fragility-common/lib/cli.ts";
import {
  type PlanMeta,
  readPlan,
  TODO,
  writePlan,
} from "../../fragility-common/lib/plan-format.ts";
import {
  adf,
  type AdfNode,
  commentDue,
  type Finding,
  isDeclined,
  isOpen,
  Jira,
  mergeSighting,
  overlap,
  planAttachmentPattern,
  runLink,
  runMarker,
  type Sighting,
} from "./jira.ts";

const USAGE = `jira-upsert --plan <file> [--key ENG-123 | --distinct-from ENG-1,ENG-2] [--apply] [--run-url <url> | --no-run-url] [--force-comment] [--over-cap]
jira-upsert --run <id> --key ENG-123 --system <system in targets.json> [--source <bug url or ref> --source-title "<title>" --note "<how>"] [--apply]
  Plan mode matches by fingerprint, then by overlap (fingerprint anchor, same or nested system, shared files).
  Overlapping tickets must be judged: --key if the plan is that ticket, --distinct-from if it is a different root problem.`;

interface Subject {
  runId: string;
  sighting: Sighting;
  base: { fingerprint: string; systems: string[]; paths: string[] };
  /** One line for the comment: what this run saw. */
  lead: AdfNode[];
  bugSource: string | null;
}

main(async (args) => {
  const planFile = argString(args, "plan");
  const key = argString(args, "key");
  const system = argString(args, "system");
  if (args.help || (!planFile && !(key && system))) {
    console.log(USAGE);
    if (!args.help) process.exitCode = 1;
    return;
  }
  const link = argString(args, "run-url") ?? runLink().url;
  if (!link && !args["no-run-url"]) {
    throw new ScriptError(
      "no run link: set FRAGILITY_RUN_URL or pass --run-url; pass --no-run-url only for local runs with no shareable link",
      2,
    );
  }
  const jira = new Jira();
  const findings = await jira.findings();
  if (planFile) await upsertPlan(jira, findings, args, planFile, link);
  else await sightSystem(jira, findings, args, key!, system!, link);
});

async function upsertPlan(
  jira: Jira,
  findings: Finding[],
  args: Args,
  planFile: string,
  link: string | null,
): Promise<void> {
  const config = jira.config;
  const file = path.resolve(planFile);
  const { meta, body } = readPlan(file);
  assertFinished(meta, body, file);
  const match = matchPlan(
    meta,
    findings,
    argString(args, "key"),
    argList(args, "distinct-from"),
  );
  const subject: Subject = {
    runId: meta.runId,
    sighting: sightingFrom(meta),
    base: {
      fingerprint: meta.fingerprint,
      systems: meta.systems,
      paths: meta.paths,
    },
    lead: planLead(meta),
    bugSource: meta.trigger === "bug" ? meta.source : null,
  };
  // A ticket this run already created (then failed partway) is finished, not
  // sighted; once that ticket is resolved, the plan is a recurrence instead.
  const resuming =
    match !== null &&
    isOpen(match) &&
    readJiraResults(meta.runId).some(
      (r) =>
        r.key === match.key &&
        r.plan === rel(file) &&
        (r.action === "create" || r.action === "recurrence"),
    );
  const recurrence =
    !resuming && match !== null && !isOpen(match) && !isDeclined(match);
  const action = resuming
    ? "resume-create"
    : match && !recurrence
      ? "sighting"
      : recurrence
        ? "recurrence"
        : "create";
  const attachmentName = `${path.basename(file, ".md")}-${meta.runId}.md`;

  const creating = action === "create" || action === "recurrence";
  if (creating && meta.confidence.toLowerCase() === "low") {
    throw new ScriptError(
      "low-confidence plans are not filed; record the system in decisions.json instead",
    );
  }
  if (!args.apply) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          action,
          key: match?.key ?? null,
          fingerprint: meta.fingerprint,
          attachmentName,
          runLink: link,
        },
        null,
        2,
      ),
    );
    return;
  }

  const planAttachments = (match?.attachments ?? []).filter((a) =>
    planAttachmentPattern(path.basename(file, ".md")).test(a),
  );
  const resultFor = (action: string, key: string): JiraResult => ({
    action,
    key,
    url: jira.browseUrl(key),
    plan: rel(file),
    system: meta.systems[0],
    source: subject.bugSource,
    at: new Date().toISOString(),
  });

  let result: JiraResult;
  if (action === "sighting") {
    const key = match!.key;
    const { commented, commentedThisRun } = await recordSighting(
      jira,
      match!,
      subject,
      link,
      Boolean(args["force-comment"]),
    );
    // Reconciled on every run, so a failed upload after a comment is retried.
    const wantsThisRunsPlan = commentedThisRun
      ? !planAttachments.includes(attachmentName)
      : planAttachments.length === 0;
    if (wantsThisRunsPlan) await jira.attach(key, file, attachmentName);
    result = resultFor(commented ? "sighting-comment" : "sighting-silent", key);
    appendJiraResult(meta.runId, result);
  } else {
    let key: string;
    let recurrenceOf: string | undefined;
    if (action === "resume-create") {
      key = match!.key;
      recurrenceOf = match!.recurrenceOf ?? undefined;
      result = resultFor(action, key);
    } else {
      const created = readJiraResults(meta.runId).filter(
        (r) => r.action === "create" || r.action === "recurrence",
      ).length;
      if (created >= config.maxNewTicketsPerRun && !args["over-cap"]) {
        throw new ScriptError(
          `run ${meta.runId} already created ${created} tickets (cap ${config.maxNewTicketsPerRun}); keep the plan file and report it, or pass --over-cap if a human asked for more`,
        );
      }
      key = await create(jira, meta, link, recurrence ? match : null);
      recurrenceOf = recurrence ? match!.key : undefined;
      // Recorded before the fallible follow-ups, so the cap counts it and a
      // re-run resumes this ticket instead of treating it as a sighting.
      result = resultFor(action, key);
      appendJiraResult(meta.runId, result);
    }
    if (!(await jira.currentProperty(key))) {
      await jira.setProperty(
        key,
        mergeSighting(null, subject.base, subject.sighting, {
          commentedOn: subject.sighting.date,
          recurrenceOf,
        }),
      );
    }
    if (!planAttachments.includes(attachmentName))
      await jira.attach(key, file, attachmentName);
    if (recurrenceOf) await jira.ensureRecurrenceLink(key, recurrenceOf);
  }

  writePlan(file, { ...meta, jira: result.key }, body);
  console.log(JSON.stringify(result, null, 2));
}

async function sightSystem(
  jira: Jira,
  findings: Finding[],
  args: Args,
  key: string,
  system: string,
  link: string | null,
): Promise<void> {
  const id = runId(args);
  const note = argString(args, "note");
  const source = argString(args, "source") ?? null;
  const sourceTitle = argString(args, "source-title") ?? null;
  if (source && !note) {
    throw new ScriptError(
      "--source needs --note with one sentence on how this bug is an instance of the ticket's pattern",
    );
  }
  const target = readTargets(id).find((t) => t.system === system);
  if (!target)
    throw new ScriptError(`${system} is not in run ${id}'s targets.json`);
  const finding = findings.find((f) => f.key === key);
  if (!finding)
    throw new ScriptError(`${key} is not a ${jira.config.label} ticket`);
  if (!isOpen(finding) && !isDeclined(finding)) {
    throw new ScriptError(
      `${key} was resolved (${finding.resolution ?? finding.status}); a hot system after a fix is a recurrence. Write a plan and upsert it, which opens a linked recurrence ticket.`,
    );
  }
  const summary = `${target.verdict}, score ${target.score}, ${target.windowCommits ?? "n/a"} window commits, ${target.lookbackFixes} lookback fixes; weekly fixes ${target.weeklyFixes.join(" → ")}`;
  const lead: AdfNode[] = source
    ? [
        adf.text("Bug report "),
        /^https?:\/\//.test(source)
          ? adf.text(sourceTitle ?? source, source)
          : adf.text(sourceTitle ? `${sourceTitle} (${source})` : source),
        adf.text(` traced to this pattern in ${runMarker(id)} (${system}). `),
        adf.text(`${note} `),
      ]
    : [adf.text(`Seen again in ${runMarker(id)} (${system}): ${summary}. `)];
  const subject: Subject = {
    runId: id,
    sighting: {
      runId: id,
      date: today(),
      score: target.score,
      verdict: target.verdict,
      windowCommits: target.windowCommits,
      lookbackFixes: target.lookbackFixes,
      source,
    },
    base: {
      fingerprint: finding.fingerprint ?? `fsys:${system}:external`,
      systems: [system],
      paths: target.files,
    },
    lead,
    bugSource: source,
  };
  if (!args.apply) {
    const comment =
      Boolean(source) || commentDue(finding, jira.config.sightingCooldownDays);
    console.log(
      JSON.stringify({ dryRun: true, key, system, comment, summary }, null, 2),
    );
    return;
  }
  const { commented } = await recordSighting(
    jira,
    finding,
    subject,
    link,
    false,
  );
  const result: JiraResult = {
    action: commented ? "sighting-comment" : "sighting-silent",
    key,
    url: jira.browseUrl(key),
    system,
    source,
    at: new Date().toISOString(),
  };
  appendJiraResult(id, result);
  console.log(JSON.stringify({ ...result, summary }, null, 2));
}

// Each write checks what a previous partial run already did, so a re-run
// after a failure finishes the job instead of repeating it.
async function recordSighting(
  jira: Jira,
  finding: Finding,
  subject: Subject,
  link: string | null,
  force: boolean,
): Promise<{ commented: boolean; commentedThisRun: boolean }> {
  const existing = await jira.currentProperty(finding.key);
  const alreadyCommented = await jira.hasRunComment(finding.key, subject.runId);
  const due =
    force ||
    Boolean(subject.bugSource) ||
    commentDue(finding, jira.config.sightingCooldownDays);
  const comment = due && !alreadyCommented;
  if (comment)
    await jira.comment(finding.key, sightingComment(finding, subject, link));
  // A run's comment counts from the day the run first sighted the ticket, so a
  // replay never pushes lastCommented later, and a retry after a failed
  // property write still records the comment it posted.
  const runDate =
    existing?.sightings.find((s) => s.runId === subject.runId)?.date ??
    subject.sighting.date;
  const stamped = (existing?.lastCommented ?? "") >= runDate;
  await jira.setProperty(
    finding.key,
    mergeSighting(existing, subject.base, subject.sighting, {
      commentedOn: comment
        ? subject.sighting.date
        : alreadyCommented && !stamped
          ? runDate
          : undefined,
    }),
  );
  if (finding.recurrenceOf)
    await jira.ensureRecurrenceLink(finding.key, finding.recurrenceOf);
  return { commented: comment, commentedThisRun: comment || alreadyCommented };
}

function matchPlan(
  meta: PlanMeta,
  findings: Finding[],
  key: string | undefined,
  distinctFrom: string[],
): Finding | null {
  if (key) {
    const chosen = findings.find((f) => f.key === key);
    if (!chosen)
      throw new ScriptError(`--key ${key} is not a refactor-findings ticket`);
    return chosen;
  }
  const exact = findings.find((f) => f.fingerprint === meta.fingerprint);
  if (exact) return exact;
  const overlapping = findings
    .map((f) => ({
      f,
      why: meta.systems.flatMap((s) => overlap(s, meta.paths, f)),
    }))
    .filter(({ f, why }) => why.length > 0 && !distinctFrom.includes(f.key));
  if (overlapping.length) {
    const list = overlapping
      .map(
        ({ f, why }) =>
          `${f.key} [${f.status}] "${f.summary}" (${[...new Set(why)].join("; ")})`,
      )
      .join("\n  ");
    throw new ScriptError(
      `this plan overlaps existing tickets:\n  ${list}\nPass --key <KEY> if the plan is that ticket's root problem, or --distinct-from ${overlapping.map(({ f }) => f.key).join(",")} if it is a different one.`,
    );
  }
  return null;
}

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function sightingFrom(meta: PlanMeta): Sighting {
  return {
    runId: meta.runId,
    date: today(),
    score: meta.score,
    verdict: meta.verdict,
    windowCommits: meta.windowCommits,
    lookbackFixes: meta.lookbackFixes,
    source: meta.source,
  };
}

function planLead(meta: PlanMeta): AdfNode[] {
  return meta.trigger === "bug"
    ? [
        adf.text("Bug report "),
        sourceText(meta.source),
        adf.text(
          ` traced to this pattern in ${runMarker(meta.runId)}: ${meta.summary} `,
        ),
      ]
    : [
        adf.text(
          `Seen again in ${runMarker(meta.runId)}: ${meta.verdict}, score ${meta.score ?? "n/a"}, ${meta.windowCommits ?? "?"} window commits, ${meta.lookbackFixes ?? "?"} lookback fixes. Updated plan attached. `,
        ),
      ];
}

function sightingComment(
  finding: Finding,
  subject: Subject,
  link: string | null,
): AdfNode {
  const since = finding.firstSeen ?? finding.sightings[0]?.date;
  const declined = isDeclined(finding)
    ? [
        adf.text(
          "This ticket was declined, so no new ticket was opened; consider reopening. ",
        ),
      ]
    : [];
  return adf.doc(
    adf.p(...subject.lead, ...declined),
    adf.p(
      adf.text(
        `${finding.sightingCount + 1} sightings${since ? ` since ${since}` : ""}. `,
      ),
      ...(link ? [adf.text("Run", link)] : []),
    ),
  );
}

function sourceText(source: string | null): AdfNode {
  if (!source) return adf.text("unlinked report");
  return /^https?:\/\//.test(source)
    ? adf.text(source, source)
    : adf.text(source);
}

async function create(
  jira: Jira,
  meta: PlanMeta,
  link: string | null,
  previous: Finding | null,
): Promise<string> {
  const { projectKey, issueType, label, podField, podOptionId } = jira.config;
  const summary = `[${meta.area}] Refactor: ${meta.title}`.slice(0, 250);
  const facts: AdfNode[][] = [
    [
      adf.text(
        `Verdict: ${meta.verdict}, confidence ${meta.confidence}, score ${meta.score ?? "n/a"}.`,
      ),
    ],
    meta.trigger === "bug"
      ? [
          adf.text("Triggered by bug report: "),
          sourceText(meta.source),
          adf.text(
            `. ${meta.lookbackFixes ?? "?"} fixes in the lookback on these systems.`,
          ),
        ]
      : [
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
      [podField]: [{ id: podOptionId }],
      description: adf.doc(
        adf.p(adf.text(meta.summary)),
        adf.bullets(...facts),
      ),
    },
  });
  if (!res?.key) throw new ScriptError("Jira create returned no issue key");
  return res.key;
}
