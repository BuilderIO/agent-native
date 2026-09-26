import {
  isResolvedEngineUsableForRequest,
  registerBuiltinEngines,
  resolveEngine,
} from "@agent-native/core/agent/engine";
import { resolveCredential } from "@agent-native/core/credentials";
import { emit } from "@agent-native/core/event-bus";
import {
  listOAuthAccounts,
  listOAuthAccountsByOwner,
  getOAuthTokens,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import {
  getRequestContext,
  getJevContextCredentials,
  isJevEnabled,
  readDeployCredentialEnv,
  requestJevThroughBuilder,
  runWithRequestContext,
  type JevContextCredentials,
  type JevResponse,
} from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import {
  AI_FILTER_MIN_LEARNED_EXAMPLES,
  AI_FILTER_RULE_NAME,
  type AiFilterPreviewCorrection,
  type AiFilterDecision,
  type AiFilterPreviewEmail,
  type AiFilterPreviewRule,
  type AiFilterState,
} from "@shared/ai-filter.js";
import {
  AI_PRIORITY_DEFAULT_INSTRUCTION,
  aiPriorityEmailKey,
  type AiPriorityEmail,
} from "@shared/ai-priority.js";
import { mailLabelsInclude } from "@shared/gmail-labels.js";
import type { AutomationAction } from "@shared/types.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, schema } from "../db/index.js";
import { getAiFilterState, recordAiFilterDecisions } from "./ai-filter.js";
import {
  buildLabelCache,
  executeActions,
  type ActionContext,
} from "./automation-actions.js";
import {
  resolveAutomationModelSettings,
  resolveTextAutomationModelSettings,
  TYPESAFE_AUTOMATION_ENGINE,
  TYPESAFE_AUTOMATION_MODEL,
  type AutomationModelSettings,
} from "./automation-model.js";
import {
  createOAuth2Client,
  gmailListMessages,
  gmailGetMessage,
  gmailBatchGetMessages,
  gmailListHistory,
  gmailGetProfile,
} from "./google-api.js";
import { getOAuth2Credentials } from "./google-auth.js";

const MAX_EMAILS_PER_RUN = 50;
const MAX_PROCESSED_IDS = 500;
const PROCESSED_IDS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

interface Watermark {
  lastHistoryId?: string;
  lastTimestamp: number;
}

interface ProcessedIds {
  ids: string[];
  updatedAt: number;
}

interface RuleRecord {
  id: string;
  ownerEmail: string;
  domain: string;
  kind?: string;
  name: string;
  condition: string;
  actions: string;
  enabled: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Per-user Anthropic key ──────────────────────────────────────────────────

async function resolveAnthropicKey(
  ownerEmail: string,
): Promise<string | undefined> {
  const credential = await resolveCredential("ANTHROPIC_API_KEY", {
    userEmail: ownerEmail,
  });
  if (credential?.trim()) return credential.trim();

  const userKey = (await getUserSetting(ownerEmail, "anthropic-api-key")) as
    | string
    | { key?: string }
    | undefined;
  if (typeof userKey === "string" && userKey.trim()) return userKey.trim();
  if (userKey && typeof userKey === "object" && userKey.key?.trim()) {
    return userKey.key.trim();
  }
  return readDeployCredentialEnv("ANTHROPIC_API_KEY") || undefined;
}

// ─── Token helpers ───────────────────────────────────────────────────────────

async function getAccessToken(accountEmail: string): Promise<string | null> {
  const tokens = (await getOAuthTokens("google", accountEmail)) as unknown as
    | StoredTokens
    | undefined;
  if (!tokens?.access_token) return null;

  if (
    tokens.expiry_date &&
    tokens.refresh_token &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000
  ) {
    try {
      const { clientId, clientSecret } =
        await getOAuth2Credentials(accountEmail);
      const oauth = createOAuth2Client(clientId, clientSecret, "");
      const refreshed = await oauth.refreshToken(tokens.refresh_token);
      const updated = {
        ...tokens,
        access_token: refreshed.access_token,
        expiry_date: Date.now() + refreshed.expires_in * 1000,
      };
      await saveOAuthTokens(
        "google",
        accountEmail,
        updated as unknown as Record<string, unknown>,
      );
      return refreshed.access_token;
    } catch (err: any) {
      console.error(
        `[automation-engine] Token refresh failed for ${accountEmail}:`,
        err.message,
      );
    }
  }

  return tokens.access_token;
}

// ─── Watermark management ────────────────────────────────────────────────────

async function getWatermark(ownerEmail: string): Promise<Watermark> {
  const data = await getUserSetting(ownerEmail, "automation-watermark");
  if (data && typeof data === "object") return data as unknown as Watermark;
  return { lastTimestamp: 0 };
}

async function setWatermark(
  ownerEmail: string,
  watermark: Watermark,
): Promise<void> {
  await putUserSetting(ownerEmail, "automation-watermark", watermark as any);
}

async function getProcessedIds(ownerEmail: string): Promise<Set<string>> {
  const data = await getUserSetting(ownerEmail, "automation-processed-ids");
  if (data && typeof data === "object") {
    const stored = data as unknown as ProcessedIds;
    // Prune if too old
    if (Date.now() - stored.updatedAt > PROCESSED_IDS_MAX_AGE_MS) {
      return new Set();
    }
    return new Set(stored.ids || []);
  }
  return new Set();
}

async function saveProcessedIds(
  ownerEmail: string,
  ids: Set<string>,
): Promise<void> {
  // Keep only the last MAX_PROCESSED_IDS
  const arr = [...ids].slice(-MAX_PROCESSED_IDS);
  await putUserSetting(ownerEmail, "automation-processed-ids", {
    ids: arr,
    updatedAt: Date.now(),
  } as any);
}

// ─── Load rules ──────────────────────────────────────────────────────────────

async function loadActiveRules(
  ownerEmail: string,
  domain: string,
): Promise<RuleRecord[]> {
  const rules = await db
    .select()
    .from(schema.automationRules)
    .where(
      and(
        eq(schema.automationRules.ownerEmail, ownerEmail),
        eq(schema.automationRules.domain, domain),
        eq(schema.automationRules.enabled, 1),
      ),
    );
  return rules as RuleRecord[];
}

// ─── Fetch new messages ──────────────────────────────────────────────────────

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  labelIds: string[];
  date: string;
}

async function fetchNewInboxMessages(
  accessToken: string,
  watermark: Watermark,
  processedIds: Set<string>,
): Promise<{ messages: EmailSummary[]; newHistoryId?: string }> {
  let messageIds: string[] = [];
  let newHistoryId: string | undefined;

  // Try history-based delta detection first
  if (watermark.lastHistoryId) {
    try {
      const history = await gmailListHistory(accessToken, {
        startHistoryId: watermark.lastHistoryId,
        historyTypes: ["messageAdded"],
        labelId: "INBOX",
        maxResults: MAX_EMAILS_PER_RUN,
      });

      newHistoryId = history.historyId;

      if (history.history) {
        for (const entry of history.history) {
          for (const added of entry.messagesAdded || []) {
            if (added.message?.id) {
              // Only include messages that have INBOX label
              const labels = added.message.labelIds || [];
              if (labels.includes("INBOX")) {
                messageIds.push(added.message.id);
              }
            }
          }
        }
      }
    } catch (err: any) {
      // historyId too old or invalid — fall back to listing
      console.warn(
        "[automation-engine] History list failed, falling back to message list:",
        err.message,
      );
      messageIds = [];
      watermark.lastHistoryId = undefined;
    }
  }

  // Fallback: list recent inbox messages
  if (!watermark.lastHistoryId) {
    try {
      const res = await gmailListMessages(accessToken, {
        q: "in:inbox newer_than:3d",
        maxResults: MAX_EMAILS_PER_RUN,
      });
      newHistoryId = undefined; // We'll get it from the profile
      messageIds = (res.messages || []).map((m: any) => m.id);

      // Get current historyId from profile for next run
      try {
        const profile = await gmailGetProfile(accessToken);
        newHistoryId = profile.historyId;
      } catch {}
    } catch (err: any) {
      console.error(
        "[automation-engine] Failed to list inbox messages:",
        err.message,
      );
      return { messages: [] };
    }
  }

  // Filter out already-processed messages
  messageIds = messageIds.filter((id) => !processedIds.has(id));

  // Limit batch size
  messageIds = messageIds.slice(0, MAX_EMAILS_PER_RUN);

  if (messageIds.length === 0) {
    return { messages: [], newHistoryId };
  }

  // Fetch metadata for all messages in one batched call instead of one
  // request per message.
  const batchResults = await gmailBatchGetMessages(
    accessToken,
    messageIds,
    "metadata",
  );

  // Gmail's batch endpoint can return fewer sub-responses than sub-requests
  // when it rate-limits mid-batch. Refill any gaps with individual gets so a
  // transient partial batch doesn't drop messages a full per-message loop
  // would have caught.
  const missing = batchResults.filter((r) => !r.data).map((r) => r.id);
  if (missing.length > 0) {
    const refills = await Promise.all(
      missing.map(async (id) => {
        try {
          const data = await gmailGetMessage(accessToken, id, "metadata");
          return { id, data };
        } catch (err: any) {
          console.error(
            `[automation-engine] Failed to fetch message ${id}:`,
            err.message,
          );
          return { id, data: null as any };
        }
      }),
    );
    const byId = new Map(refills.map((r) => [r.id, r.data]));
    for (const r of batchResults) {
      if (!r.data && byId.has(r.id)) r.data = byId.get(r.id);
    }
  }

  const messages: EmailSummary[] = [];
  for (const r of batchResults) {
    if (!r.data) continue;
    const msg = r.data;
    // The list/history query is Inbox-scoped, but labels can change while the
    // metadata batch is in flight. Do not spend on a message that is no
    // longer in Inbox by the time evaluation starts.
    if (!msg.labelIds?.includes("INBOX")) continue;
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
        ?.value || "";

    messages.push({
      id: msg.id,
      threadId: msg.threadId || msg.id,
      from: getHeader("From"),
      to: getHeader("To"),
      subject: getHeader("Subject"),
      snippet: msg.snippet || "",
      labelIds: msg.labelIds || [],
      date: getHeader("Date"),
    });
  }

  return { messages, newHistoryId };
}

// ─── AI rule evaluation ──────────────────────────────────────────────────────

export interface RuleMatch {
  ruleId: string;
  match: boolean;
  confidence: number;
  reason?: string;
}

const MODEL_AVAILABILITY_CACHE_TTL_MS = 5 * 60 * 1000;
const modelAvailabilityCache = new Map<
  string,
  { ok: boolean; expiresAt: number; error?: string }
>();

function isMissingProviderError(message: string): boolean {
  return /No LLM provider is connected|Connect an LLM provider|missing_credentials/i.test(
    message,
  );
}

async function canUseAutomationModel(
  ownerEmail: string,
  settings: AutomationModelSettings,
): Promise<{
  available: boolean;
  jevCredentials?: JevContextCredentials;
  legacyTypesafeApiKey?: string;
}> {
  if (settings.engine === TYPESAFE_AUTOMATION_ENGINE) {
    return runWithRequestContext(
      { ...getRequestContext(), userEmail: ownerEmail },
      async () => {
        const jevCredentials = await getJevContextCredentials(ownerEmail);
        const legacyTypesafeApiKey =
          readDeployCredentialEnv("TYPESAFE_API_KEY")?.trim() || undefined;
        let available: boolean;
        try {
          available = await isJevEnabled(jevCredentials);
        } catch (error) {
          if (!legacyTypesafeApiKey) throw error;
          console.warn(
            "[automation-engine] Jev entitlement check failed; using the legacy Typesafe deployment key.",
            error,
          );
          available = false;
        }
        return {
          available: available || Boolean(legacyTypesafeApiKey),
          jevCredentials,
          ...(!available && legacyTypesafeApiKey
            ? { legacyTypesafeApiKey }
            : {}),
        };
      },
    );
  }

  const cacheKey = `${ownerEmail}:${settings.engine ?? ""}:${settings.model ?? ""}`;
  const cached = modelAvailabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { available: cached.ok };
  }

  try {
    registerBuiltinEngines();
    await runWithRequestContext({ userEmail: ownerEmail }, async () => {
      const anthropicKey =
        !settings.engine || settings.engine === "anthropic"
          ? await resolveAnthropicKey(ownerEmail)
          : undefined;
      const engine = await resolveEngine({
        engineOption: settings.engine,
        apiKey: anthropicKey,
      });
      if (
        !(await isResolvedEngineUsableForRequest(engine, {
          apiKey: anthropicKey,
        }))
      ) {
        throw new Error("No LLM provider is connected");
      }
    });
    modelAvailabilityCache.set(cacheKey, {
      ok: true,
      expiresAt: Date.now() + MODEL_AVAILABILITY_CACHE_TTL_MS,
    });
    return { available: true };
  } catch (err: any) {
    const message = err?.message || "Automation model unavailable";
    if (!isMissingProviderError(message)) throw err;
    modelAvailabilityCache.set(cacheKey, {
      ok: false,
      error: message,
      expiresAt: Date.now() + MODEL_AVAILABILITY_CACHE_TTL_MS,
    });
    return { available: false };
  }
}

