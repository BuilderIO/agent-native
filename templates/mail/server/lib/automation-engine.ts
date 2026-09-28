import {
  isResolvedEngineUsableForRequest,
  registerBuiltinEngines,
  resolveEngine,
} from "@agent-native/core/agent/engine";
import { resolveCredential } from "@agent-native/core/credentials";
import { emitAsync, listSubscriptions } from "@agent-native/core/event-bus";
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
import {
  getUserSetting,
  mutateUserSetting,
  putUserSetting,
} from "@agent-native/core/settings";
import { refreshEventSubscriptions } from "@agent-native/core/triggers";
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
  registerGmailAccountToken,
} from "./google-api.js";
import { getOAuth2Credentials } from "./google-auth.js";

const MAX_EMAILS_PER_RUN = 50;
const MAX_PENDING_NOTIFICATION_ATTEMPTS = 8;
const MAX_PENDING_NOTIFICATION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RULE_EVALUATION_PAIRS_PER_MODEL_CALL = 32;
const MAX_PROCESSED_IDS = 500;
const PROCESSED_IDS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AUTOMATION_POLL_LEASE_MS = 5 * 60 * 1000;

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

interface Watermark {
  lastHistoryId?: string;
  pageToken?: string;
  pendingHistoryId?: string;
  fallbackPageToken?: string;
  pendingMessageIds?: string[];
  lastTimestamp: number;
}

interface ProcessedIds {
  ids: string[];
  updatedAt: number;
}

interface PendingNotificationAction {
  ruleId: string;
  messageId: string;
  from: string;
  subject: string;
  snippet: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  committed?: boolean;
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

async function getAccessToken(
  accountEmail: string,
  ownerEmail: string,
): Promise<string | null> {
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
      registerGmailAccountToken(refreshed.access_token, ownerEmail, accountEmail);
      return refreshed.access_token;
    } catch (err: any) {
      console.error(
        `[automation-engine] Token refresh failed for ${accountEmail}:`,
        err.message,
      );
    }
  }

  registerGmailAccountToken(tokens.access_token, ownerEmail, accountEmail);
  return tokens.access_token;
}

async function getWatermark(
  ownerEmail: string,
  signal?: AbortSignal,
): Promise<Watermark> {
  const data = await getUserSetting(ownerEmail, "automation-watermark");
  throwIfAborted(signal);
  if (data && typeof data === "object") return data as unknown as Watermark;
  return { lastTimestamp: 0 };
}

async function setWatermark(
  ownerEmail: string,
  watermark: Watermark,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await putUserSetting(ownerEmail, "automation-watermark", watermark as any);
  throwIfAborted(signal);
}

async function getProcessedIds(
  ownerEmail: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const data = await getUserSetting(ownerEmail, "automation-processed-ids");
  throwIfAborted(signal);
  if (data && typeof data === "object") {
    const stored = data as unknown as ProcessedIds;
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
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const arr = [...ids].slice(-MAX_PROCESSED_IDS);
  await putUserSetting(ownerEmail, "automation-processed-ids", {
    ids: arr,
    updatedAt: Date.now(),
  } as any);
  throwIfAborted(signal);
}

function pendingNotificationSettingKey(accountEmail: string): string {
  return `mail-automation-pending-notifications:${accountEmail.trim().toLowerCase()}`;
}

function pendingNotificationActionKey(
  ruleId: string,
  messageId: string,
): string {
  return JSON.stringify([ruleId, messageId]);
}

function mailNotificationIdempotencyKey(
  ruleId: string,
  accountEmail: string,
  messageId: string,
): string {
  return `mail-rule:${ruleId}:${accountEmail.trim().toLowerCase()}:${messageId}`;
}

function isPendingNotificationAction(
  value: unknown,
): value is PendingNotificationAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  return (
    typeof action.ruleId === "string" &&
    typeof action.messageId === "string" &&
    typeof action.from === "string" &&
    typeof action.subject === "string" &&
    typeof action.snippet === "string" &&
    typeof action.createdAt === "number" &&
    Number.isFinite(action.createdAt) &&
    typeof action.attempts === "number" &&
    Number.isInteger(action.attempts) &&
    action.attempts > 0 &&
    typeof action.nextAttemptAt === "number" &&
    Number.isFinite(action.nextAttemptAt)
  );
}

async function getPendingNotificationActions(
  ownerEmail: string,
  accountEmail: string,
  signal?: AbortSignal,
): Promise<PendingNotificationAction[]> {
  const value = await getUserSetting(
    ownerEmail,
    pendingNotificationSettingKey(accountEmail),
  );
  throwIfAborted(signal);
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isPendingNotificationAction)) {
    throw new Error("The saved Mail notification retries are unreadable.");
  }
  return value;
}

