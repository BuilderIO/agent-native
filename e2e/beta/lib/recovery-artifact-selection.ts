export const RECOVERY_REFRESH_TEST_TITLE =
  "[chat-reliability] refresh mid-run restores the complete answer";

export type RecoveryArtifactSelection =
  | { kind: "selected"; threadRef: string; failedAttempt: number }
  | {
      kind: "missing";
      reason: "test" | "app" | "failed_attempt" | "thread_ref";
    }
  | {
      kind: "ambiguous";
      reason: "test" | "thread_ref" | "attempt";
    }
  | {
      kind: "unreadable";
      reason: "report" | "shape" | "thread_ref" | "attempt";
    };

const MAX_NODES = 20_000;
const MAX_RESULTS = 8;
const MAX_ERROR_TEXT = 512_000;
const MAX_THREAD_REF_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedList(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_NODES;
}

function collectMatchingTests(
  report: unknown,
  app: "content" | "dispatch",
):
  | {
      kind: "ok";
      tests: Array<Record<string, unknown>>;
      exactTestOutsideApp: boolean;
    }
  | { kind: "unreadable" } {
  if (!isRecord(report) || !isBoundedList(report.suites)) {
    return { kind: "unreadable" };
  }

  const stack = report.suites.map((value) => ({ value, appSuite: false }));
  const matches: Array<Record<string, unknown>> = [];
  let exactTestOutsideApp = false;
  let visited = 0;

  while (stack.length > 0) {
    const pending = stack.pop();
    if (!pending) return { kind: "unreadable" };
    const suite = pending.value;
    if (!isRecord(suite)) return { kind: "unreadable" };
    visited += 1;
    if (visited > MAX_NODES) return { kind: "unreadable" };
    if (typeof suite.title !== "string") return { kind: "unreadable" };
    const appSuite =
      pending.appSuite || suite.title === `${app} agent chat reliability`;

    if (suite.suites !== undefined) {
      if (!isBoundedList(suite.suites)) return { kind: "unreadable" };
      if (stack.length + suite.suites.length > MAX_NODES) {
        return { kind: "unreadable" };
      }
      stack.push(...suite.suites.map((value) => ({ value, appSuite })));
    }

    if (suite.specs !== undefined) {
      if (!isBoundedList(suite.specs)) return { kind: "unreadable" };
      for (const spec of suite.specs) {
        if (!isRecord(spec)) return { kind: "unreadable" };
        visited += 1;
        if (visited > MAX_NODES) return { kind: "unreadable" };
        if (spec.title !== RECOVERY_REFRESH_TEST_TITLE) continue;
        if (!isBoundedList(spec.tests)) return { kind: "unreadable" };
        for (const test of spec.tests) {
          if (!isRecord(test)) return { kind: "unreadable" };
          visited += 1;
          if (visited > MAX_NODES) return { kind: "unreadable" };
          if (!appSuite) {
            exactTestOutsideApp = true;
          } else if (test.projectName === "chat") {
            matches.push(test);
          }
        }
      }
    }
  }

  return { kind: "ok", tests: matches, exactTestOutsideApp };
}

function failureMessages(
  result: Record<string, unknown>,
): { kind: "ok"; messages: string[] } | { kind: "unreadable" } {
  const messages: string[] = [];
  const addError = (value: unknown): boolean => {
    if (!isRecord(value)) return false;
    if (typeof value.message !== "string") return false;
    if (value.message.length > MAX_ERROR_TEXT) return false;
    messages.push(value.message);
    return true;
  };

  if (result.error !== undefined && !addError(result.error)) {
    return { kind: "unreadable" };
  }
  if (result.errors !== undefined) {
    if (!isBoundedList(result.errors)) return { kind: "unreadable" };
    for (const error of result.errors) {
      if (!addError(error)) return { kind: "unreadable" };
    }
  }
  return { kind: "ok", messages };
}