async function callModel(
  prompt: string,
  ownerEmail: string,
  settings: AutomationModelSettings,
  signal?: AbortSignal,
): Promise<string> {
  registerBuiltinEngines();

  return runWithRequestContext({ userEmail: ownerEmail }, async () => {
    const anthropicKey =
      !settings.engine || settings.engine === "anthropic"
        ? await resolveAnthropicKey(ownerEmail)
        : undefined;
    const engine = await resolveEngine({
      engineOption: settings.engine,
      apiKey: anthropicKey,
    });
    const model = settings.model || engine.defaultModel;
    const abortSignal = signal ?? new AbortController().signal;
    let text = "";
    let assistantText = "";
    let usage:
      | {
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        }
      | undefined;

    for await (const event of engine.stream({
      model,
      systemPrompt: "",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
      tools: [],
      abortSignal,
      maxOutputTokens: 2048,
    })) {
      if (event.type === "text-delta") {
        text += event.text;
      } else if (event.type === "assistant-content") {
        assistantText = event.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
      } else if (event.type === "usage") {
        usage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheWriteTokens: event.cacheWriteTokens,
        };
      } else if (event.type === "stop" && event.reason === "error") {
        throw new Error(event.error || "Automation model call failed");
      }
    }

    // Attribute this call under the "automation" label so users can see
    // how much of their spend comes from email rule evaluation vs the
    // main chat in the Usage settings panel.
    if (usage) {
      try {
        const { recordUsage } = await import("@agent-native/core/usage");
        await recordUsage({
          ownerEmail,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.cacheWriteTokens ?? 0,
          model,
          label: "automation",
          app: "mail",
        });
      } catch {
        // Recording is best-effort — never break the automation run.
      }
    }

    return text || assistantText;
  });
}