async function retryPendingNotificationActions(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  processedIds: Set<string>,
  pendingActions: PendingNotificationAction[],
  signal?: AbortSignal,
): Promise<{
  pendingActions: PendingNotificationAction[];
  errors: number;
  successes: number;
}> {
  const ready: PendingNotificationAction[] = [];
  const deferred: PendingNotificationAction[] = [];
  const now = Date.now();
  let errors = 0;
  for (const action of pendingActions) {
    throwIfAborted(signal);
    if (
      action.attempts >= MAX_PENDING_NOTIFICATION_ATTEMPTS ||
      now - action.createdAt >= MAX_PENDING_NOTIFICATION_AGE_MS
    ) {
      errors += 1;
      console.error(
        `[automation-engine] Dropping exhausted Notify retry for rule ${action.ruleId} and message ${action.messageId}.`,
      );
    } else if (
      ready.length < MAX_EMAILS_PER_RUN &&
      (action.committed === true || processedIds.has(action.messageId)) &&
      action.nextAttemptAt <= now
    ) {
      ready.push(action);
    } else {
      deferred.push(action);
    }
  }

  const failed: PendingNotificationAction[] = [];
  let successes = 0;
  for (const action of ready) {
    throwIfAborted(signal);
    const result = await executeActions([{ type: "notify" }], {
      accessToken,
      messageId: action.messageId,
      ownerEmail,
      accountEmail,
      labelCache: new Map(),
      signal,
      notificationIdempotencyKey: mailNotificationIdempotencyKey(
        action.ruleId,
        accountEmail,
        action.messageId,
      ),
      from: action.from,
      subject: action.subject,
      snippet: action.snippet,
    });
    throwIfAborted(signal);
    if (result.failures > 0) {
      errors += result.failures;
      const attempts = action.attempts + 1;
      if (
        attempts >= MAX_PENDING_NOTIFICATION_ATTEMPTS ||
        Date.now() - action.createdAt >= MAX_PENDING_NOTIFICATION_AGE_MS
      ) {
        console.error(
          `[automation-engine] Notify retry limit reached for rule ${action.ruleId} and message ${action.messageId}.`,
        );
      } else {
        failed.push({
          ...action,
          attempts,
          nextAttemptAt:
            Date.now() + Math.min(60_000, 1_000 * 2 ** (attempts - 1)),
        });
      }
    } else {
      successes += result.successes;
    }
  }

  const remaining = [...deferred, ...failed];
  if (pendingActions.length !== remaining.length || ready.length > 0) {
    throwIfAborted(signal);
    await putUserSetting(
      ownerEmail,
      pendingNotificationSettingKey(accountEmail),
      remaining as any,
    );
  }
  return { pendingActions: remaining, errors, successes };
}

function receivedEventSettingKey(
  accountEmail: string,
  suffix: "watermark" | "processed-ids",
): string {
  return `mail-received-events:${accountEmail.trim().toLowerCase()}:${suffix}`;
}

function automationPollLeaseSettingKey(accountEmail: string): string {
  return `mail-automation-poll:${accountEmail.trim().toLowerCase()}:lease`;
}

async function claimAutomationPoll(
  ownerEmail: string,
  accountEmail: string,
): Promise<string | null> {
  const key = automationPollLeaseSettingKey(accountEmail);
  const claimToken = nanoid(24);
  let claimed = false;
  await mutateUserSetting(ownerEmail, key, (current) => {
    claimed = false;
    if (
      typeof current?.claimToken === "string" &&
      typeof current.leaseUntil === "number" &&
      current.leaseUntil > Date.now()
    ) {
      return current;
    }
    claimed = true;
    return { claimToken, leaseUntil: Date.now() + AUTOMATION_POLL_LEASE_MS };
  });
  return claimed ? claimToken : null;
}

async function releaseAutomationPoll(
  ownerEmail: string,
  accountEmail: string,
  claimToken: string,
): Promise<void> {
  await mutateUserSetting(
    ownerEmail,
    automationPollLeaseSettingKey(accountEmail),
    (current) =>
      current?.claimToken === claimToken
        ? { claimToken: "", leaseUntil: 0 }
        : (current ?? {}),
  );
}

async function assertAutomationPollClaim(
  ownerEmail: string,
  accountEmail: string,
  claimToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const claim = await getUserSetting(
    ownerEmail,
    automationPollLeaseSettingKey(accountEmail),
  );
  throwIfAborted(signal);
  if (
    claim?.claimToken !== claimToken ||
    typeof claim.leaseUntil !== "number" ||
    claim.leaseUntil <= Date.now()
  ) {
    throw new Error(
      `The Mail automation poll lease expired for ${accountEmail}.`,
    );
  }
}

async function refreshReceivedEventCursor(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const watermarkKey = receivedEventSettingKey(accountEmail, "watermark");
  const profile = await gmailGetProfile(accessToken, "incremental", false, signal);
  throwIfAborted(signal);
  if (typeof profile.historyId !== "string" || !profile.historyId) {
    throw new Error("Gmail did not return a history cursor for Mail events.");
  }
  await putUserSetting(ownerEmail, watermarkKey, {
    lastHistoryId: profile.historyId,
    lastTimestamp: Date.now(),
  } as any);
  throwIfAborted(signal);
}

