import type { ContextTokenCountMethod } from "../../shared/context-xray.js";
import type { EngineContentPart, EngineMessage } from "../engine/types.js";

type TokenCounter = (text: string) => number;

let tokenizerPromise: Promise<TokenCounter | null> | undefined;

async function loadTokenizer(): Promise<TokenCounter | null> {
  if (!tokenizerPromise) {
    tokenizerPromise = import("@anthropic-ai/tokenizer")
      .then((mod) =>
        typeof mod.countTokens === "function"
          ? (mod.countTokens as TokenCounter)
          : null,
      )
      .catch(() => null);
  }
  return tokenizerPromise;
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function decodedByteLength(base64: string): number {
  const normalized = (base64 || "").replace(/\s+/g, "");
  if (!normalized) return 0;
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

export interface TokenCountResult {
  tokens: number;
  method: ContextTokenCountMethod;
}

export async function countTextTokens(text: string): Promise<TokenCountResult> {
  const counter = await loadTokenizer();
  if (counter) {
    try {
      return { tokens: Math.max(1, counter(text || "")), method: "exact" };
    } catch {
      // Fall through to the documented char/4 estimate.
    }
  }
  return { tokens: estimateTextTokens(text), method: "estimate" };
}

function estimateBinaryTokens(
  part: Extract<EngineContentPart, { data: string }>,
) {
  const bytes = decodedByteLength(part.data);
  return Math.max(1, Math.ceil(bytes / 4));
}

export async function countPartTokens(
  part: EngineContentPart,
): Promise<TokenCountResult> {
  if (part.type === "text") return countTextTokens(part.text);
  if (part.type === "thinking") return countTextTokens(part.text);
  if (part.type === "tool-call") {
    return countTextTokens(`${part.name}\n${JSON.stringify(part.input)}`);
  }
  if (part.type === "tool-result") return countTextTokens(part.content);
  if (part.type === "image" || part.type === "file") {
    return { tokens: estimateBinaryTokens(part), method: "estimate" };
  }
  return { tokens: 1, method: "estimate" };
}

export async function countMessageTokens(
  messages: EngineMessage[],
): Promise<TokenCountResult> {
  let tokens = 0;
  let method: ContextTokenCountMethod = "exact";
  for (const message of messages) {
    for (const part of message.content) {
      const count = await countPartTokens(part);
      tokens += count.tokens;
      if (count.method === "estimate") method = "estimate";
    }
  }
  return { tokens, method };
}