export async function getAutomationModelSettings(
  ownerEmail: string,
): Promise<AutomationModelSettings> {
  const autoSettings = await getUserSetting(ownerEmail, "automation-settings");
  return resolveAutomationModelSettings(
    ownerEmail,
    autoSettings && typeof autoSettings === "object"
      ? (autoSettings as AutomationModelSettings)
      : null,
  );
}

async function evaluateRulesWithJev(
  emails: EmailSummary[],
  rules: RuleRecord[],
  ownerEmail: string,
  credentials: JevContextCredentials,
  legacyTypesafeApiKey?: string,
): Promise<Map<string, RuleMatch[]>> {
  const questionEntries = emails.flatMap((email, emailIndex) =>
    rules.map((rule, ruleIndex) => {
      const id = `q_${emailIndex}_${ruleIndex}`;
      return [
        id,
        {
          type: "noul",
          instructions: `Does email ${email.id} clearly match this rule: "${rule.condition}"?`,
          criteria: {
            true: "The email clearly matches the user's rule.",
            false: "The email does not match the user's rule.",
          },
        },
      ] as const;
    }),
  );
  const questionIds = new Map(
    questionEntries.map(([id], index) => {
      const email = emails[Math.floor(index / rules.length)];
      const rule = rules[index % rules.length];
      return [id, { emailId: email.id, ruleId: rule.id }] as const;
    }),
  );

  const body = {
    model: "jev-latest",
    state: {
      emails: emails.map((email) => ({
        id: email.id,
        from: email.from,
        to: email.to,
        subject: email.subject,
        snippet: email.snippet,
        labels: email.labelIds,
        date: email.date,
      })),
    },
    questions: Object.fromEntries(questionEntries),
  };

  let payload: JevResponse;
  if (credentials.builderAuth && !legacyTypesafeApiKey) {
    try {
      payload = await requestJevThroughBuilder(credentials.builderAuth, body, {
        timeoutMs: 12_000,
      });
    } catch (error) {
      if (!credentials.personalApiKey) throw error;
      payload = await requestJevDirect(credentials.personalApiKey, body);
    }
  } else if (credentials.personalApiKey) {
    payload = await requestJevDirect(credentials.personalApiKey, body);
  } else if (legacyTypesafeApiKey) {
    payload = await requestJevDirect(legacyTypesafeApiKey, body);
  } else {
    throw new Error("Jev is not enabled.");
  }
  if (
    !payload.answers ||
    typeof payload.answers !== "object" ||
    Array.isArray(payload.answers)
  ) {
    throw new Error("TypeSafe Jev returned no answers.");
  }

  if (payload.usage) {
    try {
      const { recordUsage } = await import("@agent-native/core/usage");
      await recordUsage({
        ownerEmail,
        inputTokens: payload.usage.input_tokens ?? 0,
        outputTokens: payload.usage.output_tokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "jev-latest",
        label: "automation",
        app: "mail",
      });
    } catch (error) {
      // Usage recording is best-effort and must not hide a valid classification.
      console.warn("[automation-engine] Jev usage recording failed:", error);
    }
  }

  const results = new Map<string, RuleMatch[]>(
    emails.map((email) => [email.id, []]),
  );
  const answeredQuestionIds = new Set<string>();
  for (const [questionId, answer] of Object.entries(payload.answers)) {
    const question = questionIds.get(questionId);
    const probability = answer?.noul;
    if (!question) {
      throw new Error("TypeSafe Jev returned an unexpected rule answer.");
    }
    if (
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new Error("TypeSafe Jev returned an invalid rule answer.");
    }
    answeredQuestionIds.add(questionId);
    if (probability >= 0.5) {
      results.get(question.emailId)!.push({
        ruleId: question.ruleId,
        match: true,
        confidence: probability,
        reason: `Jev match probability ${Math.round(probability * 100)}%`,
      });
    }
  }
  if (answeredQuestionIds.size !== questionIds.size) {
    throw new Error("TypeSafe Jev omitted one or more rule answers.");
  }
  return results;
}

