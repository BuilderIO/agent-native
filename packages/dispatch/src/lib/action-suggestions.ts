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