async function emitNewReceivedEvents(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<number> {
  const watermarkKey = receivedEventSettingKey(accountEmail, "watermark");
  const storedWatermark = await getUserSetting(ownerEmail, watermarkKey);
  throwIfAborted(signal);
  if (storedWatermark === null || storedWatermark === undefined) {
    // Do not replay the recent inbox on first poll; only subsequent arrivals start automations.
    await refreshReceivedEventCursor(
      ownerEmail,
      accountEmail,
      accessToken,
      signal,
    );
    return 0;
  }
  if (
    typeof storedWatermark !== "object" ||
    Array.isArray(storedWatermark) ||
    typeof (storedWatermark as any).lastHistoryId !== "string" ||
    !(storedWatermark as any).lastHistoryId ||
    !Number.isFinite((storedWatermark as any).lastTimestamp) ||
    ((storedWatermark as any).pageToken !== undefined &&
      (typeof (storedWatermark as any).pageToken !== "string" ||
        !(storedWatermark as any).pageToken)) ||
    ((storedWatermark as any).pendingHistoryId !== undefined &&
      (typeof (storedWatermark as any).pendingHistoryId !== "string" ||
        !(storedWatermark as any).pendingHistoryId)) ||
    ((storedWatermark as any).fallbackPageToken !== undefined &&
      (typeof (storedWatermark as any).fallbackPageToken !== "string" ||
        !(storedWatermark as any).fallbackPageToken)) ||
    ((storedWatermark as any).pendingMessageIds !== undefined &&
      (!Array.isArray((storedWatermark as any).pendingMessageIds) ||
        !(storedWatermark as any).pendingMessageIds.every(
          (id: unknown) => typeof id === "string",
        )))
  ) {
    throw new Error("The saved Mail event cursor is unreadable.");
  }

  const storedIds = await getUserSetting(
    ownerEmail,
    receivedEventSettingKey(accountEmail, "processed-ids"),
  );
  let processedIds = new Set<string>();
  if (storedIds !== null && storedIds !== undefined) {
    if (
      typeof storedIds !== "object" ||
      Array.isArray(storedIds) ||
      !Array.isArray((storedIds as any).ids) ||
      !(storedIds as any).ids.every((id: unknown) => typeof id === "string") ||
      !Number.isFinite((storedIds as any).updatedAt)
    ) {
      throw new Error("The saved Mail event message list is unreadable.");
    }
    if (Date.now() - (storedIds as any).updatedAt <= PROCESSED_IDS_MAX_AGE_MS) {
      processedIds = new Set<string>((storedIds as any).ids);
    }
  }
  const watermark = storedWatermark as unknown as Watermark;
  const {
    messages,
    watermark: nextWatermark,
    error: fetchError,
  } = await fetchNewInboxMessages(
    accessToken,
    accountEmail,
    watermark,
    processedIds,
    signal,
  );

  for (const message of messages) {
    throwIfAborted(signal);
    await emitAsync(
      "mail.message.received",
      {
        messageId: message.id,
        accountEmail,
        from: message.from,
        to: message.to,
        subject: message.subject,
        snippet: message.snippet,
        labels: message.labelIds,
        threadId: message.threadId,
      },
      {
        owner: ownerEmail,
        eventId: `mail.message.received:${accountEmail.trim().toLowerCase()}:${message.id}`,
      },
    );
    throwIfAborted(signal);
    processedIds.add(message.id);
  }

  throwIfAborted(signal);
  await putUserSetting(ownerEmail, watermarkKey, nextWatermark as any);
  throwIfAborted(signal);
  await putUserSetting(
    ownerEmail,
    receivedEventSettingKey(accountEmail, "processed-ids"),
    {
      ids: [...processedIds].slice(-MAX_PROCESSED_IDS),
      updatedAt: Date.now(),
    } as any,
  );
  throwIfAborted(signal);
  if (fetchError) throw fetchError;
  return messages.length;
}

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

export interface EmailSummary {
  id: string;
  threadId: string;
  accountEmail?: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  labelIds: string[];
  date: string;
  receivedAt?: number;
}

async function fetchNewInboxMessages(
  accessToken: string,
  accountEmail: string,
  watermark: Watermark,
  processedIds: Set<string>,
  signal?: AbortSignal,
): Promise<{ messages: EmailSummary[]; watermark: Watermark; error?: Error }> {
  throwIfAborted(signal);
  let messageIds = (watermark.pendingMessageIds || []).filter(
    (id) => !processedIds.has(id),
  );
  let nextWatermark: Watermark = {
    ...(watermark.lastHistoryId
      ? { lastHistoryId: watermark.lastHistoryId }
      : {}),
    ...(watermark.fallbackPageToken
      ? { fallbackPageToken: watermark.fallbackPageToken }
      : {}),
    lastTimestamp: Date.now(),
  };
  let fallbackToList = !watermark.lastHistoryId;

  if (watermark.lastHistoryId) {
    let pageToken = watermark.pageToken;
    let historyId = watermark.pendingHistoryId;
    while (messageIds.length < MAX_EMAILS_PER_RUN) {
      let history: any;
      try {
        history = await gmailListHistory(
          accessToken,
          {
            startHistoryId: watermark.lastHistoryId,
            historyTypes: ["messageAdded"],
            labelId: "INBOX",
            maxResults: MAX_EMAILS_PER_RUN,
            ...(pageToken ? { pageToken } : {}),
          },
          "incremental",
          signal,
        );
        throwIfAborted(signal);
      } catch (err: any) {
        if (signal?.aborted) signal.throwIfAborted();
        if (err instanceof Error && err.name === "AbortError") throw err;
        if (pageToken) throw err;
        console.warn(
          "[automation-engine] History list failed, falling back to message list:",
          err.message,
        );
        if (watermark.fallbackPageToken) {
          // Keep the original cursor until the fallback pages are drained.
          break;
        }
        nextWatermark = {
          lastTimestamp: Date.now(),
        };
        fallbackToList = true;
        break;
      }

      historyId = history.historyId || historyId;
      const queuedMessageIds = new Set(messageIds);
      for (const entry of history.history || []) {
        for (const added of entry.messagesAdded || []) {
          const id = added.message?.id;
          if (
            id &&
            added.message.labelIds?.includes("INBOX") &&
            !processedIds.has(id) &&
            !queuedMessageIds.has(id)
          ) {
            messageIds.push(id);
            queuedMessageIds.add(id);
          }
        }
      }

      pageToken = history.nextPageToken;
      if (messageIds.length >= MAX_EMAILS_PER_RUN) break;
      if (!pageToken) {
        nextWatermark = {
          lastHistoryId: historyId || watermark.lastHistoryId,
          ...(watermark.fallbackPageToken
            ? { fallbackPageToken: watermark.fallbackPageToken }
            : {}),
          lastTimestamp: Date.now(),
        };
        historyId = undefined;
        break;
      }
    }

    const pendingMessageIds = messageIds.slice(MAX_EMAILS_PER_RUN);
    messageIds = messageIds.slice(0, MAX_EMAILS_PER_RUN);
    if (pageToken || pendingMessageIds.length > 0) {
      nextWatermark = {
        lastHistoryId: pageToken
          ? watermark.lastHistoryId
          : historyId || watermark.lastHistoryId,
        ...(pageToken ? { pageToken } : {}),
        ...(pageToken && historyId ? { pendingHistoryId: historyId } : {}),
        ...(watermark.fallbackPageToken
          ? { fallbackPageToken: watermark.fallbackPageToken }
          : {}),
        ...(pendingMessageIds.length ? { pendingMessageIds } : {}),
        lastTimestamp: Date.now(),
      };
    } else if (historyId) {
      nextWatermark = {
        lastHistoryId: historyId,
        ...(watermark.fallbackPageToken
          ? { fallbackPageToken: watermark.fallbackPageToken }
          : {}),
        lastTimestamp: Date.now(),
      };
    }
  }

  if (fallbackToList || watermark.fallbackPageToken) {
    try {
      if (fallbackToList) {
        const profile = await gmailGetProfile(accessToken, "incremental", false, signal);
        throwIfAborted(signal);
        if (typeof profile.historyId !== "string" || !profile.historyId) {
          throw new Error(
            "Gmail did not return a history cursor before listing.",
          );
        }
        nextWatermark = {
          ...nextWatermark,
          lastHistoryId: profile.historyId,
          lastTimestamp: Date.now(),
        };
      }
      const res = await gmailListMessages(
        accessToken,
        {
          q: "in:inbox newer_than:3d",
          maxResults: MAX_EMAILS_PER_RUN,
          ...(watermark.fallbackPageToken
            ? { pageToken: watermark.fallbackPageToken }
            : {}),
        },
        "incremental",
        signal,
      );
      throwIfAborted(signal);
      const listedMessageIds = new Set<string>();
      for (const message of res.messages || []) {
        if (typeof message?.id === "string") {
          listedMessageIds.add(message.id);
        }
      }
      messageIds = [...new Set([...messageIds, ...listedMessageIds])];
      if (
        res.nextPageToken != null &&
        (typeof res.nextPageToken !== "string" || !res.nextPageToken)
      ) {
        throw new Error("Gmail returned an invalid fallback page cursor.");
      }
      if (typeof res.nextPageToken === "string") {
        nextWatermark.fallbackPageToken = res.nextPageToken;
      } else {
        delete nextWatermark.fallbackPageToken;
      }
      nextWatermark.lastTimestamp = Date.now();
    } catch (err: any) {
      if (signal?.aborted) signal.throwIfAborted();
      if (err instanceof Error && err.name === "AbortError") throw err;
      console.error(
        "[automation-engine] Failed to list inbox messages or refresh history cursor:",
        err.message,
      );
      throw new Error(
        `Could not establish a Mail history cursor: ${err?.message || String(err)}`,
      );
    }
  }

  messageIds = messageIds.filter((id) => !processedIds.has(id));

  if (messageIds.length > MAX_EMAILS_PER_RUN) {
    const pendingMessageIds = [
      ...(nextWatermark.pendingMessageIds || []),
      ...messageIds.slice(MAX_EMAILS_PER_RUN),
    ];
    messageIds = messageIds.slice(0, MAX_EMAILS_PER_RUN);
    nextWatermark = {
      ...nextWatermark,
      pendingMessageIds: [...new Set(pendingMessageIds)],
    };
  }

  if (messageIds.length === 0) {
    return { messages: [], watermark: nextWatermark };
  }

  let batchResults: Awaited<ReturnType<typeof gmailBatchGetMessages>>;
  try {
    batchResults = await gmailBatchGetMessages(
      accessToken,
      messageIds,
      "metadata",
      "incremental",
      signal,
    );
    throwIfAborted(signal);
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    console.error(
      "[automation-engine] Failed to fetch Gmail message batch:",
      error,
    );
    return {
      messages: [],
      watermark: {
        ...nextWatermark,
        pendingMessageIds: [
          ...new Set([
            ...(nextWatermark.pendingMessageIds || []),
            ...messageIds,
          ]),
        ],
      },
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const missing = batchResults.filter((r) => !r.data).map((r) => r.id);
  const permanentlyMissingMessageIds = new Set<string>();
  if (missing.length > 0) {
    const refills = await Promise.all(
      missing.map(async (id) => {
        try {
          throwIfAborted(signal);
          const data = await gmailGetMessage(
            accessToken,
            id,
            "metadata",
            "incremental",
            signal,
          );
          throwIfAborted(signal);
          return { id, data };
        } catch (err: any) {
          if (signal?.aborted) signal.throwIfAborted();
          if (err instanceof Error && err.name === "AbortError") throw err;
          if (/^Google API error \(404\):/.test(err?.message || "")) {
            permanentlyMissingMessageIds.add(id);
            console.info(
              `[automation-engine] Message ${id} was deleted before it could be fetched.`,
            );
          } else {
            console.error(
              `[automation-engine] Failed to fetch message ${id}:`,
              err.message,
            );
          }
          return { id, data: null as any };
        }
      }),
    );
    const byId = new Map(refills.map((r) => [r.id, r.data]));
    for (const r of batchResults) {
      if (!r.data && byId.has(r.id)) r.data = byId.get(r.id);
    }
  }

  const pendingMessageIds = [
    ...(nextWatermark.pendingMessageIds || []).filter(
      (id) => !permanentlyMissingMessageIds.has(id),
    ),
    ...batchResults
      .filter(
        (result) =>
          !result.data && !permanentlyMissingMessageIds.has(result.id),
      )
      .map((result) => result.id),
  ];
  if (nextWatermark.pendingMessageIds) {
    delete nextWatermark.pendingMessageIds;
  }
  if (pendingMessageIds.length > 0) {
    nextWatermark.pendingMessageIds = [...new Set(pendingMessageIds)];
  }

  const messages: EmailSummary[] = [];
  for (const r of batchResults) {
    if (!r.data) continue;
    const msg = r.data;
    if (!msg.labelIds?.includes("INBOX")) continue;
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
        ?.value || "";

    messages.push({
      id: msg.id,
      threadId: msg.threadId || msg.id,
      accountEmail,
      from: getHeader("From"),
      to: getHeader("To"),
      subject: getHeader("Subject"),
      snippet: msg.snippet || "",
      labelIds: msg.labelIds || [],
      date: getHeader("Date"),
      ...(Number.isFinite(Number(msg.internalDate))
        ? { receivedAt: Number(msg.internalDate) }
        : {}),
    });
  }

  return { messages, watermark: nextWatermark };
}

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
    const timeoutSignal = AbortSignal.timeout(30_000);
    const abortSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
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

    try {
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
          if (abortSignal.aborted && abortSignal.reason instanceof Error) {
            throw abortSignal.reason;
          }
          throw new Error(event.error || "Automation model call failed");
        }
      }
    } catch (error) {
      if (abortSignal.aborted && abortSignal.reason instanceof Error) {
        throw abortSignal.reason;
      }
      throw error;
    }

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
  signal?: AbortSignal,
): Promise<Map<string, RuleMatch[]>> {
  throwIfAborted(signal);
  const questionEntries = emails.flatMap((email, emailIndex) =>
    rules.map((rule, ruleIndex) => {
      const id = `q_${emailIndex}_${ruleIndex}`;
      return [
        id,
        {
          type: "noul",
          instructions: `Does email ${aiPriorityEmailKey(email.accountEmail, email.id)} clearly match this rule: "${rule.condition}"?`,
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
      return [
        id,
        {
          emailKey: aiPriorityEmailKey(email.accountEmail, email.id),
          ruleId: rule.id,
        },
      ] as const;
    }),
  );

  const body = {
    model: "jev-latest",
    state: {
      emails: emails.map((email) => ({
        id: aiPriorityEmailKey(email.accountEmail, email.id),
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
        ...(signal ? { signal } : {}),
        timeoutMs: 12_000,
      });
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (!credentials.personalApiKey) throw error;
      payload = await requestJevDirect(
        credentials.personalApiKey,
        body,
        signal,
      );
    }
  } else if (credentials.personalApiKey) {
    payload = await requestJevDirect(credentials.personalApiKey, body, signal);
  } else if (legacyTypesafeApiKey) {
    payload = await requestJevDirect(legacyTypesafeApiKey, body, signal);
  } else {
    throw new Error("Jev is not enabled.");
  }
  throwIfAborted(signal);
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
      console.warn("[automation-engine] Jev usage recording failed:", error);
    }
  }
  throwIfAborted(signal);

  const results = new Map<string, RuleMatch[]>(
    emails.map((email) => [
      aiPriorityEmailKey(email.accountEmail, email.id),
      [],
    ]),
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
      results.get(question.emailKey)!.push({
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
  signal?: AbortSignal,
): Promise<Map<string, RuleMatch[]>> {
  throwIfAborted(signal);
  const results = new Map<string, RuleMatch[]>(
    emails.map((email) => [
      aiPriorityEmailKey(email.accountEmail, email.id),
      [],
    ]),
  );
  const expectedEmailIds = new Set(
    emails.map((email) => aiPriorityEmailKey(email.accountEmail, email.id)),
  );
  const expectedRuleIds = new Set(rules.map((rule) => rule.id));
  if (
    expectedEmailIds.size !== emails.length ||
    expectedRuleIds.size !== rules.length
  ) {
    throw new Error(
      "Mail AI rule evaluation requires unique account-scoped email and rule IDs.",
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
      signal,
    );
  }

  for (
    let rulesOffset = 0;
    rulesOffset < rules.length;
    rulesOffset += MAX_RULE_EVALUATION_PAIRS_PER_MODEL_CALL
  ) {
    const ruleBatch = rules.slice(
      rulesOffset,
      rulesOffset + MAX_RULE_EVALUATION_PAIRS_PER_MODEL_CALL,
    );
    const expectedRuleIds = new Set(ruleBatch.map((rule) => rule.id));
    const batchSize = Math.min(
      10,
      Math.max(
        1,
        Math.floor(MAX_RULE_EVALUATION_PAIRS_PER_MODEL_CALL / ruleBatch.length),
      ),
    );
    for (let i = 0; i < emails.length; i += batchSize) {
      throwIfAborted(signal);
      const batch = emails.slice(i, i + batchSize);

      const rulesText = ruleBatch
        .map(
          (r, idx) => `${idx + 1}. [id: ${r.id}] Condition: "${r.condition}"`,
        )
        .join("\n");

      const emailsText = batch
        .map(
          (e, idx) =>
            `--- Email ${idx + 1} (emailId: ${JSON.stringify(aiPriorityEmailKey(e.accountEmail, e.id))}) ---
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

For each email, evaluate ALL rules shown above. Include one result for every rule, even when it does not match, and never omit an email or rule. Copy each emailId exactly from its heading. Keep reasons to at most 80 characters. Respond with ONLY a JSON array, no other text. Format:
[{"emailId": "<account-scoped emailId>", "matches": [{"ruleId": "<id>", "match": true/false, "confidence": 0.0, "reason": "short explanation"}]}]

Be precise: only mark a rule as matching if the email clearly fits the condition. When a condition mentions a specific sender, check the From field. When it mentions a topic or category, use the subject and snippet. Confidence must be between 0 and 1. Give a short reason for every match.`;

      const text = await callModel(prompt, ownerEmail, modelSettings, signal);
      throwIfAborted(signal);

      const jsonStr = text
        .replace(/```json?\n?/g, "")
        .replace(/```/g, "")
        .trim();
      const parsed: unknown = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) {
        throw new Error("Model returned a non-array result.");
      }

      const batchEmailIds = new Set(
        batch.map((email) => aiPriorityEmailKey(email.accountEmail, email.id)),
      );
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
        results.get(emailResult.emailId)!.push(...matchedRules);
      }
      if (classifiedEmailIds.size !== batchEmailIds.size) {
        throw new Error("Model omitted one or more email classifications.");
      }
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
      accountEmail: email.accountEmail,
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
    accountEmail: email.accountEmail,
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

export interface ProcessResult {
  accountEmail: string;
  messagesProcessed: number;
  actionsExecuted: number;
  errors: number;
  suggestionsCreated: number;
}

async function runAutomationsForAccount(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  claimToken: string,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  throwIfAborted(signal);
  await assertAutomationPollClaim(ownerEmail, accountEmail, claimToken, signal);
  const result: ProcessResult = {
    accountEmail,
    messagesProcessed: 0,
    actionsExecuted: 0,
    errors: 0,
    suggestionsCreated: 0,
  };

  try {
    if (
      listSubscriptions("mail.message.received").length === 0 &&
      !(await refreshEventSubscriptions())
    ) {
      throw new Error("Could not refresh Mail event automation subscriptions.");
    }
    if (listSubscriptions("mail.message.received").length > 0) {
      await emitNewReceivedEvents(
        ownerEmail,
        accountEmail,
        accessToken,
        signal,
      );
    } else {
      await refreshReceivedEventCursor(
        ownerEmail,
        accountEmail,
        accessToken,
        signal,
      );
    }
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    console.error(
      `[automation-engine] Failed to emit received-mail events for ${accountEmail}:`,
      error,
    );
    result.errors += 1;
  }

  throwIfAborted(signal);
  const watermark = await getWatermark(ownerEmail, signal);
  const processedIds = await getProcessedIds(ownerEmail, signal);
  let pendingNotifications = await getPendingNotificationActions(
    ownerEmail,
    accountEmail,
    signal,
  );
  throwIfAborted(signal);
  const committedNotifications = pendingNotifications.map((action) =>
    processedIds.has(action.messageId)
      ? { ...action, committed: true }
      : action,
  );
  if (
    committedNotifications.some(
      (action, index) =>
        action.committed !== pendingNotifications[index].committed,
    )
  ) {
    pendingNotifications = committedNotifications;
    throwIfAborted(signal);
    await putUserSetting(
      ownerEmail,
      pendingNotificationSettingKey(accountEmail),
      pendingNotifications as any,
    );
    throwIfAborted(signal);
  }
  const retriedNotifications = await retryPendingNotificationActions(
    ownerEmail,
    accountEmail,
    accessToken,
    processedIds,
    pendingNotifications,
    signal,
  );
  throwIfAborted(signal);
  pendingNotifications = retriedNotifications.pendingActions;
  result.errors += retriedNotifications.errors;
  result.actionsExecuted += retriedNotifications.successes;

  const aiFilterState = await getAiFilterState(ownerEmail);
  throwIfAborted(signal);
  const rules = (await loadActiveRules(ownerEmail, "mail")).filter(
    (rule) =>
      rule.kind !== "ai-filter" ||
      (aiFilterState.enabled &&
        (rule.name !== AI_FILTER_RULE_NAME ||
          aiFilterState.feedback.length >= AI_FILTER_MIN_LEARNED_EXAMPLES)),
  );
  throwIfAborted(signal);
  if (rules.length === 0) return result;

  const modelSettings = await getAutomationModelSettings(ownerEmail);
  throwIfAborted(signal);
  let modelAccess: Awaited<ReturnType<typeof canUseAutomationModel>>;
  try {
    modelAccess = await canUseAutomationModel(ownerEmail, modelSettings);
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    console.error(
      "[automation-engine] Model availability check failed:",
      error,
    );
    result.errors += 1;
    return result;
  }
  throwIfAborted(signal);
  if (!modelAccess.available) {
    result.errors += 1;
    return result;
  }

  const { messages, watermark: nextWatermark } = await fetchNewInboxMessages(
    accessToken,
    accountEmail,
    watermark,
    processedIds,
    signal,
  );
  throwIfAborted(signal);

  if (messages.length === 0) {
    await assertAutomationPollClaim(
      ownerEmail,
      accountEmail,
      claimToken,
      signal,
    );
    await setWatermark(ownerEmail, nextWatermark, signal);
    return result;
  }

  result.messagesProcessed = messages.length;

  const matches = await evaluateRules(
    messages,
    rules,
    ownerEmail,
    modelSettings,
    aiFilterState,
    modelAccess.jevCredentials,
    modelAccess.legacyTypesafeApiKey,
    signal,
  );
  throwIfAborted(signal);
  const pendingNotificationKeys = new Set(
    pendingNotifications.map((action) =>
      pendingNotificationActionKey(action.ruleId, action.messageId),
    ),
  );
  let pendingNotificationsChanged = false;

  if ([...matches.values()].some((matchedRules) => matchedRules.length > 0)) {
    await assertAutomationPollClaim(
      ownerEmail,
      accountEmail,
      claimToken,
      signal,
    );
    const labelCache = await buildLabelCache(accessToken, "incremental", signal);
    throwIfAborted(signal);
    const rulesById = new Map(rules.map((r) => [r.id, r]));
    const aiDecisions: AiFilterDecision[] = [];

    for (const [emailKey, matchedRules] of matches) {
      throwIfAborted(signal);
      const message = messages.find(
        (candidate) =>
          aiPriorityEmailKey(candidate.accountEmail, candidate.id) === emailKey,
      );
      if (!message) continue;
      const messageId = message.id;

      for (const matchedRule of matchedRules) {
        throwIfAborted(signal);
        const ruleId = matchedRule.ruleId;
        const rule = rulesById.get(ruleId);
        if (!rule) continue;

        const actions = (JSON.parse(rule.actions) as AutomationAction[]).filter(
          (action) =>
            action.type !== "notify" ||
            (message.receivedAt !== undefined &&
              message.receivedAt >= Math.max(rule.createdAt, rule.updatedAt) &&
              !pendingNotificationKeys.has(
                pendingNotificationActionKey(rule.id, messageId),
              )),
        );
        if (actions.length === 0) continue;
        const ctx: ActionContext = {
          accessToken,
          messageId,
          ownerEmail,
          accountEmail,
          labelCache,
          lane: "incremental",
          signal,
          notificationIdempotencyKey: mailNotificationIdempotencyKey(
            ruleId,
            accountEmail,
            messageId,
          ),
          from: message.from,
          subject: message.subject,
          snippet: message.snippet,
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
            const {
              successes,
              failures,
              failedActions = [],
            } = await executeActions(actions, ctx);
            throwIfAborted(signal);
            result.actionsExecuted += successes;
            result.errors += failures;
            if (failedActions.some((action) => action.type === "notify")) {
              const key = pendingNotificationActionKey(ruleId, messageId);
              if (!pendingNotificationKeys.has(key)) {
                pendingNotifications.push({
                  ruleId,
                  messageId,
                  from: message.from,
                  subject: message.subject,
                  snippet: message.snippet,
                  createdAt: Date.now(),
                  attempts: 1,
                  nextAttemptAt: Date.now() + 1_000,
                  committed: false,
                });
                pendingNotificationKeys.add(key);
                pendingNotificationsChanged = true;
              }
            }
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

        const {
          successes,
          failures,
          failedActions = [],
        } = await executeActions(actions, ctx);
        throwIfAborted(signal);
        result.actionsExecuted += successes;
        result.errors += failures;
        if (failedActions.some((action) => action.type === "notify")) {
          const key = pendingNotificationActionKey(ruleId, messageId);
          if (!pendingNotificationKeys.has(key)) {
            pendingNotifications.push({
              ruleId,
              messageId,
              from: message.from,
              subject: message.subject,
              snippet: message.snippet,
              createdAt: Date.now(),
              attempts: 1,
              nextAttemptAt: Date.now() + 1_000,
              committed: false,
            });
            pendingNotificationKeys.add(key);
            pendingNotificationsChanged = true;
          }
        }
      }
    }

    throwIfAborted(signal);
    await recordAiFilterDecisions(ownerEmail, aiDecisions);
    throwIfAborted(signal);
  }

  for (const message of messages) processedIds.add(message.id);
  if (pendingNotificationsChanged) {
    throwIfAborted(signal);
    await putUserSetting(
      ownerEmail,
      pendingNotificationSettingKey(accountEmail),
      pendingNotifications as any,
    );
    throwIfAborted(signal);
  }
  await assertAutomationPollClaim(ownerEmail, accountEmail, claimToken, signal);
  await saveProcessedIds(ownerEmail, processedIds, signal);
  const committedRetries = pendingNotifications.map((action) =>
    processedIds.has(action.messageId)
      ? { ...action, committed: true }
      : action,
  );
  if (
    committedRetries.some(
      (action, index) =>
        action.committed !== pendingNotifications[index].committed,
    )
  ) {
    throwIfAborted(signal);
    await putUserSetting(
      ownerEmail,
      pendingNotificationSettingKey(accountEmail),
      committedRetries as any,
    );
    throwIfAborted(signal);
  }
  await setWatermark(ownerEmail, nextWatermark, signal);

  return result;
}

export async function processAutomationsForAccount(
  ownerEmail: string,
  accountEmail: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  throwIfAborted(signal);
  const claimToken = await claimAutomationPoll(ownerEmail, accountEmail);
  if (!claimToken) {
    return {
      accountEmail,
      messagesProcessed: 0,
      actionsExecuted: 0,
      errors: 0,
      suggestionsCreated: 0,
    };
  }
  try {
    throwIfAborted(signal);
    return await runAutomationsForAccount(
      ownerEmail,
      accountEmail,
      accessToken,
      claimToken,
      signal,
    );
  } finally {
    try {
      await releaseAutomationPoll(ownerEmail, accountEmail, claimToken);
    } catch (error) {
      console.warn(
        `[automation-engine] Failed to release the Mail poll lease for ${accountEmail}:`,
        error,
      );
    }
  }
}

export async function processAutomations(
  ownerEmail?: string,
  signal?: AbortSignal,
): Promise<{
  result: string;
  details: ProcessResult[];
}> {
  throwIfAborted(signal);
  const accounts = ownerEmail
    ? await listOAuthAccountsByOwner("google", ownerEmail)
    : await listOAuthAccounts("google");
  throwIfAborted(signal);
  const details: ProcessResult[] = [];

  for (const account of accounts) {
    throwIfAborted(signal);
    const accountOwnerEmail =
      (account as any).owner || ownerEmail || account.accountId;
    const accessToken = await getAccessToken(
      account.accountId,
      accountOwnerEmail,
    );
    throwIfAborted(signal);
    if (!accessToken) continue;

    try {
      const result = await processAutomationsForAccount(
        accountOwnerEmail,
        account.accountId,
        accessToken,
        signal,
      );
      details.push(result);
    } catch (err: any) {
      if (signal?.aborted) signal.throwIfAborted();
      if (err instanceof Error && err.name === "AbortError") throw err;
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

  processAutomations(ownerEmail).catch((err) =>
    console.error("[automation-engine] Trigger failed:", err),
  );

  return { triggered: true };
}