async function evaluateRules(
  emails: EmailSummary[],
  rules: RuleRecord[],
  ownerEmail: string,
  modelSettings: AutomationModelSettings,
  aiFilterState?: AiFilterState,
  jevCredentials?: JevContextCredentials,
  legacyTypesafeApiKey?: string,
): Promise<Map<string, RuleMatch[]>> {
  // Returns every message ID, including those classified as no-match.
  const results = new Map<string, RuleMatch[]>(
    emails.map((email) => [email.id, []]),
  );
  const expectedEmailIds = new Set(emails.map((email) => email.id));
  const expectedRuleIds = new Set(rules.map((rule) => rule.id));
  if (
    expectedEmailIds.size !== emails.length ||
    expectedRuleIds.size !== rules.length
  ) {
    throw new Error(
      "Mail AI rule evaluation requires unique email and rule IDs.",
    );
  }
  if (emails.length === 0 || rules.length === 0) return results;

  if (modelSettings.engine === TYPESAFE_AUTOMATION_ENGINE) {
    if (!jevCredentials) throw new Error("Jev is not enabled.");
    return evaluateRulesWithJev(
      emails,
      rules,
      ownerEmail,
      jevCredentials,
      legacyTypesafeApiKey,
    );
  }

  // Process in batches of 10 emails per call
  const batchSize = 10;
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);

    const rulesText = rules
      .map((r, idx) => `${idx + 1}. [id: ${r.id}] Condition: "${r.condition}"`)
      .join("\n");

    const emailsText = batch
      .map(
        (e, idx) =>
          `--- Email ${idx + 1} (id: ${e.id}) ---
From: ${e.from}
To: ${e.to}
Subject: ${e.subject}
Snippet: ${e.snippet}
Labels: [${e.labelIds.join(", ")}]
Date: ${e.date}`,
      )
      .join("\n\n");

    const feedbackText = aiFilterState?.feedback.length
      ? aiFilterState.feedback
          .slice(-20)
          .map(
            (feedback) =>
              `- ${feedback.disposition === "spam" ? "Unwanted" : "Keep"}: From ${feedback.sender}; Subject "${feedback.subject}"${feedback.comment ? `; Note: "${feedback.comment}"` : ""}`,
          )
          .join("\n")
      : "None yet.";

    const prompt = `You are an email classification engine. Given emails and a set of rules, determine which rules match each email.

Rules:
${rulesText}

Emails:
${emailsText}

User-confirmed examples (use these as feedback, not as absolute rules):
${feedbackText}

For each email, evaluate ALL rules. Include one result for every rule, even when it does not match, and never omit an email or rule. Respond with ONLY a JSON array, no other text. Format:
[{"emailId": "<id>", "matches": [{"ruleId": "<id>", "match": true/false, "confidence": 0.0, "reason": "short explanation"}]}]

Be precise: only mark a rule as matching if the email clearly fits the condition. When a condition mentions a specific sender, check the From field. When it mentions a topic or category, use the subject and snippet. Confidence must be between 0 and 1. Give a short reason for every match.`;

    const text = await callModel(prompt, ownerEmail, modelSettings);

    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = text
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed: unknown = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      throw new Error("Model returned a non-array result.");
    }

    const batchEmailIds = new Set(batch.map((email) => email.id));
    const classifiedEmailIds = new Set<string>();
    for (const emailResult of parsed) {
      if (
        !emailResult ||
        typeof emailResult !== "object" ||
        typeof emailResult.emailId !== "string" ||
        !Array.isArray(emailResult.matches)
      ) {
        throw new Error("Model returned an invalid email classification.");
      }
      if (
        !batchEmailIds.has(emailResult.emailId) ||
        classifiedEmailIds.has(emailResult.emailId)
      ) {
        throw new Error("Model returned an unexpected email classification.");
      }
      if (emailResult.matches.length !== expectedRuleIds.size) {
        throw new Error("Model returned an incomplete rule classification.");
      }
      classifiedEmailIds.add(emailResult.emailId);

      const matchedRules: RuleMatch[] = [];
      const classifiedRuleIds = new Set<string>();
      for (const match of emailResult.matches) {
        if (
          !match ||
          typeof match !== "object" ||
          typeof match.ruleId !== "string" ||
          !expectedRuleIds.has(match.ruleId) ||
          classifiedRuleIds.has(match.ruleId) ||
          typeof match.match !== "boolean"
        ) {
          throw new Error("Model returned an invalid rule classification.");
        }
        classifiedRuleIds.add(match.ruleId);
        if (!match.match) continue;
        if (
          typeof match.confidence !== "number" ||
          !Number.isFinite(match.confidence) ||
          match.confidence < 0 ||
          match.confidence > 1
        ) {
          throw new Error("Model returned an invalid rule confidence.");
        }
        matchedRules.push({
          ruleId: match.ruleId,
          match: true,
          confidence: match.confidence,
          ...(typeof match.reason === "string"
            ? { reason: match.reason.slice(0, 500) }
            : {}),
        });
      }
      if (classifiedRuleIds.size !== expectedRuleIds.size) {
        throw new Error("Model returned an incomplete rule classification.");
      }
      results.set(emailResult.emailId, matchedRules);
    }
    if (classifiedEmailIds.size !== batchEmailIds.size) {
      throw new Error("Model omitted one or more email classifications.");
    }
  }

  return results;
}

