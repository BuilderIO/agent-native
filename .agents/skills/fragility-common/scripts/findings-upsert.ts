// The only script that writes refactor findings to the configured tracker.
// Two inputs, one path:
//   --plan <file>               a finished plan
//   --key KEY --system <system> a hot system already covered by KEY (no plan)
// Outcomes, idempotent on re-run:
//   no ticket        → create (label, plan, run link)
//   open ticket      → sighting; comment (+ updated plan) at most once per cooldown
//   declined ticket  → sighting; comment at most once per four cooldowns
//   fixed ticket     → plan: create a linked recurrence ticket; system: refuse
// A sighting with a bug source always comments once per run: a real bug traced
// to the pattern is new evidence, not nightly noise. Dry-run unless --apply.
import path from "node:path";

import {
  appendFindingResult,
  type FindingResult,
  readFindingResults,
  readTargets,
} from "../lib/artifacts.ts";
import {
  type Args,
  argList,
  argString,
  main,
  rel,
  runId,
  ScriptError,
} from "../lib/cli.ts";
import {
  code,
  commentDue,
  type Finding,
  type Inline,
  loadTracker,
  mergeSighting,
  overlap,
  type Paragraph,
  planNamePattern,
  runLink,
  runMarker,
  type Sighting,
  text,
  type Tracker,
} from "../lib/findings.ts";
import {
  type PlanMeta,
  readPlan,
  TODO,
  writePlan,
} from "../lib/plan-format.ts";

const USAGE = `findings-upsert --plan <file> [--key KEY | --distinct-from KEY,KEY] [--apply] [--run-url <url> | --no-run-url] [--force-comment] [--over-cap]
findings-upsert --run <id> --key KEY --system <system in targets.json> [--source <bug url or ref> --source-title "<title>" --note "<how>"] [--apply]
  KEY is ENG-123 for Jira, or an issue number or URL for GitHub.
  Plan mode matches by fingerprint, then by overlap (fingerprint anchor, same or nested system, shared files).
  Overlapping tickets must be judged: --key if the plan is that ticket, --distinct-from if it is a different root problem.`;

interface Subject {
  runId: string;
  sighting: Sighting;
  base: { fingerprint: string; systems: string[]; paths: string[] };
  /** One line for the comment: what this run saw. */
  lead: Inline[];
  bugSource: string | null;
}

