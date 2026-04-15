import { eq, and } from "drizzle-orm";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import {
  listOAuthAccounts,
  getOAuthTokens,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { db, schema } from "../db/index.js";
import {
  createOAuth2Client,
  gmailListMessages,
  gmailGetMessage,
  gmailListHistory,
  gmailGetProfile,
} from "./google-api.js";
import {
  buildLabelCache,
  executeActions,
  type ActionContext,
} from "./automation-actions.js";
import type { AutomationAction } from "@shared/types.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
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
  const userKey = (await getUserSetting(ownerEmail, "anthropic-api-key")) as
    | string
    | { key?: string }
    | undefined;
  if (typeof userKey === "string" && userKey.trim()) return userKey.trim();
  if (userKey && typeof userKey === "object" && userKey.key?.trim()) {
    return userKey.key.trim();
  }
  return process.env.ANTHROPIC_API_KEY || undefined;
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
      const clientId = process.env.GOOGLE_CLIENT_ID!;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
      const oauth = createOAuth2Client(
        clientId,
        clientSecret,
        "http://localhost:8080/_agent-native/google/callback",
      );
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

interface EmailSummary {
  id: string;
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

  // Fetch metadata for each message
  const messages: EmailSummary[] = [];
  for (const id of messageIds) {
    try {
      const msg = await gmailGetMessage(accessToken, id, "metadata");
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
          ?.value || "";

      messages.push({
        id: msg.id,
        from: getHeader("From"),
        to: getHeader("To"),
        subject: getHeader("Subject"),
        snippet: msg.snippet || "",
        labelIds: msg.labelIds || [],
        date: getHeader("Date"),
      });
    } catch (err: any) {
      console.error(
        `[automation-engine] Failed to fetch message ${id}:`,
        err.message,
      );
    }
  }

  return { messages, newHistoryId };
}

// ─── Haiku evaluation ────────────────────────────────────────────────────────

interface RuleMatch {
  ruleId: string;
  match: boolean;
}

async function callModel(
  apiKey: string,
  prompt: string,
  model: string,
  ownerEmail: string,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };

  // Attribute this call under the "automation" label so users can see
  // how much of their spend comes from email rule evaluation vs the
  // main chat in the Usage settings panel.
  if (data.usage) {
    try {
      const { recordUsage } = await import("@agent-native/core");
      await recordUsage({
        ownerEmail,
        inputTokens: data.usage.input_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? 0,
        cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
        model,
        label: "automation",
        app: "mail",
      });
    } catch {
      // Recording is best-effort — never break the automation run.
    }
  }

  return data.content[0]?.type === "text" ? (data.content[0].text ?? "") : "";
}

async function evaluateRules(
  emails: EmailSummary[],
  rules: RuleRecord[],
  apiKey: string,
  ownerEmail: string,
  model: string = DEFAULT_MODEL,
): Promise<Map<string, string[]>> {
  // Returns: messageId → array of matched ruleIds
  const results = new Map<string, string[]>();
  if (emails.length === 0 || rules.length === 0) return results;

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

    const prompt = `You are an email classification engine. Given emails and a set of rules, determine which rules match each email.

Rules:
${rulesText}

Emails:
${emailsText}

For each email, evaluate ALL rules. Respond with ONLY a JSON array, no other text. Format:
[{"emailId": "<id>", "matches": [{"ruleId": "<id>", "match": true/false}]}]

Be precise: only mark a rule as matching if the email clearly fits the condition. When a condition mentions a specific sender, check the From field. When it mentions a topic or category, use the subject and snippet.`;

    try {
      const text = await callModel(apiKey, prompt, model, ownerEmail);

      // Parse JSON from response (handle markdown code blocks)
      const jsonStr = text
        .replace(/```json?\n?/g, "")
        .replace(/```/g, "")
        .trim();
      const parsed = JSON.parse(jsonStr) as Array<{
        emailId: string;
        matches: RuleMatch[];
      }>;

      for (const emailResult of parsed) {
        const matchedRules = emailResult.matches
          .filter((m) => m.match)
          .map((m) => m.ruleId);
        if (matchedRules.length > 0) {
          results.set(emailResult.emailId, matchedRules);
        }
      }
    } catch (err: any) {
      console.error(
        "[automation-engine] Haiku evaluation failed:",
        err.message,
      );
      // Skip this batch, will retry on next cron tick
    }
  }

  return results;
}

// ─── Main processor ──────────────────────────────────────────────────────────

export interface ProcessResult {
  accountEmail: string;
  messagesProcessed: number;
  actionsExecuted: number;
  errors: number;
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
  };

  // 1. Load active rules
  const rules = await loadActiveRules(ownerEmail, "mail");
  if (rules.length === 0) return result;

  // 2. Resolve API key — prefer the user's own key from settings, fall back
  //    to the server env var only if no per-user key is configured.
  const apiKey = await resolveAnthropicKey(ownerEmail);
  if (!apiKey) {
    console.warn(
      `[automation-engine] No Anthropic API key for ${ownerEmail}, skipping`,
    );
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

  // 5. Evaluate rules with AI
  const autoSettings = await getUserSetting(ownerEmail, "automation-settings");
  const model = (autoSettings as any)?.model || DEFAULT_MODEL;
  const matches = await evaluateRules(
    messages,
    rules,
    apiKey,
    ownerEmail,
    model,
  );

  // 6. Execute matched actions
  if (matches.size > 0) {
    const labelCache = await buildLabelCache(accessToken);
    const rulesById = new Map(rules.map((r) => [r.id, r]));

    for (const [messageId, matchedRuleIds] of matches) {
      for (const ruleId of matchedRuleIds) {
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

        const { successes, failures } = await executeActions(actions, ctx);
        result.actionsExecuted += successes;
        result.errors += failures;
      }
    }
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
export async function processAutomations(): Promise<{
  result: string;
  details: ProcessResult[];
}> {
  const accounts = await listOAuthAccounts("google");
  const details: ProcessResult[] = [];

  for (const account of accounts) {
    const accessToken = await getAccessToken(account.accountId);
    if (!accessToken) continue;

    const ownerEmail = (account as any).owner || account.accountId;

    try {
      const result = await processAutomationsForAccount(
        ownerEmail,
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
      });
    }
  }

  const totalProcessed = details.reduce(
    (sum, d) => sum + d.messagesProcessed,
    0,
  );
  const totalActions = details.reduce((sum, d) => sum + d.actionsExecuted, 0);

  return {
    result: `Processed ${totalProcessed} messages, executed ${totalActions} actions`,
    details,
  };
}

// ─── In-memory debounce for focus trigger ────────────────────────────────────

let _lastTriggerTime = 0;
const TRIGGER_DEBOUNCE_MS = 30_000;

export async function triggerAutomationsDebounced(): Promise<{
  triggered: boolean;
  reason?: string;
}> {
  const now = Date.now();
  if (now - _lastTriggerTime < TRIGGER_DEBOUNCE_MS) {
    return { triggered: false, reason: "debounced" };
  }
  _lastTriggerTime = now;

  // Fire and forget
  processAutomations().catch((err) =>
    console.error("[automation-engine] Trigger failed:", err),
  );

  return { triggered: true };
}