type PriorityScore = {
  score: number;
  reason?: string;
};

async function evaluatePriorityWithJev(
  emails: EmailSummary[],
  instruction: string,
  ownerEmail: string,
  credentials: JevContextCredentials,
  signal?: AbortSignal,
): Promise<Map<string, PriorityScore>> {
  const { builderAuth, personalApiKey } = credentials;
  if (!personalApiKey && !builderAuth) {
    throw new Error("Jev is not enabled.");
  }

  const questions = Object.fromEntries(
    emails.map((email, index) => [
      `q_${index}`,
      {
        type: "noul",
        instructions: `Should email ${email.id} be prioritized for the user? Follow this guidance: "${instruction}"`,
        criteria: {
          true: "The email deserves a higher place in the user's inbox.",
          false: "The email can safely be lower in the inbox.",
        },
      },
    ]),
  );
  const body = {
    model: "jev-latest",
    state: {
      emails: emails.map((email) => ({
        id: email.id,
        from: email.from,
        to: email.to,
        subject: email.subject,
        snippet: email.snippet,
        date: email.date,
      })),
    },
    questions,
  };

  const request: Record<string, unknown> = { ...body };
  let payload: JevResponse;
  if (builderAuth) {
    try {
      payload = await requestJevThroughBuilder(builderAuth, request, {
        signal,
        timeoutMs: 12_000,
      });
    } catch (error) {
      if (!personalApiKey) throw error;
      payload = await requestJevDirect(personalApiKey, request, signal);
    }
  } else if (personalApiKey) {
    payload = await requestJevDirect(personalApiKey, request, signal);
  } else {
    throw new Error("Jev is not enabled.");
  }
  if (!payload.answers || typeof payload.answers !== "object") {
    throw new Error("TypeSafe Jev returned no answers.");
  }

  if (payload.usage) {
    try {
      const { recordUsage } = await import("@agent-native/core/usage");
      await recordUsage({
        ownerEmail,
        inputTokens: payload.usage.input_tokens ?? 0,
        outputTokens: payload.usage.output_tokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "jev-latest",
        label: "automation",
        app: "mail",
      });
    } catch (error) {
      console.warn("[automation-engine] Jev usage recording failed:", error);
    }
  }

  const results = new Map<string, PriorityScore>();
  emails.forEach((email, index) => {
    const probability = payload.answers?.[`q_${index}`]?.noul;
    if (
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      return;
    }
    results.set(email.id, {
      score: probability,
      reason: `Jev priority probability ${Math.round(probability * 100)}%`,
    });
  });
  return results;
}

