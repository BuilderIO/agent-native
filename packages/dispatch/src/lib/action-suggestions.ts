import {
  selectLatestAgentRun,
  hasActiveAgentRuns,
  type AgentThreadState,
} from "@agent-native/agentkit/client";
import {
  AgentProtocolValidationError,
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
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
}

const OPERATION_KEYS = ["operation", "action", "op", "command"];
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

function hasDestructiveToken(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z]+/)
      .some((token) => DESTRUCTIVE_OPERATIONS.has(token))
  );
}

export function isUnsupportedSuggestedAction(
  execution: SuggestedAppAction,
): boolean {
  if (hasDestructiveToken(execution.action)) return true;
  const pending: unknown[] = [execution.params];
  for (let budget = 512; pending.length > 0; budget--) {
    if (budget === 0) return true;
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else {
      const object = asRecord(value);
      if (!object) continue;
      for (const [key, child] of Object.entries(object)) {
        if (OPERATION_KEYS.includes(key) && hasDestructiveToken(child))
          return true;
        if (child !== null && typeof child === "object") pending.push(child);
      }
    }
  }
  return false;
}

export function hasUnselectedDestructiveVariant(
  execution: SuggestedAppAction,
  schema: Record<string, unknown> | undefined,
): boolean {
  const pending: { schema: unknown; input: unknown; selector: boolean }[] = [
    { schema, input: execution.params, selector: false },
  ];
  for (let budget = 512; pending.length > 0; budget--) {
    if (budget === 0) return true;
    const node = pending.pop();
    if (!node) continue;
    const shape = asRecord(node.schema);
    if (!shape) continue;
    if (
      node.selector &&
      Array.isArray(shape.enum) &&
      shape.enum.some(hasDestructiveToken) &&
      (!shape.enum.includes(node.input) || hasDestructiveToken(node.input))
    ) {
      return true;
    }
    const properties = asRecord(shape.properties);
    const input = asRecord(node.input);
    if (properties) {
      for (const [key, child] of Object.entries(properties)) {
        pending.push({
          schema: child,
          input: input?.[key],
          selector: OPERATION_KEYS.includes(key),
        });
      }
    }
    for (const key of ["allOf", "anyOf", "oneOf"]) {
      const variants = shape[key];
      if (!Array.isArray(variants)) continue;
      for (const variant of variants)
        pending.push({ ...node, schema: variant });
    }
    if (shape.items && Array.isArray(node.input)) {
      for (const child of node.input)
        pending.push({
          schema: shape.items,
          input: child,
          selector: node.selector,
        });
    }
  }
  return false;
}

export function suggestionReviewPayload({
  execution,
}: ActionSuggestion): string {
  switch (execution.type) {
    case "action":
      return JSON.stringify(execution.params, null, 2);
    case "customize":
      return execution.editSpec;
    case "create-app":
      return execution.domainSpec;
  }
}

export function requiresSuggestionReview(
  suggestion: ActionSuggestion,
): boolean {
  const { execution } = suggestion;
  if (execution.type !== "action") return true;
  return !(
    (suggestion.kind === "filter" && execution.action === "create-split") ||
    (suggestion.kind === "saved-view" &&
      execution.action === "save-crm-saved-view")
  );
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
    let suggestion: ActionSuggestion;
    try {
      suggestion = parseActionSuggestion(value);
    } catch (error) {
      if (!(error instanceof AgentProtocolValidationError)) throw error;
      continue;
    }
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
    if (
      sourceAppId !== undefined &&
      (suggestion.appId !== sourceAppId ||
        suggestion.execution.type !== "action")
    )
      continue;
    if (suggestionReviewPayload(suggestion).length > 65_536) continue;
    yield suggestion;
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
