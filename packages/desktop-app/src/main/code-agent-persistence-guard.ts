export interface CodeAgentPersistenceLogContext {
  runId: string;
  source: string;
}

type Warn = (message: string, context: Record<string, string>) => void;

const MAX_LOG_VALUE_LENGTH = 96;

function boundedLogValue(value: string): string {
  return value.slice(0, MAX_LOG_VALUE_LENGTH);
}

/** Keeps child-process event handlers from escalating transient store failures. */
export function guardCodeAgentPersistence(
  context: CodeAgentPersistenceLogContext,
  persist: () => void,
  warn: Warn = console.warn,
): boolean {
  try {
    persist();
    return true;
  } catch {
    try {
      warn("Code agent persistence failed.", {
        runId: boundedLogValue(context.runId),
        source: boundedLogValue(context.source),
      });
    } catch {
      // Logging must not turn a contained persistence error into a main-process crash.
    }
    return false;
  }
}