async function requestJevDirect(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<JevResponse> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal?.throwIfAborted();
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
    });
    if (response.ok) return (await response.json()) as JevResponse;
    if (attempt === 0 && (response.status === 429 || response.status === 529)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `TypeSafe Jev request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  throw new Error("TypeSafe Jev request failed.");
}

export async function previewAutomationPriority(
  emails: AiPriorityEmail[],
  ownerEmail: string,
  instruction = AI_PRIORITY_DEFAULT_INSTRUCTION,
  jevCredentials: JevContextCredentials,
  signal?: AbortSignal,
): Promise<{
  scores: Map<string, PriorityScore>;
  model: AutomationModelSettings;
}> {
  if (!jevCredentials.personalApiKey && !jevCredentials.builderAuth) {
    throw new Error("Jev is not enabled.");
  }
  const model = {
    engine: TYPESAFE_AUTOMATION_ENGINE,
    model: TYPESAFE_AUTOMATION_MODEL,
  };

  const messages = emails
    .filter(
      (email) =>
        !email.isArchived &&
        !email.isTrashed &&
        mailLabelsInclude(email.labelIds, "inbox"),
    )
    .map((email, index) => ({
      key: aiPriorityEmailKey(email.accountEmail, email.id),
      summary: {
        id: `priority-${index}`,
        threadId: email.threadId,
        from: email.from,
        to: email.to,
        subject: email.subject,
        snippet: email.snippet,
        labelIds: email.labelIds,
        date: email.date,
      },
    }));

  const scores = new Map<string, PriorityScore>();
  const batches = Array.from(
    { length: Math.ceil(messages.length / 50) },
    (_, i) => messages.slice(i * 50, (i + 1) * 50),
  );
  for (let i = 0; i < batches.length; i += 3) {
    signal?.throwIfAborted();
    const wave = batches.slice(i, i + 3);
    const batchScores = await Promise.all(
      wave.map((batch) =>
        evaluatePriorityWithJev(
          batch.map(({ summary }) => summary),
          instruction,
          ownerEmail,
          jevCredentials,
          signal,
        ),
      ),
    );
    for (const [batchIndex, batch] of wave.entries()) {
      for (const { key, summary } of batch) {
        const score = batchScores[batchIndex].get(summary.id);
        if (score) scores.set(key, score);
      }
    }
  }
  return { scores, model };
}

export async function previewAutomationRules(
  emails: AiFilterPreviewEmail[],
  rules: AiFilterPreviewRule[],
  ownerEmail: string,
  aiFilterState: AiFilterState,
): Promise<{
  matches: Map<string, RuleMatch[]>;
  model: AutomationModelSettings;
}> {
  const model = await getAutomationModelSettings(ownerEmail);
  const modelAccess = await canUseAutomationModel(ownerEmail, model);
  if (!modelAccess.available) {
    throw new Error("No LLM provider is connected for Mail AI rules.");
  }
  const messages: EmailSummary[] = emails
    .filter((email) => !email.isArchived && !email.isTrashed)
    .map((email) => ({
      id: email.id,
      threadId: email.threadId,
      from: email.from,
      to: email.to,
      subject: email.subject,
      snippet: email.snippet,
      labelIds: email.labelIds,
      date: email.date,
    }));
  const records: RuleRecord[] = rules.map((rule) => ({
    id: rule.id,
    ownerEmail,
    domain: "mail",
    kind: "ai-filter",
    name: rule.name,
    condition: rule.condition,
    actions: JSON.stringify(rule.actions),
    enabled: 1,
    createdAt: 0,
    updatedAt: 0,
  }));
  const matches = await evaluateRules(
    messages,
    records,
    ownerEmail,
    model,
    aiFilterState,
    modelAccess.jevCredentials,
    modelAccess.legacyTypesafeApiKey,
  );
  return { matches, model };
}

/**
 * Evaluate the same AI-filter rule engine for a captured backfill batch.
 * Unlike interactive preview, a run may retry after its own archive action,
 * so the immutable run snapshot is evaluated even when the live thread is now
 * archived.
 */
export async function evaluateAiFilterBackfillRules(
  emails: AiFilterPreviewEmail[],
  rules: AiFilterPreviewRule[],
  ownerEmail: string,
  aiFilterState: AiFilterState,
): Promise<Map<string, RuleMatch[]>> {
  const model = await getAutomationModelSettings(ownerEmail);
  const modelAccess = await canUseAutomationModel(ownerEmail, model);
  if (!modelAccess.available) {
    throw new Error("No LLM provider is connected for Mail AI rules.");
  }
  const messages: EmailSummary[] = emails.map((email) => ({
    id: email.id,
    threadId: email.threadId,
    from: email.from,
    to: email.to,
    subject: email.subject,
    snippet: email.snippet,
    labelIds: email.labelIds,
    date: email.date,
  }));
  const records: RuleRecord[] = rules.map((rule) => ({
    id: rule.id,
    ownerEmail,
    domain: "mail",
    kind: "ai-filter",
    name: rule.name,
    condition: rule.condition,
    actions: JSON.stringify(rule.actions),
    enabled: 1,
    createdAt: 0,
    updatedAt: 0,
  }));
  return evaluateRules(
    messages,
    records,
    ownerEmail,
    model,
    aiFilterState,
    modelAccess.jevCredentials,
    modelAccess.legacyTypesafeApiKey,
  );
}

export async function rewriteAutomationRuleCondition(
  ownerEmail: string,
  rule: AiFilterPreviewRule,
  corrections: AiFilterPreviewCorrection[],
  comment?: string,
): Promise<string> {
  const model = await resolveTextAutomationModelSettings(ownerEmail);
  const actionDescription = rule.actions.some(
    (action) => action.type === "archive",
  )
    ? "spam filter"
    : "tag rule";
  const examples = corrections
    .map(
      (correction) =>
        `- SHOULD ${correction.expectedMatch ? "MATCH" : "NOT MATCH"}: From ${correction.sender}; Subject "${correction.subject}"; Snippet "${correction.snippet}"`,
    )
    .join("\n");
  const prompt = `Rewrite one email ${actionDescription} instruction using the user's corrections.

Current instruction: ${rule.condition}
Corrections:
${examples || "None"}
User note: ${comment?.trim() || "None"}

Return only the replacement instruction as one clear sentence. Keep the user's intent, incorporate the examples, and avoid mentioning AI, corrections, or this prompt.`;
  let text: string;
  if (!model.engine && !model.model) {
    text = [
      rule.condition.trim(),
      comment?.trim() ? `Additional guidance: ${comment.trim()}` : "",
      ...corrections.map(
        (correction) =>
          `Example to ${correction.expectedMatch ? "include" : "exclude"}: ${correction.subject} from ${correction.sender}`,
      ),
    ]
      .filter(Boolean)
      .join(". ");
  } else {
    text = await callModel(prompt, ownerEmail, model);
  }
  const rewritten = text
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!rewritten || rewritten.length > 2_000) {
    throw new Error(
      "The text model returned an invalid Mail rule instruction.",
    );
  }
  return rewritten;
}

