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
  references?: RefusedTurnReference[];
  model?: string;
  engine?: string;
  effort?: string;
  requestMode?: "act" | "plan";
}

/** The bounded shape of a composer reference; anything else is not stored. */
export interface RefusedTurnReference {
  type: "file" | "skill" | "mention" | "agent" | "custom-agent";
  path: string;
  name: string;
  source: string;
  refType?: string;
  refId?: string;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
}

const REFERENCE_TYPES = new Set([
  "file",
  "skill",
  "mention",
  "agent",
  "custom-agent",
]);
const MAX_RETRY_CONTEXT_REFERENCES = 50;
const MAX_RETRY_CONTEXT_STRING_CHARS = 200;
const MAX_REFERENCE_FIELD_CHARS = 500;
const MAX_REFERENCE_METADATA_CHARS = 2_000;
const MAX_RETRY_REFERENCES_CHARS = 16_000;

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_REFERENCE_FIELD_CHARS
    ? value
    : undefined;
}

function boundedReference(value: unknown): RefusedTurnReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const path = boundedString(entry.path);
  const name = boundedString(entry.name);
  const source = boundedString(entry.source);
  if (
    typeof entry.type !== "string" ||
    !REFERENCE_TYPES.has(entry.type) ||
    path === undefined ||
    name === undefined ||
    source === undefined
  ) {
    return null;
  }
  const optional = (key: string) => {
    const field = entry[key];
    return field === undefined ? undefined : (boundedString(field) ?? null);
  };
  const refType = optional("refType");
  const refId = optional("refId");
  const slotKey = optional("slotKey");
  const slotLabel = optional("slotLabel");
  // A present but malformed optional field invalidates the whole reference.
  if ([refType, refId, slotKey, slotLabel].includes(null as never)) return null;
  let metadata: Record<string, unknown> | undefined;
  if (entry.metadata !== undefined) {
    if (
      !entry.metadata ||
      typeof entry.metadata !== "object" ||
      Array.isArray(entry.metadata) ||
      JSON.stringify(entry.metadata).length > MAX_REFERENCE_METADATA_CHARS
    ) {
      return null;
    }
    metadata = entry.metadata as Record<string, unknown>;
  }
  return {
    type: entry.type as RefusedTurnReference["type"],
    path,
    name,
    source,
    ...(refType ? { refType } : {}),
    ...(refId ? { refId } : {}),
    ...(slotKey ? { slotKey } : {}),
    ...(slotLabel ? { slotLabel } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/**
 * Keeps the references that fit the composer's reference shape and size
 * limits, in order, up to a total serialized budget. `dropped` counts what did
 * not fit, so the caller can report a request that sent more than it should.
 */
export function boundedRetryReferences(value: unknown): {
  references: RefusedTurnReference[];
  dropped: number;
} {
  if (!Array.isArray(value)) return { references: [], dropped: 0 };
  const references: RefusedTurnReference[] = [];
  let chars = 0;
  for (const raw of value) {
    const reference = boundedReference(raw);
    const size = reference ? JSON.stringify(reference).length : 0;
    if (
      !reference ||
      references.length >= MAX_RETRY_CONTEXT_REFERENCES ||
      chars + size > MAX_RETRY_REFERENCES_CHARS
    ) {
      continue;
    }
    references.push(reference);
    chars += size;
  }
  return { references, dropped: value.length - references.length };
}

export function retryContextFromRequest(
  body: {
    metadata?: unknown;
    model?: unknown;
    engine?: unknown;
    effort?: unknown;
    mode?: unknown;
  },
  onDroppedReferences?: (dropped: number) => void,
): RefusedTurnRetryContext {
  const text = (value: unknown) =>
    typeof value === "string" &&
    value.trim() &&
    value.length <= MAX_RETRY_CONTEXT_STRING_CHARS
      ? value.trim()
      : undefined;
  const metadata = body.metadata as { references?: unknown } | null | undefined;
  const { references, dropped } = boundedRetryReferences(metadata?.references);
  if (dropped > 0) onDroppedReferences?.(dropped);
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
