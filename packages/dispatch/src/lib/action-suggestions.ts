import {
  selectLatestAgentRun,
  hasActiveAgentRuns,
  type AgentThreadState,
} from "@agent-native/agentkit/client";
import {
  MAX_ACTION_SUGGESTIONS_PER_TURN,
  parseActionSuggestion,
  type ActionSuggestion,
} from "@agent-native/agentkit/protocol";

export const ACTION_SUGGESTION_PRODUCER = "propose-action-suggestions";
export const ACTION_SUGGESTION_EXECUTION = "execute-action-suggestion";
export const NEW_APP_SUGGESTION_APP_ID = "dispatch";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function wireResult(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return asRecord(value);
  if (value.length > 65_536) return undefined;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

const OPERATION_KEYS = ["operation", "action", "op", "command"] as const;
const DESTRUCTIVE_OPERATIONS = new Set([
  "delete",
  "destroy",
  "drop",
  "erase",
  "purge",
  "remove",
  "revoke",
  "trash",
  "truncate",
  "wipe",
]);

type SuggestedAppAction = Extract<
  ActionSuggestion["execution"],
  { type: "action" }
>;

export function suggestedActionOperations(
  execution: SuggestedAppAction,
): string[] {
  return OPERATION_KEYS.flatMap((key) => {
    const value = execution.params[key];
    return typeof value === "string" && /^[a-z][a-z0-9_-]{0,47}$/i.test(value)
      ? [value]
      : [];
  });
}

/** Recognize explicit destructive commands, including actions which multiplex them. */
export function isUnsupportedSuggestedAction(
  execution: SuggestedAppAction,
): boolean {
  const [verb] = execution.action.toLowerCase().split(/[-_]/, 1);
  return (
    DESTRUCTIVE_OPERATIONS.has(verb) ||
    suggestedActionOperations(execution).some((operation) =>
      DESTRUCTIVE_OPERATIONS.has(operation.toLowerCase()),
    )
  );
}

export function hasUnselectedDestructiveVariant(
  execution: SuggestedAppAction,
  schema: Record<string, unknown> | undefined,
): boolean {
  const properties = asRecord(schema?.properties);
  return OPERATION_KEYS.some((key) => {
    const control = asRecord(properties?.[key]);
    if (!Array.isArray(control?.enum)) return false;
    const hasDestructiveVariant = control.enum.some(
      (value) =>
        typeof value === "string" &&
        DESTRUCTIVE_OPERATIONS.has(value.toLowerCase()),
    );
    if (!hasDestructiveVariant) return false;
    const selection = execution.params[key];
    // Require an explicit selection because installed versions may have
    // different defaults for a tool with mixed operations.
    return typeof selection !== "string" || !control.enum.includes(selection);
  });
}

export function uniqueActionSuggestions(
  suggestions: Iterable<ActionSuggestion>,
): ActionSuggestion[] {
  const unique: ActionSuggestion[] = [];
  for (const suggestion of suggestions) {
    if (
      unique.some(
        (item) =>
          item.id === suggestion.id ||
          (item.appId === suggestion.appId &&
            item.label.trim().toLowerCase() ===
              suggestion.label.trim().toLowerCase()),
      )
    ) {
      continue;
    }
    unique.push(suggestion);
    if (unique.length === MAX_ACTION_SUGGESTIONS_PER_TURN) break;
  }
  return unique;
}

function* suggestionsFromResult(
  result: Record<string, unknown> | undefined,
  sourceAppId?: string,
): Generator<ActionSuggestion> {
  if (result?.isError === true || !Array.isArray(result?.suggestions)) return;
  for (const value of result.suggestions.slice(
    0,
    MAX_ACTION_SUGGESTIONS_PER_TURN,
  )) {
    try {
      const suggestion = parseActionSuggestion(value);
      if (
        !suggestion.label.trim() ||
        suggestion.label.length > 96 ||
        !suggestion.rationale.trim() ||
        suggestion.rationale.length > 280
      )
        continue;
      if (
        suggestion.execution.type === "action" &&
        isUnsupportedSuggestedAction(suggestion.execution)
      )
        continue;
      // Child output is authoritative only for actions in that installation.
      if (
        sourceAppId !== undefined &&
        (suggestion.appId !== sourceAppId ||
          suggestion.execution.type !== "action")
      ) {
        continue;
      }
      yield suggestion;
    } catch {
      // A tool can return arbitrary JSON. Invalid candidates are never offered.
    }
  }
}

export function selectTurnActionSuggestions(
  thread: AgentThreadState,
): { runId: string; suggestions: ActionSuggestion[] } | null {
  const run = selectLatestAgentRun(thread);
  if (
    run?.status !== "completed" ||
    thread.suggestionsPendingTurn ||
    hasActiveAgentRuns(thread) ||
    Object.keys(thread.approvals).length > 0
  ) {
    return null;
  }

  function* collect(): Generator<ActionSuggestion> {
    for (const tool of Object.values(thread.tools)) {
      if (tool.runId !== run?.id || tool.status !== "completed") continue;
      const result = wireResult(tool.output);
      if (tool.name === ACTION_SUGGESTION_PRODUCER) {
        yield* suggestionsFromResult(result);
      } else if (tool.name === "call_app_action" && result?.isError !== true) {
        const sourceAppId = wireResult(tool.input)?.app;
        if (typeof sourceAppId !== "string") continue;
        yield* suggestionsFromResult(
          asRecord(result?.structuredContent),
          sourceAppId,
        );
      }
    }
  }

  const suggestions = uniqueActionSuggestions(collect());
  return suggestions.length > 0 ? { runId: run.id, suggestions } : null;
}