// ─── Main processor ──────────────────────────────────────────────────────────

export interface ProcessResult {
  accountEmail: string;
  messagesProcessed: number;
  actionsExecuted: number;
  errors: number;
  suggestionsCreated: number;
}

export async function processAutomationsForAccount(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
): Promise<ProcessResult> {
  const result: ProcessResult = {
    accountEmail,
    messagesProcessed: 0,
    actionsExecuted: 0,
    errors: 0,
    suggestionsCreated: 0,
  };

  // 1. Load active rules and keep the AI filter's learned baseline
  // conservative until it has several confirmed examples.
  const aiFilterState = await getAiFilterState(ownerEmail);
  const rules = (await loadActiveRules(ownerEmail, "mail")).filter(
    (rule) =>
      rule.kind !== "ai-filter" ||
      (aiFilterState.enabled &&
        (rule.name !== AI_FILTER_RULE_NAME ||
          aiFilterState.feedback.length >= AI_FILTER_MIN_LEARNED_EXAMPLES)),
  );
  if (rules.length === 0) return result;

  // 2. Resolve model settings. Credentials are resolved by the selected engine
  // under the owner's request context, so Builder-managed models work here too.
  const modelSettings = await getAutomationModelSettings(ownerEmail);
  let modelAccess: Awaited<ReturnType<typeof canUseAutomationModel>>;
  try {
    modelAccess = await canUseAutomationModel(ownerEmail, modelSettings);
  } catch (error) {
    console.error(
      "[automation-engine] Model availability check failed:",
      error,
    );
    result.errors = 1;
    return result;
  }
  if (!modelAccess.available) {
    result.errors = 1;
    return result;
  }

  // 3. Get watermark and processed IDs
  const watermark = await getWatermark(ownerEmail);
  const processedIds = await getProcessedIds(ownerEmail);

  // 4. Fetch new inbox messages
  const { messages, newHistoryId } = await fetchNewInboxMessages(
    accessToken,
    watermark,
    processedIds,
  );

  if (messages.length === 0) {
    // Still update historyId if we got one
    if (newHistoryId) {
      await setWatermark(ownerEmail, {
        lastHistoryId: newHistoryId,
        lastTimestamp: Date.now(),
      });
    }
    return result;
  }

  result.messagesProcessed = messages.length;

  // 4b. Emit event-bus events for each new message (best-effort)
  for (const msg of messages) {
    try {
      emit(
        "mail.message.received",
        {
          messageId: msg.id,
          from: msg.from,
          to: msg.to,
          subject: msg.subject,
          snippet: msg.snippet,
          labels: msg.labelIds,
          threadId: msg.threadId,
        },
        { owner: ownerEmail },
      );
    } catch {
      // best-effort — never block the automation run
    }
  }

  // 5. Evaluate rules with AI
  const matches = await evaluateRules(
    messages,
    rules,
    ownerEmail,
    modelSettings,
    aiFilterState,
    modelAccess.jevCredentials,
    modelAccess.legacyTypesafeApiKey,
  );

  // 6. Execute matched actions
  if ([...matches.values()].some((matchedRules) => matchedRules.length > 0)) {
    const labelCache = await buildLabelCache(accessToken);
    const rulesById = new Map(rules.map((r) => [r.id, r]));
    const aiDecisions: AiFilterDecision[] = [];

    for (const [messageId, matchedRules] of matches) {
      const message = messages.find((candidate) => candidate.id === messageId);
      if (!message) continue;

      for (const matchedRule of matchedRules) {
        const ruleId = matchedRule.ruleId;
        const rule = rulesById.get(ruleId);
        if (!rule) continue;

        const actions = JSON.parse(rule.actions) as AutomationAction[];
        const ctx: ActionContext = {
          accessToken,
          messageId,
          ownerEmail,
          accountEmail,
          labelCache,
        };

        if (rule.kind === "ai-filter") {
          const isSpamRule = actions.some(
            (action) => action.type === "archive",
          );
          const shouldAct = isSpamRule
            ? aiFilterState.autoFilter &&
              matchedRule.confidence >= aiFilterState.autoFilterThreshold
            : matchedRule.confidence >= aiFilterState.suggestionThreshold;

          if (shouldAct) {
            const { successes, failures } = await executeActions(actions, ctx);
            result.actionsExecuted += successes;
            result.errors += failures;
            if (isSpamRule) {
              const decisionBase = {
                id: nanoid(12),
                messageId,
                threadId: message.threadId,
                accountEmail,
                sender: message.from.slice(0, 320),
                subject: message.subject.slice(0, 500),
                confidence: matchedRule.confidence,
                ...(matchedRule.reason ? { reason: matchedRule.reason } : {}),
                source: "automatic" as const,
                createdAt: Date.now(),
              };
              if (successes > 0) {
                aiDecisions.push({
                  ...decisionBase,
                  disposition: "filtered",
                });
              }
            }
          } else if (
            isSpamRule &&
            matchedRule.confidence >= aiFilterState.suggestionThreshold
          ) {
            aiDecisions.push({
              id: nanoid(12),
              messageId,
              threadId: message.threadId,
              accountEmail,
              sender: message.from.slice(0, 320),
              subject: message.subject.slice(0, 500),
              confidence: matchedRule.confidence,
              ...(matchedRule.reason ? { reason: matchedRule.reason } : {}),
              disposition: "suggested",
              source: "automatic",
              createdAt: Date.now(),
            });
            result.suggestionsCreated += 1;
          }
          continue;
        }

        const { successes, failures } = await executeActions(actions, ctx);
        result.actionsExecuted += successes;
        result.errors += failures;
      }
    }

    await recordAiFilterDecisions(ownerEmail, aiDecisions);
  }

  // 7. Update watermark
  await setWatermark(ownerEmail, {
    lastHistoryId: newHistoryId || watermark.lastHistoryId,
    lastTimestamp: Date.now(),
  });

  // 8. Mark messages as processed
  for (const msg of messages) processedIds.add(msg.id);
  await saveProcessedIds(ownerEmail, processedIds);

  return result;
}

