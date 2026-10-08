import { existsSync, readFileSync, writeFileSync } from "node:fs";
// Records that an already-ticketed system showed up hot again, without writing
// a new plan. This is the cheap path for nightly overlap: the ticket keeps a
// sightings history in its issue property, and gets a comment at most once per
// cooldown so watchers see recurrence without nightly noise.
import path from "node:path";

import type { Analysis } from "./analyze.ts";
import { adf, isDeclined, Jira, mergeSighting, runLink } from "./jira.ts";
import {
  argString,
  loadConfig,
  main,
  readJson,
  runDir,
  runId,
  ScriptError,
} from "./lib.ts";

main(async (args) => {
  const key = argString(args, "key");
  const system = argString(args, "system");
  if (args.help || !key || !system) {
    console.log(
      "jira-sighting --run <id> --key ENG-123 --system <hot system> [--apply]",
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const id = runId(args);
  const analysis = readJson<Analysis>(
    path.join(runDir(config, id), "analysis.json"),
  );
  const report = analysis.hotSystems.find((r) => r.system === system);
  if (!report)
    throw new ScriptError(`${system} is not a hot system in run ${id}`);

  const jira = new Jira(config);
  const finding = (await jira.findings()).find((f) => f.key === key);
  if (!finding)
    throw new ScriptError(`${key} is not a ${config.jira.label} ticket`);

  const today = new Date().toISOString().slice(0, 10);
  const last = finding.sightings.at(-1)?.date;
  const alreadyToday = finding.sightings.some((s) => s.runId === id);
  const cooldown =
    (isDeclined(finding) ? 4 : 1) * config.jira.sightingCooldownDays;
  const comment =
    !alreadyToday &&
    (!last || Date.now() - Date.parse(last) >= cooldown * 86_400_000);
  const summary = `${report.verdict}, score ${report.score}, ${report.window.commits} window commits, ${report.lookback.fixes} lookback fixes; weekly fixes ${report.lookback.weekly.map((w) => w.fixes).join(" → ")}`;

  if (!args.apply) {
    console.log(
      JSON.stringify({ dryRun: true, key, system, comment, summary }, null, 2),
    );
    return;
  }
  if (comment) {
    const link = runLink().url;
    await jira.comment(
      key,
      adf.doc(
        adf.p(
          adf.text(
            `Seen again in fragility run ${id} (${system}): ${summary}. `,
          ),
          ...(link ? [adf.text("Run", link)] : []),
        ),
      ),
    );
  }
  const existing = await jira.request<{
    value: Parameters<typeof mergeSighting>[0];
  }>(
    "GET",
    `/rest/api/3/issue/${key}/properties/${config.jira.propertyKey}`,
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
        paths: report.topFiles.map((f) => f.path),
      },
      {
        runId: id,
        date: today,
        score: report.score,
        verdict: report.verdict,
        windowCommits: report.window.commits,
        lookbackFixes: report.lookback.fixes,
      },
    ),
  );
  const resultsFile = path.join(runDir(config, id), "jira-results.json");
  const results = existsSync(resultsFile)
    ? (JSON.parse(readFileSync(resultsFile, "utf8")) as object[])
    : [];
  const result = {
    action: comment ? "sighting-comment" : "sighting-silent",
    key,
    url: jira.browseUrl(key),
    system,
    at: new Date().toISOString(),
  };
  writeFileSync(
    resultsFile,
    `${JSON.stringify([...results, result], null, 2)}\n`,
  );
  console.log(JSON.stringify({ ...result, summary }, null, 2));
});