main(async (args) => {
  const planFile = argString(args, "plan");
  const rawKey = argString(args, "key");
  const system = argString(args, "system");
  if (args.help || (!planFile && !(rawKey && system))) {
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
  const tracker = (await loadTracker()).createTracker();
  const key = rawKey ? tracker.parseKey(rawKey) : undefined;
  const findings = await tracker.findings();
  if (planFile) await upsertPlan(tracker, findings, args, planFile, key, link);
  else await sightSystem(tracker, findings, args, key!, system!, link);
});

async function upsertPlan(
  tracker: Tracker,
  findings: Finding[],
  args: Args,
  planFile: string,
  key: string | undefined,
  link: string | null,
): Promise<void> {
  const file = path.resolve(planFile);
  const { meta, body } = readPlan(file);
  assertFinished(meta, body, file);
  const match = matchPlan(
    tracker,
    meta,
    findings,
    key,
    argList(args, "distinct-from").map((k) => tracker.parseKey(k)),
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
    match.open &&
    readFindingResults(meta.runId).some(
      (r) =>
        r.key === match.key &&
        r.plan === rel(file) &&
        (r.action === "create" || r.action === "recurrence"),
    );
  const recurrence =
    !resuming && match !== null && !match.open && !match.declined;
  const action = resuming
    ? "resume-create"
    : match && !recurrence
      ? "sighting"
      : recurrence
        ? "recurrence"
        : "create";
  const planName = `${path.basename(file, ".md")}-${meta.runId}.md`;

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
          tracker: tracker.name,
          action,
          key: match?.key ?? null,
          fingerprint: meta.fingerprint,
          planName,
          runLink: link,
        },
        null,
        2,
      ),
    );
    return;
  }

  const planVersions = (match?.plans ?? []).filter((a) =>
    planNamePattern(path.basename(file, ".md")).test(a),
  );
  const resultFor = (action: string, key: string): FindingResult => ({
    action,
    key,
    url: tracker.ticketUrl(key),
    plan: rel(file),
    system: meta.systems[0],
    source: subject.bugSource,
    at: new Date().toISOString(),
  });

  let result: FindingResult;
  if (action === "sighting") {
    const key = match!.key;
    const { commented, commentedThisRun } = await recordSighting(
      tracker,
      match!,
      subject,
      link,
      Boolean(args["force-comment"]),
    );
    // Reconciled on every run, so a failed upload after a comment is retried.
    const wantsThisRunsPlan = commentedThisRun
      ? !planVersions.includes(planName)
      : planVersions.length === 0;
    if (wantsThisRunsPlan) await tracker.attachPlan(key, file, planName);
    result = resultFor(commented ? "sighting-comment" : "sighting-silent", key);
    appendFindingResult(meta.runId, result);
  } else {
    let key: string;
    let recurrenceOf: string | undefined;
    if (action === "resume-create") {
      key = match!.key;
      recurrenceOf = match!.recurrenceOf ?? undefined;
      result = resultFor(action, key);
    } else {
      const created = readFindingResults(meta.runId).filter(
        (r) => r.action === "create" || r.action === "recurrence",
      ).length;
      if (created >= tracker.maxNewTicketsPerRun && !args["over-cap"]) {
        throw new ScriptError(
          `run ${meta.runId} already created ${created} tickets (cap ${tracker.maxNewTicketsPerRun}); keep the plan file and report it, or pass --over-cap if a human asked for more`,
        );
      }
      const previous = recurrence ? match : null;
      key = await tracker.create({
        meta,
        facts: createFacts(meta, link, previous),
        previous,
        planFile: file,
        planName,
      });
      recurrenceOf = previous?.key;
      // Recorded before the fallible follow-ups, so the cap counts it and a
      // re-run resumes this ticket instead of treating it as a sighting.
      result = resultFor(action, key);
      appendFindingResult(meta.runId, result);
    }
    if (!(await tracker.currentProperty(key))) {
      await tracker.setProperty(
        key,
        mergeSighting(null, subject.base, subject.sighting, {
          commentedOn: subject.sighting.date,
          recurrenceOf,
        }),
      );
    }
    if (!planVersions.includes(planName))
      await tracker.attachPlan(key, file, planName);
    if (recurrenceOf) await tracker.ensureRecurrenceLink(key, recurrenceOf);
  }

  writePlan(file, { ...meta, ticket: result.key }, body);
  console.log(JSON.stringify(result, null, 2));
}

async function sightSystem(
  tracker: Tracker,
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
    throw new ScriptError(
      `${key} is not a ${tracker.label} ticket in ${tracker.name}`,
    );
  if (!finding.open && !finding.declined) {
    throw new ScriptError(
      `${key} was resolved (${finding.resolution ?? finding.status}); a hot system after a fix is a recurrence. Write a plan and upsert it, which opens a linked recurrence ticket.`,
    );
  }
  const summary = `${target.verdict}, score ${target.score}, ${target.windowCommits ?? "n/a"} window commits, ${target.lookbackFixes} lookback fixes; weekly fixes ${target.weeklyFixes.join(" → ")}`;
  const lead: Inline[] = source
    ? [
        text("Bug report "),
        /^https?:\/\//.test(source)
          ? text(sourceTitle ?? source, source)
          : text(sourceTitle ? `${sourceTitle} (${source})` : source),
        text(` traced to this pattern in ${runMarker(id)} (${system}). `),
        text(`${note} `),
      ]
    : [text(`Seen again in ${runMarker(id)} (${system}): ${summary}. `)];
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
      Boolean(source) || commentDue(finding, tracker.sightingCooldownDays);
    console.log(
      JSON.stringify(
        { dryRun: true, tracker: tracker.name, key, system, comment, summary },
        null,
        2,
      ),
    );
    return;
  }
  const { commented } = await recordSighting(
    tracker,
    finding,
    subject,
    link,
    false,
  );
  const result: FindingResult = {
    action: commented ? "sighting-comment" : "sighting-silent",
    key,
    url: tracker.ticketUrl(key),
    system,
    source,
    at: new Date().toISOString(),
  };
  appendFindingResult(id, result);
  console.log(JSON.stringify({ ...result, summary }, null, 2));
}

