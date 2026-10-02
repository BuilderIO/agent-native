/**
 * Marks the durable messages the server writes for a turn it refused before
 * any run started. On the assistant notice it lets the AgentKit projection hide
 * it, because the same failure is a failed run the chat renders as a recovery
 * card. On the user message it tells the setup recovery which prompt was
 * refused, together with the run id in `submittedRunId`.
 */
export const RUN_NOT_STARTED_METADATA_KEY = "agentNativeRunNotStarted";

/**
 * What a retry of a refused turn needs besides its text and attachments:
 * the references and the model, engine, effort and request mode it was sent
 * with. Only these fields are read from the request; nothing else is kept.
 */
export interface RefusedTurnRetryContext {
  references?: Array<Record<string, unknown>>;
  model?: string;
  engine?: string;
  effort?: string;
  requestMode?: "act" | "plan";
}

const MAX_RETRY_CONTEXT_REFERENCES = 50;
const MAX_RETRY_CONTEXT_STRING_CHARS = 200;

export function retryContextFromRequest(body: {
  metadata?: unknown;
  model?: unknown;
  engine?: unknown;
  effort?: unknown;
  mode?: unknown;
}): RefusedTurnRetryContext {
  const text = (value: unknown) =>
    typeof value === "string" &&
    value.trim() &&
    value.length <= MAX_RETRY_CONTEXT_STRING_CHARS
      ? value.trim()
      : undefined;
  const metadata = body.metadata as { references?: unknown } | null | undefined;
  const references = Array.isArray(metadata?.references)
    ? metadata.references
        .filter(
          (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === "object" && !Array.isArray(entry),
        )
        .slice(0, MAX_RETRY_CONTEXT_REFERENCES)
    : [];
  const model = text(body.model);
  const engine = text(body.engine);
  const effort = text(body.effort);
  return {
    ...(references.length > 0 ? { references } : {}),
    ...(model ? { model } : {}),
    ...(engine ? { engine } : {}),
    ...(effort ? { effort } : {}),
    ...(body.mode === "act" || body.mode === "plan"
      ? { requestMode: body.mode }
      : {}),
  };
}
