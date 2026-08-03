import type { ViteUserConfig } from "vitest/config";

/**
 * Shared base config every package's vitest config merges into.
 *
 * Vitest sizes its pool off the whole machine (cores - 1) with no awareness of
 * peer processes, so several concurrent agent sessions on one box each try to
 * claim all of it. Set `VITEST_CONCURRENCY` to a percentage or a worker count
 * to change the lid; a package that genuinely needs its own value can set
 * `test.maxWorkers` in its own config, which wins the merge.
 *
 * Do not reach for vitest's own `VITEST_MAX_WORKERS` to pass a percentage.
 * Vitest applies it as `Number.parseInt(value)`, so `25%` parses to `25` and
 * silently grants 25 workers instead of a quarter of the machine
 * (vitest#9631). Integers there are fine and still override this file.
 *
 * Exported as a plain object rather than through `defineConfig` so `mergeConfig`
 * sees a concrete type instead of the callable `UserConfigExport` union.
 */

const DEFAULT_MAX_WORKERS = "25%";
const ENV_KEYS = ["VITEST_CONCURRENCY", "AGENT_NATIVE_VITEST_CONCURRENCY"];

function resolveMaxWorkers(): string | number {
  const rawEnvMaxWorkers = process.env.VITEST_MAX_WORKERS;
  if (rawEnvMaxWorkers?.includes("%")) {
    throw new Error(
      `VITEST_MAX_WORKERS=${rawEnvMaxWorkers} is not a percentage to vitest — it parses as ` +
        `${Number.parseInt(rawEnvMaxWorkers)} workers. Use VITEST_CONCURRENCY for percentages, ` +
        `or an integer for VITEST_MAX_WORKERS.`,
    );
  }

  const key = ENV_KEYS.find((name) => process.env[name]);
  if (!key) return DEFAULT_MAX_WORKERS;

  const value = process.env[key]!.trim();
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

const baseConfig: ViteUserConfig = {
  test: {
    maxWorkers: resolveMaxWorkers(),
  },
};

export default baseConfig;