// Each write checks what a previous partial run already did, so a re-run
// after a failure finishes the job instead of repeating it.
async function recordSighting(
  tracker: Tracker,
  finding: Finding,
  subject: Subject,
  link: string | null,
  force: boolean,
): Promise<{ commented: boolean; commentedThisRun: boolean }> {
  const existing = await tracker.currentProperty(finding.key);
  const alreadyCommented = await tracker.hasRunComment(
    finding.key,
    subject.runId,
  );
  const due =
    force ||
    Boolean(subject.bugSource) ||
    commentDue(finding, tracker.sightingCooldownDays);
  const comment = due && !alreadyCommented;
  if (comment)
    await tracker.comment(finding.key, sightingComment(finding, subject, link));
  // A run's comment counts from the day the run first sighted the ticket, so a
  // replay never pushes lastCommented later, and a retry after a failed
  // property write still records the comment it posted.
  const runDate =
    existing?.sightings.find((s) => s.runId === subject.runId)?.date ??
    subject.sighting.date;
  const stamped = (existing?.lastCommented ?? "") >= runDate;
  await tracker.setProperty(
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
    await tracker.ensureRecurrenceLink(finding.key, finding.recurrenceOf);
  return { commented: comment, commentedThisRun: comment || alreadyCommented };
}

function matchPlan(
  tracker: Tracker,
  meta: PlanMeta,
  findings: Finding[],
  key: string | undefined,
  distinctFrom: string[],
): Finding | null {
  if (key) {
    const chosen = findings.find((f) => f.key === key);
    if (!chosen)
      throw new ScriptError(
        `--key ${key} is not a ${tracker.label} ticket in ${tracker.name}`,
      );
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

function planLead(meta: PlanMeta): Inline[] {
  return meta.trigger === "bug"
    ? [
        text("Bug report "),
        sourceText(meta.source),
        text(
          ` traced to this pattern in ${runMarker(meta.runId)}: ${meta.summary} `,
        ),
      ]
    : [
        text(
          `Seen again in ${runMarker(meta.runId)}: ${meta.verdict}, score ${meta.score ?? "n/a"}, ${meta.windowCommits ?? "?"} window commits, ${meta.lookbackFixes ?? "?"} lookback fixes. Updated plan attached. `,
        ),
      ];
}

function sightingComment(
  finding: Finding,
  subject: Subject,
  link: string | null,
): Paragraph[] {
  const since = finding.firstSeen ?? finding.sightings[0]?.date;
  const declined = finding.declined
    ? [
        text(
          "This ticket was declined, so no new ticket was opened; consider reopening. ",
        ),
      ]
    : [];
  return [
    [...subject.lead, ...declined],
    [
      text(
        `${finding.sightingCount + 1} sightings${since ? ` since ${since}` : ""}. `,
      ),
      ...(link ? [text("Run", link)] : []),
    ],
  ];
}

function sourceText(source: string | null): Inline {
  if (!source) return text("unlinked report");
  return /^https?:\/\//.test(source) ? text(source, source) : text(source);
}

function createFacts(
  meta: PlanMeta,
  link: string | null,
  previous: Finding | null,
): Paragraph[] {
  const facts: Paragraph[] = [
    [
      text(
        `Verdict: ${meta.verdict}, confidence ${meta.confidence}, score ${meta.score ?? "n/a"}.`,
      ),
    ],
    meta.trigger === "bug"
      ? [
          text("Triggered by bug report: "),
          sourceText(meta.source),
          text(
            `. ${meta.lookbackFixes ?? "?"} fixes in the lookback on these systems.`,
          ),
        ]
      : [
          text(
            `Signal: ${meta.windowCommits ?? "?"} commits in the review window, ${meta.lookbackFixes ?? "?"} fixes in the lookback.`,
          ),
        ],
    [text("Systems: "), code(meta.systems.join(", "))],
    link
      ? [text("Analysis run: "), text(link, link)]
      : [text("Analysis run: local run, no shareable link")],
    [text("Fingerprint: "), code(meta.fingerprint)],
  ];
  if (previous)
    facts.unshift([
      text("Recurrence of "),
      text(previous.key, previous.url),
      text(
        `, which was resolved as ${previous.resolution ?? previous.status}.`,
      ),
    ]);
  return facts;
}
