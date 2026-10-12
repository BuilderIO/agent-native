// Records that an already-ticketed system showed up again, without writing a
// new plan. The ticket keeps a sightings history in its issue property and
// gets a comment at most once per cooldown, so watchers see recurrence without
// nightly noise. A sighting with --source (a bug report traced to the ticket)
// always comments once, because a real bug is new evidence.
import {
  appendJiraResult,
  readTargets,
} from "../../fragility-common/lib/artifacts.ts";
import {
  argString,
  main,
  runId,
  ScriptError,
} from "../../fragility-common/lib/cli.ts";
import {
  adf,
  isDeclined,
  isOpen,
  Jira,
  mergeSighting,
  runLink,
  runMarker,
} from "./jira.ts";

main(async (args) => {
  const key = argString(args, "key");
  const system = argString(args, "system");
  if (args.help || !key || !system) {
    console.log(
      'jira-sighting --run <id> --key ENG-123 --system <system in targets.json> [--source <bug url or ref> --source-title "<title>"] [--note "<how this run relates>"] [--apply]\n  With --source, --note is required and the ticket always gets one comment linking the bug.',
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
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

  const jira = new Jira();
  const config = jira.config;
  const finding = (await jira.findings()).find((f) => f.key === key);
  if (!finding) throw new ScriptError(`${key} is not a ${config.label} ticket`);

  if (!isOpen(finding) && !isDeclined(finding)) {
    throw new ScriptError(
      `${key} was resolved (${finding.resolution ?? finding.status}); a hot system after a fix is a recurrence. Write a plan and run jira-upsert, which opens a linked recurrence ticket.`,
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const last = finding.sightings.at(-1)?.date;
  const alreadyToday =
    finding.sightings.some((s) => s.runId === id) ||
    (await jira.hasRunComment(key, id));
  const cooldown = (isDeclined(finding) ? 4 : 1) * config.sightingCooldownDays;
  const comment =
    !alreadyToday &&
    (Boolean(source) ||
      !last ||
      Date.now() - Date.parse(last) >= cooldown * 86_400_000);
  const summary = `${target.verdict}, score ${target.score}, ${target.windowCommits ?? "n/a"} window commits, ${target.lookbackFixes} lookback fixes; weekly fixes ${target.weeklyFixes.join(" → ")}`;

  if (!args.apply) {
    console.log(
      JSON.stringify({ dryRun: true, key, system, comment, summary }, null, 2),
    );
    return;
  }
  if (comment) {
    const link = runLink().url;
    const lead = source
      ? [
          adf.text("Bug report "),
          /^https?:\/\//.test(source)
            ? adf.text(sourceTitle ?? source, source)
            : adf.text(sourceTitle ? `${sourceTitle} (${source})` : source),
          adf.text(` traced to this pattern in ${runMarker(id)} (${system}). `),
        ]
      : [adf.text(`Seen again in ${runMarker(id)} (${system}): ${summary}. `)];
    await jira.comment(
      key,
      adf.doc(
        adf.p(
          ...lead,
          ...(note ? [adf.text(`${note} `)] : []),
          ...(link ? [adf.text("Run", link)] : []),
        ),
      ),
    );
  }
  const existing = await jira.request<{
    value: Parameters<typeof mergeSighting>[0];
  }>(
    "GET",
    `/rest/api/3/issue/${key}/properties/${config.propertyKey}`,
    undefined,
    { allow404: true },
  );
  await jira.setProperty(
    key,
    mergeSighting(
      existing?.value ?? null,
      {
        fingerprint: finding.fingerprint ?? `fsys:${system}:external`,
        systems: [system],
        paths: target.files,
      },
      {
        runId: id,
        date: today,
        score: target.score,
        verdict: target.verdict,
        windowCommits: target.windowCommits,
        lookbackFixes: target.lookbackFixes,
        source,
      },
    ),
  );
  const result = {
    action: comment ? "sighting-comment" : "sighting-silent",
    key,
    url: jira.browseUrl(key),
    system,
    at: new Date().toISOString(),
  };
  appendJiraResult(id, result);
  console.log(JSON.stringify({ ...result, summary }, null, 2));
});
