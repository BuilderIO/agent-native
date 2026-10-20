import type { ViteUserConfig } from "vitest/config";

const DEFAULT_MAX_WORKERS = "25%";
const ENV_KEYS = ["VITEST_CONCURRENCY", "AGENT_NATIVE_VITEST_CONCURRENCY"];

export function resolveMaxWorkers(
  env: NodeJS.ProcessEnv = process.env,
  fallback: string | number = DEFAULT_MAX_WORKERS,
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
  if (!key) return fallback;

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
    // Vitest's 5 s default only holds while a worker has a core to itself.
    // With every core busy, booting PGlite or importing a generated server
    // bundle inside a test takes several times longer, and which test crosses
    // the limit changes from run to run.
    testTimeout: 30_000,
  },
};

export default vitestBaseConfig;
