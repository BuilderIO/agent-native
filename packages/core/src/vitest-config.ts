import type { ViteUserConfig } from "vitest/config";


const DEFAULT_MAX_WORKERS = "25%";
const ENV_KEYS = ["VITEST_CONCURRENCY", "AGENT_NATIVE_VITEST_CONCURRENCY"];

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
