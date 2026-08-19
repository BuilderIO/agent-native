import type { BuilderActionTiming } from "../shared/api.js";

type Clock = () => number;

function defaultClock() {
  return performance.now();
}

export function createBuilderSourceTiming(
  action: string,
  clock: Clock = defaultClock,
) {
  const actionStartedAt = clock();
  const timings: BuilderActionTiming[] = [];

  function record(name: string, startedAt: number) {
    const durationMs = Math.max(0, clock() - startedAt);
    timings.push({ name, durationMs });
  }

  async function measure<T>(name: string, operation: () => Promise<T>) {
    const startedAt = clock();
    try {
      return await operation();
    } finally {
      record(name, startedAt);
    }
  }

  function ensure(name: string) {
    if (!timings.some((timing) => timing.name === name)) {
      timings.push({ name, durationMs: 0 });
    }
  }

  function add(name: string, durationMs: number) {
    const safeDurationMs = Math.max(0, durationMs);
    timings.push({ name, durationMs: safeDurationMs });
  }

  function finish() {
    if (!timings.some((timing) => timing.name === "total")) {
      record("total", actionStartedAt);
    }
    return timings.map((timing) => ({ ...timing }));
  }

  function log(outcome: "succeeded" | "failed") {
    console.info("builder_source_action_timing", {
      action,
      outcome,
      timings: finish(),
    });
  }

  return { start: clock, record, measure, add, ensure, finish, log };
}
