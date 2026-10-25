import { createHash } from "node:crypto";

import {
  getJevContextCredentials,
  getOwnerApiKeyForEngine,
} from "../agent/production-agent.js";
import { getAppConfig } from "../app-config/index.js";
import { getRequestOrgId } from "../server/request-context.js";
import {
  DECISION_PROVIDER_CAPABILITIES,
  getDecisionQuestionCapability,
} from "./capabilities.js";
import {
  isJevEnabled,
  requestJev,
  JevProviderRequestError,
  type JevQuestion,
  type JevRequest,
} from "./providers/jev.js";
import {
  OPENAI_DECISIONS_MODEL,
  requestOpenAiDecision,
  DecisionProviderRequestError,
} from "./providers/openai.js";
import { DecisionResponseError, parseDecisionAnswers } from "./response.js";
import type {
  DecideOptions,
  DecisionFailureReason,
  DecideResult,
  DecisionInput,
  DecisionProvider,
  DecisionQuestion,
  DecisionsStatus,
} from "./types.js";
import { validateDecisionInput } from "./validation.js";

const JEV_MODEL = "jev-latest";
const DECISION_CACHE_TTL_MS = 60_000;
const DECISION_CACHE_MAX_ENTRIES = 256;

type SuccessfulDecision = Extract<DecideResult, { status: "ok" }>;

const decisionCache = new Map<
  string,
  { expiresAt: number; result: SuccessfulDecision }
>();

function copyResult<T>(value: T): T {
  return structuredClone(value);
}

function purgeDecisionCache(now: number): void {
  for (const [key, value] of decisionCache) {
    if (value.expiresAt <= now) decisionCache.delete(key);
  }
}

