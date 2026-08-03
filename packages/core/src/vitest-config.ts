import type { ViteUserConfig } from "vitest/config";

/**
 * Base vitest config that caps a suite's worker pool at a share of the machine.
 *
 * Vitest sizes its pool at `cores - 1` with no awareness of peer processes, so
 * several suites running at once — concurrent agent sessions, or a workspace
 * running packages in parallel — each try to claim the whole box. Set
 * `VITEST_CONCURRENCY` to a percentage or a worker count to change the lid; a
 * package that needs its own value sets `test.maxWorkers` in its own config,
 * which wins the merge.
 *
 * This ships from core rather than living at the monorepo root because template
 * directories are scaffolded out verbatim as standalone apps — a config that
 * reaches above the template would resolve to nothing in the generated app.
 *
 * Keep this module free of runtime imports so loading it costs a config file
 * nothing beyond reading the environment.
 */

const DEFAULT_MAX_WORKERS = "25%";
const ENV_KEYS = ["VITEST_CONCURRENCY", "AGENT_NATIVE_VITEST_CONCURRENCY"];

/**
 * Resolve the worker lid from the environment, throwing on anything that is
 * neither a percentage nor a worker count. A bad value must not quietly become
 * the default — that reads as "configured" while running at some other size.
 */
export function resolveMaxWorkers(
  env: NodeJS.ProcessEnv = process.env,
): string | number {
  const rawMaxWorkers = env.VITEST_MAX_WORKERS;
  if (rawMaxWorkers?.includes("%")) {
    throw new Error(
      `VITEST_MAX_WORKERS=${rawMaxWorkers} is not a percentage to vitest — it parses as ` +
        `${Number.parseInt(rawMaxWorkers)} workers. Use VITEST_CONCURRENCY for percentages, ` +
        `or an integer for VITEST_MAX_WORKERS.`,
    );
  }

  const key = ENV_KEYS.find((name) => env[name]);
  if (!key) return DEFAULT_MAX_WORKERS;

  const value = env[key]!.trim();
  if (/^\d+%$/.test(value)) {
    const percent = Number.parseInt(value);
    if (percent < 1 || percent > 100) {
      throw new Error(`${key}=${value} is out of range — use 1% to 100%.`);
    }
    return value;
  }

  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `${key}=${value} is not a percentage like "25%" or a worker count like "2".`,
    );
  }
  return count;
}

const vitestBaseConfig: ViteUserConfig = {
  test: {
    maxWorkers: resolveMaxWorkers(),
  },
};

export default vitestBaseConfig;