function threadRefs(
  messages: string[],
): { kind: "ok"; refs: Set<string> } | { kind: "unreadable" } {
  const refs = new Set<string>();
  for (const message of messages) {
    for (const line of message.split(/\r?\n/)) {
      if (!line.startsWith("thread:")) continue;
      const ref = line.slice("thread:".length).trim();
      if (
        !ref ||
        ref.length < 8 ||
        ref.length > MAX_THREAD_REF_LENGTH ||
        !/^[A-Za-z0-9_-]+$/.test(ref) ||
        ref === "(unknown)"
      ) {
        return { kind: "unreadable" };
      }
      refs.add(ref);
    }
  }
  return { kind: "ok", refs };
}

export function selectRecoveryThreadRef(
  report: unknown,
  app: "content" | "dispatch",
): RecoveryArtifactSelection {
  if (app !== "content" && app !== "dispatch") {
    return { kind: "unreadable", reason: "shape" };
  }
  const collected = collectMatchingTests(report, app);
  if (collected.kind !== "ok") return { kind: "unreadable", reason: "report" };
  if (collected.tests.length === 0) {
    return {
      kind: "missing",
      reason: collected.exactTestOutsideApp ? "app" : "test",
    };
  }
  if (collected.tests.length !== 1) {
    return { kind: "ambiguous", reason: "test" };
  }

  const results = collected.tests[0].results;
  if (!isBoundedList(results)) return { kind: "unreadable", reason: "attempt" };
  if (results.length > MAX_RESULTS)
    return { kind: "unreadable", reason: "attempt" };

  const knownStatuses = new Set([
    "passed",
    "failed",
    "timedOut",
    "skipped",
    "interrupted",
  ]);
  const retryNumbers = new Set<number>();
  const typedResults: Array<Record<string, unknown>> = [];
  for (const result of results) {
    if (
      !isRecord(result) ||
      typeof result.status !== "string" ||
      !knownStatuses.has(result.status) ||
      typeof result.retry !== "number" ||
      !Number.isInteger(result.retry) ||
      result.retry < 0 ||
      retryNumbers.has(result.retry)
    ) {
      return { kind: "unreadable", reason: "attempt" };
    }
    retryNumbers.add(result.retry);
    if (result.errors !== undefined && !isBoundedList(result.errors)) {
      return { kind: "unreadable", reason: "attempt" };
    }
    const errors = result.errors ?? [];
    if (
      !errors.every(
        (error) =>
          isRecord(error) &&
          typeof error.message === "string" &&
          error.message.length <= MAX_ERROR_TEXT,
      ) ||
      (result.error !== undefined &&
        (!isRecord(result.error) ||
          typeof result.error.message !== "string" ||
          result.error.message.length > MAX_ERROR_TEXT))
    ) {
      return { kind: "unreadable", reason: "attempt" };
    }
    typedResults.push(result);
  }

  const failed = typedResults.filter((result) => result.status === "failed");
  if (failed.length === 0) return { kind: "missing", reason: "failed_attempt" };

  const refs = new Set<string>();
  let failedAttempt = -1;
  for (const result of failed) {
    const messages = failureMessages(result);
    if (messages.kind !== "ok") {
      return { kind: "unreadable", reason: "attempt" };
    }
    const extracted = threadRefs(messages.messages);
    if (extracted.kind !== "ok") {
      return { kind: "unreadable", reason: "thread_ref" };
    }
    for (const ref of extracted.refs) refs.add(ref);
    const retry = result.retry as number;
    if (retry > failedAttempt) failedAttempt = retry;
  }

  if (failed.length !== 1) return { kind: "ambiguous", reason: "attempt" };
  if (refs.size === 0) return { kind: "missing", reason: "thread_ref" };
  if (refs.size !== 1) return { kind: "ambiguous", reason: "thread_ref" };

  return {
    kind: "selected",
    threadRef: [...refs][0],
    failedAttempt,
  };
}