function getDecisionCacheKey(
  ownerEmail: string,
  provider: DecisionProvider,
  model: string,
  cacheKey: string | undefined,
  input: DecisionInput,
  questions: readonly DecisionQuestion[],
): string | undefined {
  if (!cacheKey) return undefined;
  const payload = JSON.stringify({
    ownerEmail: ownerEmail.trim().toLowerCase(),
    orgId: getRequestOrgId() ?? null,
    provider,
    model,
    cacheKey,
    input,
    questions,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function readDecisionCache(
  key: string | undefined,
): SuccessfulDecision | undefined {
  if (!key) return undefined;
  const now = Date.now();
  purgeDecisionCache(now);
  const cached = decisionCache.get(key);
  if (!cached) return undefined;
  decisionCache.delete(key);
  decisionCache.set(key, cached);
  return copyResult(cached.result);
}

function writeDecisionCache(
  key: string | undefined,
  result: SuccessfulDecision,
): void {
  if (!key) return;
  const now = Date.now();
  purgeDecisionCache(now);
  decisionCache.set(key, {
    expiresAt: now + DECISION_CACHE_TTL_MS,
    result: copyResult(result),
  });
  while (decisionCache.size > DECISION_CACHE_MAX_ENTRIES) {
    const oldest = decisionCache.keys().next().value;
    if (oldest === undefined) break;
    decisionCache.delete(oldest);
  }
}

function hasImageInput(input: DecisionInput): boolean {
  return (
    typeof input !== "string" && input.some((part) => part.type === "image")
  );
}

function toJevState(input: DecisionInput): Record<string, unknown> {
  return { input };
}

function toJevQuestion(question: DecisionQuestion): JevQuestion {
  if (question.type === "predicate") {
    return { type: "noul", instructions: question.instructions };
  }
  if (question.type === "choice") {
    return {
      type: "choice",
      instructions: question.instructions,
      criteria: Object.fromEntries(
        question.choices.map(({ value, description }) => [value, description]),
      ),
    };
  }
  return {
    type: "score",
    instructions: question.instructions,
    criteria: question.levels.map(
      ({ label, description }) => `${label}: ${description}`,
    ) as [string, string, ...string[]],
  };
}

function toJevRequest(
  input: DecisionInput,
  questions: readonly DecisionQuestion[],
): JevRequest {
  return {
    model: JEV_MODEL,
    state: toJevState(input),
    questions: Object.fromEntries(
      questions.map((question) => [question.name, toJevQuestion(question)]),
    ),
  };
}

function validateOptions(options: DecideOptions | undefined): boolean {
  if (!options) return true;
  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1_000 ||
      options.timeoutMs > 60_000)
  ) {
    return false;
  }
  if (options.cacheKey !== undefined && options.cacheKey.length > 256) {
    return false;
  }
  if (options.providers) {
    if (
      options.providers.length < 1 ||
      options.providers.length > 2 ||
      new Set(options.providers).size !== options.providers.length ||
      options.providers.some(
        (provider) => provider !== "openai" && provider !== "jev",
      )
    ) {
      return false;
    }
  }
  return true;
}

function fromProviderError(error: unknown): DecisionFailureReason {
  if (error instanceof DecisionProviderRequestError) return error.reason;
  if (error instanceof JevProviderRequestError) return error.reason;
  if (error instanceof DecisionResponseError) return error.reason;
  return "provider_error";
}

export async function decide(input: {
  ownerEmail: string;
  input: DecisionInput;
  questions: readonly DecisionQuestion[];
  options?: DecideOptions;
}): Promise<DecideResult> {
  if (
    !input.ownerEmail.trim() ||
    !validateDecisionInput({
      input: input.input,
      questions: input.questions,
      options: input.options,
    }) ||
    !validateOptions(input.options)
  ) {
    return { status: "failed", reason: "invalid_input" };
  }
  if (input.options?.signal?.aborted) {
    return { status: "failed", reason: "aborted" };
  }

  const configured = getAppConfig().decisions;
  const providers = input.options?.providers ?? configured.providerOrder;
  const timeoutMs = input.options?.timeoutMs ?? configured.timeoutMs;
  const missingProviders: DecisionProvider[] = [];
  let compatibleProviderCount = 0;
  let unverifiedCapability: {
    provider: DecisionProvider;
    questionNames: string[];
  } | null = null;

  for (const provider of providers) {
    const unavailableQuestions = input.questions.filter(
      (question) =>
        !getDecisionQuestionCapability(provider, question.type).enabled,
    );
    if (unavailableQuestions.length > 0) {
      const unverifiedQuestions = unavailableQuestions.filter(
        (question) =>
          getDecisionQuestionCapability(provider, question.type).status ===
          "unverified",
      );
      if (unverifiedQuestions.length > 0) {
        unverifiedCapability = {
          provider,
          questionNames: unverifiedQuestions.map(({ name }) => name),
        };
      }
      continue;
    }
    if (provider === "jev" && hasImageInput(input.input)) {
      continue;
    }
    compatibleProviderCount += 1;

    let apiKey: string | undefined;
    let jevCredentials:
      | Awaited<ReturnType<typeof getJevContextCredentials>>
      | undefined;
    let jevDeadlineAt: number | undefined;
    let lookupFailed = false;

    if (provider === "openai") {
      const resolved = await getOwnerApiKeyForEngine(
        "ai-sdk:openai",
        input.ownerEmail,
        {
          allowDeploymentFallback: false,
          onLookupFailure: () => (lookupFailed = true),
        },
      );
      apiKey =
        resolved.credentialProvenance?.scope === "deployment"
          ? undefined
          : resolved.apiKey;
    } else {
      jevCredentials = await getJevContextCredentials(input.ownerEmail);
      apiKey = jevCredentials.directApiKey ?? jevCredentials.personalApiKey;
      lookupFailed = Boolean(
        jevCredentials.apiKeyLookupFailed ||
        (!apiKey && jevCredentials.builderAuthLookupFailed),
      );
      if (!apiKey && jevCredentials.builderAuth) {
        jevDeadlineAt = Date.now() + timeoutMs;
        try {
          if (
            await isJevEnabled(jevCredentials, {
              signal: input.options?.signal,
              timeoutMs: Math.max(0, jevDeadlineAt - Date.now()),
            })
          ) {
            apiKey = "builder-auth";
          }
        } catch (error) {
          if (input.options?.signal?.aborted) {
            return { status: "failed", reason: "aborted", provider };
          }
          if (
            error instanceof JevProviderRequestError &&
            (error.reason === "timeout" || error.reason === "aborted")
          ) {
            return { status: "failed", reason: error.reason, provider };
          }
          lookupFailed = true;
        }
      }
    }

    if (input.options?.signal?.aborted) {
      return { status: "failed", reason: "aborted", provider };
    }

    if (lookupFailed) {
      return {
        status: "failed",
        reason: "credentials_unavailable",
        provider,
      };
    }

    if (!apiKey) {
      missingProviders.push(provider);
      continue;
    }

    const model = provider === "openai" ? OPENAI_DECISIONS_MODEL : JEV_MODEL;
    const key = getDecisionCacheKey(
      input.ownerEmail,
      provider,
      model,
      input.options?.cacheKey,
      input.input,
      input.questions,
    );
    const providerTimeoutMs =
      provider === "jev" && jevDeadlineAt !== undefined
        ? Math.max(0, jevDeadlineAt - Date.now())
        : timeoutMs;
    if (providerTimeoutMs <= 0) {
      return { status: "failed", reason: "timeout", provider };
    }
    const cached = readDecisionCache(key);
    if (cached) return { ...cached, cached: true };

    try {
      const response =
        provider === "openai"
          ? await requestOpenAiDecision({
              input: input.input,
              questions: input.questions,
              apiKey,
              signal: input.options?.signal,
              timeoutMs,
            })
          : await requestJev({
              apiKey: jevCredentials?.apiKey,
              personalApiKey: jevCredentials?.personalApiKey,
              directApiKey: jevCredentials?.directApiKey,
              builderAuth: jevCredentials?.builderAuth,
              request: toJevRequest(input.input, input.questions),
              signal: input.options?.signal,
              timeoutMs: providerTimeoutMs,
            });
      const parsed = parseDecisionAnswers(provider, input.questions, response);
      const result: SuccessfulDecision = {
        status: "ok",
        provider,
        model,
        answers: parsed.answers,
        ...(parsed.usage ? { usage: parsed.usage } : {}),
        ...(input.options?.cacheKey ? { cached: false } : {}),
      };
      writeDecisionCache(key, result);
      return result;
    } catch (error) {
      if (input.options?.signal?.aborted) {
        return { status: "failed", reason: "aborted", provider };
      }
      const reason = fromProviderError(error);
      return {
        status: "failed",
        reason,
        provider,
        ...(reason === "refusal"
          ? { questionNames: input.questions.map(({ name }) => name) }
          : {}),
      };
    }
  }

  if (compatibleProviderCount === 0) {
    if (unverifiedCapability) {
      return {
        status: "failed",
        reason: "unverified_capability",
        ...unverifiedCapability,
      };
    }
    return { status: "failed", reason: "unsupported_input" };
  }
  return {
    status: "not_configured",
    reason: "missing_credentials",
    providers: missingProviders.length > 0 ? missingProviders : [...providers],
  };
}

export async function getDecisionsStatus(
  ownerEmail: string,
): Promise<DecisionsStatus> {
  const providerOrder = [...getAppConfig().decisions.providerOrder];
  let openAiLookupFailed = false;
  const openAi = await getOwnerApiKeyForEngine("ai-sdk:openai", ownerEmail, {
    allowDeploymentFallback: false,
    onLookupFailure: () => (openAiLookupFailed = true),
  });
  const jev = await getJevContextCredentials(ownerEmail);

  let jevStatus: DecisionsStatus["providers"][number]["status"] =
    "not_configured";
  if (jev.directApiKey || jev.personalApiKey) {
    jevStatus = "ready";
  } else if (jev.builderAuth) {
    try {
      jevStatus = (await isJevEnabled(jev)) ? "ready" : "not_configured";
    } catch {
      jevStatus = "unknown";
    }
  } else if (jev.apiKeyLookupFailed || jev.builderAuthLookupFailed) {
    jevStatus = "unknown";
  }

  return {
    providerOrder,
    capabilities: DECISION_PROVIDER_CAPABILITIES,
    providers: [
      {
        provider: "openai",
        status: openAiLookupFailed
          ? "unknown"
          : openAi.credentialProvenance?.scope === "deployment"
            ? "not_configured"
            : openAi.apiKey
              ? "ready"
              : "not_configured",
      },
      { provider: "jev", status: jevStatus },
    ],
  };
}

export function __resetDecisionCacheForTests(): void {
  decisionCache.clear();
}
