import fs from "fs";
import path from "path";

import { isKeepWarmDeployEnabled, resolveKeepWarmSchedule } from "./build.js";

export const NETLIFY_WORKSPACE_KEEP_WARM_FUNCTION_NAME =
  "agent-native-workspace-keep-warm";

const DEFAULT_KEEP_WARM_CONCURRENCY = 1;
const MAX_KEEP_WARM_CONCURRENCY = 50;

/**
 * How many server instances keep-warm holds warm per app.
 *
 * A Netlify function instance serves one request at a time, and opening an app
 * sends a burst of parallel framework reads (session, application state, org,
 * agent status, and so on). Every request in that burst that finds no idle
 * instance starts a cold one, so one warm instance barely helps. Warming several
 * instances at once keeps a pool that the first burst can land on.
 */
export function resolveKeepWarmConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.AGENT_NATIVE_KEEP_WARM_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_KEEP_WARM_CONCURRENCY;
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_KEEP_WARM_CONCURRENCY
  ) {
    throw new Error(
      `AGENT_NATIVE_KEEP_WARM_CONCURRENCY must be a whole number from 1 to ` +
        `${MAX_KEEP_WARM_CONCURRENCY}; got "${raw}".`,
    );
  }
  return parsed;
}

export function workspaceKeepWarmHealthPaths(
  apps: string[],
  frameworkRoutePrefix = "/_agent-native",
): string[] {
  return apps.map((app) => `/${app}${frameworkRoutePrefix}/health`);
}

export function renderWorkspaceKeepWarmEntry(options: {
  apps: string[];
  concurrency: number;
  schedule: string;
  /** The workspace's public framework route prefix, `/_agent-native` by default. */
  frameworkRoutePrefix?: string | undefined;
}): string {
  return `const HEALTH_PATHS = ${JSON.stringify(workspaceKeepWarmHealthPaths(options.apps, options.frameworkRoutePrefix))};
// Parallel health requests per app. Requests that overlap land on separate
// instances, so this is the number of warm instances each app keeps.
const CONCURRENCY = ${JSON.stringify(options.concurrency)};
// Apps warmed at the same time, which bounds the open requests of one run.
const APP_PARALLELISM = 12;
const REQUEST_TIMEOUT_MS = 15_000;
// Netlify stops a scheduled function after 30 seconds; stop starting apps,
// and cut request timeouts, so the run finishes and logs inside that.
const RUN_DEADLINE_MS = 25_000;

async function warmApp(origin, healthPath, timeoutMs) {
  const url = new URL(healthPath, origin);
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, () =>
      fetch(url, {
        headers: { "user-agent": "agent-native-netlify-keep-warm" },
        signal: AbortSignal.timeout(timeoutMs),
      }).then(async (response) => {
        // Drain the body so the connection is released.
        await response.arrayBuffer();
        if (!response.ok) throw new Error("status " + response.status);
      }),
    ),
  );
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length > 0) {
    console.warn(
      "[agent-native-keep-warm]",
      url.pathname,
      failed.length + "/" + CONCURRENCY,
      "warm requests failed:",
      String(failed[0].reason),
    );
  }
  return CONCURRENCY - failed.length;
}

export default async function handler(request) {
  const origin = new URL(request.url).origin;
  const deadline = Date.now() + RUN_DEADLINE_MS;
  // Shuffled so a run cut short by the time limit still warms different apps
  // than the last one.
  const queue = [...HEALTH_PATHS];
  for (let i = queue.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  // Apps whose pool came up short this run, with the instances that warmed.
  const short = [];
  const skipped = [];
  let warmedRequests = 0;
  const workers = Array.from(
    { length: Math.min(APP_PARALLELISM, queue.length) },
    async () => {
      while (queue.length > 0) {
        const healthPath = queue.shift();
        const remaining = deadline - Date.now();
        if (remaining < 1_000) {
          skipped.push(healthPath);
          continue;
        }
        const warmed = await warmApp(
          origin,
          healthPath,
          Math.min(REQUEST_TIMEOUT_MS, remaining),
        );
        warmedRequests += warmed;
        if (warmed < CONCURRENCY) short.push(healthPath + " " + warmed + "/" + CONCURRENCY);
      }
    },
  );
  await Promise.all(workers);
  const requested = HEALTH_PATHS.length * CONCURRENCY;
  console.log(
    "[agent-native-keep-warm] Warmed",
    warmedRequests + "/" + requested,
    "health requests across",
    HEALTH_PATHS.length,
    "apps",
  );
  if (short.length > 0) {
    // A short pool leaves part of that app's first page load cold.
    console.warn("[agent-native-keep-warm] Pools below target:", short.join(", "));
  }
  if (skipped.length > 0) {
    // Shuffling gives these apps a fresh chance on the next run.
    console.warn("[agent-native-keep-warm] Skipped at the run deadline:", skipped.join(", "));
  }
  if (requested > 0 && warmedRequests === 0) {
    // Logged above first, so a failed run still shows what it skipped.
    throw new Error("[agent-native-keep-warm] Every app failed to warm.");
  }
  return new Response(null, { status: 204 });
}

export const config = {
  name: "agent-native workspace keep warm",
  generator: "agent-native workspace deploy",
  schedule: ${JSON.stringify(options.schedule)},
  nodeBundler: "none",
};
`;
}

/**
 * Emits one scheduled function that keeps every workspace app's server
 * function warm. Without it, an app nobody opened in the last few minutes pays
 * a full cold start on every request of its first page load.
 */
export function emitNetlifyWorkspaceKeepWarmFunction(
  functionsDir: string,
  apps: string[],
  frameworkRoutePrefix?: string,
): boolean {
  if (!isKeepWarmDeployEnabled() || apps.length === 0) return false;
  const concurrency = resolveKeepWarmConcurrency();
  const schedule = resolveKeepWarmSchedule();
  const dest = path.join(
    functionsDir,
    NETLIFY_WORKSPACE_KEEP_WARM_FUNCTION_NAME,
  );
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(
    path.join(dest, `${NETLIFY_WORKSPACE_KEEP_WARM_FUNCTION_NAME}.mjs`),
    renderWorkspaceKeepWarmEntry({
      apps,
      concurrency,
      schedule,
      frameworkRoutePrefix,
    }),
  );
  console.log(
    `[workspace-deploy] Emitted Netlify scheduled keep-warm function ` +
      `"${NETLIFY_WORKSPACE_KEEP_WARM_FUNCTION_NAME}" for ${apps.length} app(s) ` +
      `(schedule "${schedule}", ${concurrency} instance(s) per app).`,
  );
  return true;
}