/**
 * Process automations for all connected accounts.
 */
export async function processAutomations(ownerEmail?: string): Promise<{
  result: string;
  details: ProcessResult[];
}> {
  const accounts = ownerEmail
    ? await listOAuthAccountsByOwner("google", ownerEmail)
    : await listOAuthAccounts("google");
  const details: ProcessResult[] = [];

  for (const account of accounts) {
    const accessToken = await getAccessToken(account.accountId);
    if (!accessToken) continue;

    const accountOwnerEmail =
      (account as any).owner || ownerEmail || account.accountId;

    try {
      const result = await processAutomationsForAccount(
        accountOwnerEmail,
        account.accountId,
        accessToken,
      );
      details.push(result);
    } catch (err: any) {
      console.error(
        `[automation-engine] Failed for ${account.accountId}:`,
        err.message,
      );
      details.push({
        accountEmail: account.accountId,
        messagesProcessed: 0,
        actionsExecuted: 0,
        errors: 1,
        suggestionsCreated: 0,
      });
    }
  }

  const totalProcessed = details.reduce(
    (sum, d) => sum + d.messagesProcessed,
    0,
  );
  const totalActions = details.reduce((sum, d) => sum + d.actionsExecuted, 0);
  const totalSuggestions = details.reduce(
    (sum, d) => sum + d.suggestionsCreated,
    0,
  );

  return {
    result: `Processed ${totalProcessed} messages, executed ${totalActions} actions, created ${totalSuggestions} suggestions`,
    details,
  };
}

// ─── In-memory debounce for focus trigger ────────────────────────────────────

const _lastTriggerTimeByOwner = new Map<string, number>();
const TRIGGER_DEBOUNCE_MS = 30_000;

export async function triggerAutomationsDebounced(ownerEmail: string): Promise<{
  triggered: boolean;
  reason?: string;
}> {
  const now = Date.now();
  const lastTriggerTime = _lastTriggerTimeByOwner.get(ownerEmail) ?? 0;
  if (now - lastTriggerTime < TRIGGER_DEBOUNCE_MS) {
    return { triggered: false, reason: "debounced" };
  }
  _lastTriggerTimeByOwner.set(ownerEmail, now);

  // Fire and forget
  processAutomations(ownerEmail).catch((err) =>
    console.error("[automation-engine] Trigger failed:", err),
  );

  return { triggered: true };
}
