import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runAbReadout,
  formatAbMarkdown,
  parseAbReadoutArgs,
} from "../templates/analytics/scripts/radar/ab.ts";
import {
  formatRadarBacktest,
  parseRadarBacktestArgs,
  runRadarBacktest,
} from "../templates/analytics/scripts/radar/backtest.ts";
import { liveDatabaseUrlFromEnv } from "../templates/analytics/scripts/radar/live.ts";
import {
  REPO_ROOT,
  RadarQueryError,
  closeRadarQueries,
  radarRunCliExitCode,
} from "../templates/analytics/scripts/radar/query.ts";
import {
  buildWeeklyReport,
  formatWeeklyMarkdown,
  parseReportArgs,
  writeWeeklyReport,
} from "../templates/analytics/scripts/radar/report.ts";
import {
  parseWatchArgs,
  runWatch,
  writeWatchRun,
} from "../templates/analytics/scripts/radar/watch.ts";

function loadLiveDatabaseUrl(): void {
  const configuredFile = process.env.ANALYTICS_RADAR_ENV_FILE;
  const envFile = path.resolve(
    REPO_ROOT,
    configuredFile ?? "templates/analytics/.env",
  );
  let contents: string;
  try {
    contents = fs.readFileSync(envFile, "utf8");
  } catch {
    throw new RadarQueryError(
      "Live radar environment file could not be read.",
      2,
    );
  }
  process.env.ANALYTICS_RADAR_DATABASE_URL = liveDatabaseUrlFromEnv(contents);
  process.env.ANALYTICS_ENV = envFile;
}

async function main(): Promise<void> {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (!command || !["watch", "report", "ab", "backtest"].includes(command)) {
      throw new RadarQueryError(
        "Usage: radar:live-watch [watch options], radar:live-report [report options], radar:live-ab [A/B options], or radar:backtest [--max-total-gb N].",
        2,
      );
    }
    loadLiveDatabaseUrl();

    if (command === "watch") {
      const run = await runWatch(parseWatchArgs(args));
      const paths = await writeWatchRun(run);
      console.log(JSON.stringify({ ...paths, exitCode: run.exitCode }));
      process.exitCode = run.exitCode;
    } else if (command === "report") {
      const { week, skipJourneySnapshot, maxTotalGb, freshBigQuery } =
        parseReportArgs(args);
      if (!week) {
        throw new RadarQueryError(
          "Usage: radar:live-report --week YYYY-MM-DD [--max-total-gb N]",
          2,
        );
      }
      const report = await buildWeeklyReport(week, {
        skipJourneySnapshot,
        maxTotalGb,
        freshBigQuery,
      });
      const paths = await writeWeeklyReport(report);
      console.log(formatWeeklyMarkdown(report));
      console.log(JSON.stringify({ ...paths, exitCode: report.exitCode }));
      process.exitCode = report.exitCode;
    } else if (command === "ab") {
      const result = await runAbReadout(parseAbReadoutArgs(args));
      console.log(formatAbMarkdown(result));
      console.log(JSON.stringify(result));
    } else {
      const result = await runRadarBacktest(parseRadarBacktestArgs(args));
      console.log(formatRadarBacktest(result));
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Live radar could not run.",
    );
    process.exitCode = radarRunCliExitCode(error);
  } finally {
    await closeRadarQueries();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
