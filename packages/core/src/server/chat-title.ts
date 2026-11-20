import { MODEL_REFUSAL_CODE } from "../agent/engine/error-detail.js";
import { EngineError } from "../agent/engine/types.js";
import { completeText } from "./complete-text.js";

export interface ChatTitleRequest {
  message: string;
  appId?: string;
  /**
   * The engine and model the thread's turn was sent with. Without them the
   * title runs on the deployment's default model, which the user's own key
   * may not be able to call.
   */
  engine?: string;
  model?: string;
}

function selection(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= 200
    ? value.trim()
    : undefined;
}

export function chatTitleRequestFromBody(
  body: unknown,
): ChatTitleRequest | null {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof record.message !== "string" || !record.message) return null;
  const engine = selection(record.engine);
  const model = selection(record.model);
  return {
    message: record.message,
    ...(engine ? { engine } : {}),
    ...(model ? { model } : {}),
  };
}

export async function generateChatTitle(
  request: ChatTitleRequest,
): Promise<string | null> {
  // Strip hidden context and mention markup before title generation.
  // Never let injected prompt context become a visible tab label.
  const cleanMessage = request.message
    .replace(/<context\b[^>]*>[\s\S]*?<\/context>\n?/gi, "")
    .replace(/<context\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/context>/gi, "")
    .replace(/@\[([^\]|]+)\|[^\]]*\]/g, "@$1")
    .trim();
  const result = await completeText({
    appId: request.appId,
    ...(request.engine ? { engine: request.engine } : {}),
    ...(request.model ? { model: request.model } : {}),
    systemPrompt:
      "Create a concise chat tab title for the user's request. Return only 3-6 words, with no quotes, punctuation, or explanation.",
    input: cleanMessage.slice(0, 500),
    maxOutputTokens: 30,
    temperature: 0,
    timeoutMs: 10_000,
  }).catch((error: unknown) => {
    if (
      error instanceof EngineError &&
      error.errorCode === MODEL_REFUSAL_CODE
    ) {
      return null;
    }
    throw error;
  });
  if (result === null) return null;
  return result.text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
