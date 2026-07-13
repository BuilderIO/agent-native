import { defineAction } from "@agent-native/core";
import { getRequestUserEmail, buildDeepLink } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { emailMessageMatchesSearch } from "@shared/search.js";
import { z } from "zod";

import {
  getClients,
  getConnectedAccounts,
  fetchGmailLabelMap,
  isConnected,
} from "../server/lib/google-auth.js";
import {
  buildMailInventoryPage,
  claimInventoryCursor,
  compareInventoryItems,
  createInventoryCursor,
  inventoryQueryFingerprint,
  releaseInventoryCursorClaim,
  settleInventoryCursorClaim,
  type MailInventoryError,
  type MailInventoryFetchResult,
  type MailInventoryItem,
  type MailInventoryCursorState,
  type MailInventoryCursorClaim,
} from "../server/lib/inventory-cursor.js";
import {
  getSnoozedThreadIds,
  getSyntheticEmailsForView,
} from "../server/lib/jobs.js";
import { listInboxEmails } from "../server/lib/list-inbox-emails.js";

const cliBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

function toCompact(emails: any[]): any[] {
  return emails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    from: e.from?.name
      ? `${e.from.name} <${e.from.email}>`
      : (e.from?.email ?? e.from),
    subject: e.subject,
    snippet: e.snippet,
    date: e.date,
    isRead: e.isRead,
    hasUnread: e.hasUnread ?? !e.isRead,
    unreadCount: e.unreadCount,
    messageCount: e.messageCount,
    isStarred: e.isStarred,
    accountEmail: e.accountEmail,
  }));
}

function toInventoryItem(
  email: any,
  includeSnippet: boolean,
): MailInventoryItem {
  return {
    id: String(email.id ?? "").slice(0, 256),
    threadId: String(email.threadId ?? email.id ?? "").slice(0, 256),
    accountEmail: String(email.accountEmail ?? "").slice(0, 320),
    date: String(email.date ?? "").slice(0, 64),
    from: email.from?.email
      ? {
          ...(email.from.name
            ? { name: String(email.from.name).slice(0, 160) }
            : {}),
          email: String(email.from.email).slice(0, 320),
        }
      : { email: String(email.from ?? "").slice(0, 320) },
    subject: String(email.subject ?? "").slice(0, 500),
    isUnread: email.hasUnread ?? !email.isRead,
    ...(email.isStarred !== undefined ? { isStarred: email.isStarred } : {}),
    messageCount: email.messageCount ?? 1,
    unreadCount: email.unreadCount ?? (email.isRead ? 0 : 1),
    ...(includeSnippet && email.snippet
      ? { snippet: String(email.snippet).slice(0, 320) }
      : {}),
  };
}

function inventoryError(message: unknown): MailInventoryError {
  const bounded = String(message ?? "Provider request failed")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(access_token|refresh_token|id_token|token)=([^\s&]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 240);
  const rateLimited = /\b(?:429|quota|rate.?limit)\b/i.test(bounded);
  const auth = /\b(?:401|403|auth|token|credential|permission)\b/i.test(
    bounded,
  );
  return {
    code: rateLimited ? "rate_limited" : auth ? "authentication" : "provider",
    message: bounded,
    retryable:
      rateLimited ||
      /\b(?:timeout|temporar|unavailable|5\d\d)\b/i.test(bounded),
  };
}

function latestPerThread(emails: any[]): any[] {
  const byThread = new Map<
    string,
    {
      latest: any;
      hasUnread: boolean;
      unreadCount: number;
      messageCount: number;
    }
  >();
  for (const email of emails) {
    const key = `${email.accountEmail ?? ""}:${email.threadId || email.id}`;
    const existing = byThread.get(key);
    if (!existing) {
      byThread.set(key, {
        latest: email,
        hasUnread: !email.isRead,
        unreadCount: email.isRead ? 0 : 1,
        messageCount: 1,
      });
      continue;
    }
    existing.messageCount += 1;
    if (!email.isRead) {
      existing.hasUnread = true;
      existing.unreadCount += 1;
    }
    if (
      new Date(email.date).getTime() > new Date(existing.latest.date).getTime()
    ) {
      existing.latest = email;
    }
  }
  return Array.from(byThread.values())
    .map(({ latest, hasUnread, unreadCount, messageCount }) => ({
      ...latest,
      isRead: !hasUnread,
      hasUnread,
      unreadCount,
      messageCount,
    }))
    .sort(
      (a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
}

async function localInventoryEnvelope(
  emails: any[],
  requestedAccounts: string[] | undefined,
  resolvedAccounts: string[],
  query: { view: string; q?: string },
  limit: number,
  ownerEmail: string,
  cursor?: string,
) {
  const normalizedRequested = requestedAccounts
    ? [...new Set(requestedAccounts.map((email) => email.toLowerCase()))]
    : null;
  const queryFingerprint = inventoryQueryFingerprint({
    ...query,
    requestedAccounts: normalizedRequested,
    limit,
    source: "local",
  });
  let claim: MailInventoryCursorClaim | null = null;
  let state: MailInventoryCursorState;
  if (cursor) {
    claim = await claimInventoryCursor(ownerEmail, cursor, queryFingerprint);
    if (!claim) {
      throw new Error(
        "Inventory cursor is invalid, expired, or has already been used.",
      );
    }
    state = claim.state;
  } else {
    const inventoryItems = latestPerThread(emails)
      .map((email) =>
        toInventoryItem(
          {
            ...email,
            accountEmail: email.accountEmail ?? resolvedAccounts[0] ?? "local",
          },
          false,
        ),
      )
      .sort(compareInventoryItems);
    state = {
      queryFingerprint,
      requestedAccounts: normalizedRequested,
      firstPage: true,
      accounts: resolvedAccounts.map((accountEmail) => {
        const pending = inventoryItems.filter(
          (item) =>
            item.accountEmail.toLowerCase() === accountEmail.toLowerCase(),
        );
        return {
          accountEmail,
          status: "ok" as const,
          exhausted: true,
          pending,
          emittedCount: 0,
          knownCount: pending.length,
          emittedThreadIds: [],
        };
      }),
    };
  }

  try {
    const { items, hasMore } = await buildMailInventoryPage(
      state,
      limit,
      async () => ({ items: [], errors: {}, nextPageTokens: {} }),
    );
    const nextCursor = claim
      ? await settleInventoryCursorClaim(claim, state, hasMore)
      : hasMore
        ? await createInventoryCursor(ownerEmail, state)
        : undefined;
    return {
      version: 1,
      query,
      requestedAccounts: state.requestedAccounts,
      resolvedAccounts: state.accounts.map((account) => account.accountEmail),
      queriedAccounts: state.accounts.map((account) => account.accountEmail),
      accounts: state.accounts.map((account) => ({
        accountEmail: account.accountEmail,
        status: account.status,
        count: account.knownCount ?? account.emittedCount,
        emittedCount: account.emittedCount,
        exhausted: account.exhausted && account.pending.length === 0,
      })),
      coverageComplete: true,
      complete: !hasMore,
      items,
      page: {
        returned: items.length,
        hasMore,
        ...(nextCursor ? { nextCursor } : {}),
      },
    };
  } catch (error) {
    if (claim) await releaseInventoryCursorClaim(claim);
    throw error;
  }
}

async function readLocalEmails(ownerEmail: string): Promise<any[]> {
  const data = await getUserSetting(ownerEmail, "local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails;
  }
  return [];
}

export default defineAction({
  description:
    "List emails from a view (inbox, unread, starred, sent, drafts, scheduled, archive, trash) with optional search query.",
  schema: z.object({
    view: z
      .enum([
        "inbox",
        "unread",
        "starred",
        "sent",
        "drafts",
        "snoozed",
        "scheduled",
        "archive",
        "trash",
        "all",
      ])
      .optional()
      .describe("View to list (default: inbox)"),
    q: z.string().max(500).optional().describe("Full-text search query"),
    account: z
      .string()
      .optional()
      .describe(
        "Filter to a specific account email address. By default searches all connected accounts.",
      ),
    accountEmails: z
      .array(z.string().email())
      .optional()
      .describe(
        "Inventory only: connected account email addresses to include.",
      ),
    format: z
      .enum(["legacy", "inventory"])
      .optional()
      .describe(
        "Use inventory for a coverage-aware compact multi-account read.",
      ),
    cursor: z.string().max(256).optional().describe("Inventory page cursor."),
    limit: z.coerce
      .number()
      .optional()
      .describe("Max number of emails to return (default: 50)"),
    includeCounts: cliBoolean
      .optional()
      .describe(
        "Set to true to include thread/page unread counts and Gmail total estimate",
      ),
    compact: cliBoolean.optional().describe("Set to true for compact output"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: ({ args }) => {
    const view = typeof args?.view === "string" ? args.view : "inbox";
    const search = typeof args?.q === "string" ? args.q : undefined;
    return {
      url: buildDeepLink({
        app: "mail",
        view,
        params: { q: search },
      }),
      label: "Open list in Mail",
      view,
    };
  },
  run: async (args, ctx) => {
    const view = args.view ?? "inbox";
    const query = args.q;
    const limit = args.limit ?? 50;
    const includeCounts = args.includeCounts === true;
    const compact = args.compact !== false;
    const accountFilter = args.account?.toLowerCase();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    if (args.account && args.accountEmails) {
      throw new Error("Pass account or accountEmails, not both.");
    }
    const inventory =
      args.format === "inventory" ||
      (ctx?.caller === "mcp" && args.format === undefined);
    if (inventory && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      throw new Error("Inventory limit must be an integer from 1 through 100.");
    }

    // Inventory is deliberately resolved before any refresh/list call. Apart
    // from preventing a cross-account data leak, this keeps a selected read
    // from touching token state for accounts the caller did not choose.
    const requestedAccounts =
      args.accountEmails ?? (args.account ? [args.account] : undefined);
    const connectedAccounts = inventory
      ? await getConnectedAccounts(ownerEmail)
      : [];
    const connectedByLower = new Map(
      connectedAccounts.map((email) => [email.toLowerCase(), email]),
    );
    const selectedAccounts =
      inventory && connectedAccounts.length > 0
        ? Array.from(
            new Set(
              (requestedAccounts ?? connectedAccounts).map((email) =>
                email.toLowerCase(),
              ),
            ),
          ).map((email) => {
            const owned = connectedByLower.get(email);
            if (!owned)
              throw new Error(
                `Account ${email} is not connected for this user.`,
              );
            return owned;
          })
        : undefined;

    if (view === "snoozed" || view === "scheduled") {
      let emails = await getSyntheticEmailsForView(ownerEmail, view);
      if (query) {
        emails = emails.filter((e) => emailMessageMatchesSearch(e, query));
      }
      if (accountFilter) {
        emails = emails.filter(
          (e) => e.accountEmail?.toLowerCase() === accountFilter,
        );
      }
      if (inventory) {
        const selected = new Set(
          (selectedAccounts ?? []).map((email) => email.toLowerCase()),
        );
        if (selected.size > 0) {
          emails = emails.filter((email) =>
            selected.has(String(email.accountEmail ?? "").toLowerCase()),
          );
        }
        const syntheticResolvedAccounts =
          selectedAccounts && selectedAccounts.length > 0
            ? selectedAccounts
            : Array.from(
                new Set(
                  emails.map((email) =>
                    String(email.accountEmail ?? ownerEmail).toLowerCase(),
                  ),
                ),
              );
        return await localInventoryEnvelope(
          emails,
          requestedAccounts,
          syntheticResolvedAccounts,
          { view, ...(query ? { q: query } : {}) },
          limit,
          ownerEmail,
          args.cursor,
        );
      }
      return JSON.stringify(
        compact ? toCompact(emails.slice(0, limit)) : emails.slice(0, limit),
        null,
        2,
      );
    }

    if (
      (inventory && selectedAccounts && selectedAccounts.length > 0) ||
      (!inventory && (await isConnected(ownerEmail)))
    ) {
      const inventoryAccounts = selectedAccounts ?? [];
      const clients = inventory
        ? inventoryAccounts.map((email) => ({
            email,
            accessToken: "",
            refreshToken: "",
          }))
        : await getClients(ownerEmail);
      if (inventory) {
        const normalizedRequested = requestedAccounts
          ? [...new Set(requestedAccounts.map((email) => email.toLowerCase()))]
          : null;
        const queryFingerprint = inventoryQueryFingerprint({
          view,
          q: query ?? null,
          requestedAccounts: normalizedRequested,
          limit,
        });
        let cursorState: MailInventoryCursorState;
        let cursorClaim: MailInventoryCursorClaim | null = null;
        if (args.cursor) {
          const claimed = await claimInventoryCursor(
            ownerEmail,
            args.cursor,
            queryFingerprint,
          );
          if (!claimed) {
            throw new Error(
              "Inventory cursor is invalid, expired, or has already been used.",
            );
          }
          cursorClaim = claimed;
          cursorState = claimed.state;
        } else {
          cursorState = {
            queryFingerprint,
            requestedAccounts: normalizedRequested,
            firstPage: true,
            accounts: inventoryAccounts.map((accountEmail) => ({
              accountEmail,
              status: "ok",
              exhausted: false,
              pending: [],
              emittedCount: 0,
              knownCount: 0,
              emittedThreadIds: [],
            })),
          };
        }

        const fetchInventory = async (
          requests: Array<{ accountEmail: string; pageToken?: string }>,
        ): Promise<MailInventoryFetchResult> => {
          const accountEmails = requests.map((request) => request.accountEmail);
          const pageTokens = Object.fromEntries(
            requests
              .filter((request) => request.pageToken)
              .map((request) => [request.accountEmail, request.pageToken!]),
          );
          const listResult = await listInboxEmails({
            ownerEmail,
            view,
            q: query,
            limit,
            pageTokens:
              Object.keys(pageTokens).length > 0 ? pageTokens : undefined,
            threadFormat: "metadata",
            includeRecentMessageCandidates: false,
            accountTokens: accountEmails.map((email) => ({
              email,
              accessToken: "",
            })),
            accountEmails,
            labelMap: new Map(),
          });
          if (!listResult.ok) {
            return {
              items: [],
              errors: Object.fromEntries(
                accountEmails.map((email) => [
                  email.toLowerCase(),
                  inventoryError(listResult.message),
                ]),
              ),
              nextPageTokens: {},
            };
          }
          return {
            items: latestPerThread(listResult.emails).map((email) =>
              toInventoryItem(email, false),
            ),
            errors: Object.fromEntries(
              listResult.errors.map((error) => [
                error.email.toLowerCase(),
                inventoryError(error.error),
              ]),
            ),
            nextPageTokens: Object.fromEntries(
              Object.entries(listResult.nextPageTokens ?? {}).map(
                ([email, token]) => [email.toLowerCase(), token],
              ),
            ),
          };
        };

        try {
          const { items, hasMore } = await buildMailInventoryPage(
            cursorState,
            limit,
            fetchInventory,
          );
          const nextCursor = cursorClaim
            ? await settleInventoryCursorClaim(
                cursorClaim,
                cursorState,
                hasMore,
              )
            : hasMore
              ? await createInventoryCursor(ownerEmail, cursorState)
              : undefined;
          const coverageComplete = cursorState.accounts.every(
            (account) => account.status === "ok",
          );
          return {
            version: 1,
            query: { view, ...(query ? { q: query } : {}) },
            requestedAccounts: cursorState.requestedAccounts,
            resolvedAccounts: cursorState.accounts.map(
              (account) => account.accountEmail,
            ),
            queriedAccounts: cursorState.accounts.map(
              (account) => account.accountEmail,
            ),
            accounts: cursorState.accounts.map((account) => ({
              accountEmail: account.accountEmail,
              status: account.status,
              count: account.knownCount ?? account.emittedCount,
              emittedCount: account.emittedCount,
              exhausted:
                account.status === "ok" &&
                account.exhausted &&
                account.pending.length === 0,
              ...(account.error ? { error: account.error } : {}),
            })),
            coverageComplete,
            complete: coverageComplete && !hasMore,
            items,
            page: {
              returned: items.length,
              hasMore,
              ...(nextCursor ? { nextCursor } : {}),
            },
          };
        } catch (error) {
          if (cursorClaim) await releaseInventoryCursorClaim(cursorClaim);
          throw error;
        }
      }
      const labelMap = new Map<string, string>();
      await Promise.all(
        clients.map(async ({ accessToken }) => {
          try {
            const map = await fetchGmailLabelMap(accessToken);
            for (const [id, name] of map) labelMap.set(id, name);
          } catch {}
        }),
      );

      const listResult = await listInboxEmails({
        ownerEmail,
        view,
        q: query,
        limit,
        threadFormat: "full",
        threadCandidateLimit: query ? 500 : undefined,
        accountTokens: clients,
        labelMap,
      });

      if (!listResult.ok) {
        return JSON.stringify(
          {
            error: listResult.message,
            ...(listResult.isQuotaError && {
              retryAfterSeconds: listResult.retryAfterSeconds,
            }),
          },
          null,
          2,
        );
      }

      let emails: any[] = listResult.emails;

      if (accountFilter) {
        emails = emails.filter(
          (e: any) => e.accountEmail?.toLowerCase() === accountFilter,
        );
      }

      emails = latestPerThread(emails).slice(0, limit);

      const payload = compact ? toCompact(emails) : emails;
      if (includeCounts) {
        return JSON.stringify(
          {
            emails: payload,
            threadCount: emails.length,
            unreadInPage: emails.filter((e: any) => e.hasUnread).length,
            ...(listResult.resultSizeEstimate !== undefined && {
              totalEstimate: listResult.resultSizeEstimate,
            }),
          },
          null,
          2,
        );
      }
      return JSON.stringify(payload, null, 2);
    }

    // Fallback: local store
    let emails = await readLocalEmails(ownerEmail);
    const localAccountsByLower = new Map<string, string>();
    for (const email of emails) {
      const accountEmail = String(email.accountEmail ?? "local");
      localAccountsByLower.set(accountEmail.toLowerCase(), accountEmail);
    }
    const localSelectedAccounts = inventory
      ? Array.from(
          new Set(
            (
              requestedAccounts ?? Array.from(localAccountsByLower.values())
            ).map((email) => email.toLowerCase()),
          ),
        ).map((email) => {
          const available = localAccountsByLower.get(email);
          if (!available) {
            throw new Error(
              `Account ${email} is not available in local mail for this user.`,
            );
          }
          return available;
        })
      : undefined;

    if (localSelectedAccounts && requestedAccounts) {
      const selected = new Set(
        localSelectedAccounts.map((email) => email.toLowerCase()),
      );
      emails = emails.filter((email) =>
        selected.has(String(email.accountEmail ?? "local").toLowerCase()),
      );
    }

    switch (view) {
      case "inbox":
        emails = emails.filter(
          (e) => !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
        );
        break;
      case "unread":
        emails = emails.filter(
          (e) =>
            !e.isRead &&
            !e.isArchived &&
            !e.isTrashed &&
            !e.isDraft &&
            !e.isSent,
        );
        break;
      case "starred":
        emails = emails.filter((e) => e.isStarred && !e.isTrashed);
        break;
      case "sent":
        emails = emails.filter((e) => e.isSent && !e.isTrashed);
        break;
      case "drafts":
        emails = emails.filter((e) => e.isDraft);
        break;
      case "archive":
        emails = emails.filter((e) => e.isArchived && !e.isTrashed);
        break;
      case "trash":
        emails = emails.filter((e) => e.isTrashed);
        break;
    }

    if (query) {
      emails = emails.filter((e) => emailMessageMatchesSearch(e, query));
    }

    // Filter out snoozed emails, matching the REST handler's demo-mode
    // behavior. Skip when searching so snoozed hits surface too.
    if (!query && (view === "inbox" || view === "unread")) {
      const snoozedIds = await getSnoozedThreadIds(ownerEmail);
      if (snoozedIds.size > 0) {
        emails = emails.filter(
          (e) => !snoozedIds.has(e.threadId) && !snoozedIds.has(e.id),
        );
      }
    }

    if (inventory) {
      const localResolvedAccounts =
        localSelectedAccounts && localSelectedAccounts.length > 0
          ? localSelectedAccounts
          : Array.from(
              new Set(
                emails.map((email) =>
                  String(email.accountEmail ?? "local").toLowerCase(),
                ),
              ),
            );
      return await localInventoryEnvelope(
        emails,
        requestedAccounts,
        localResolvedAccounts,
        { view, ...(query ? { q: query } : {}) },
        limit,
        ownerEmail,
        args.cursor,
      );
    }
    emails = latestPerThread(emails).slice(0, limit);
    const payload = compact ? toCompact(emails) : emails;
    if (includeCounts) {
      return JSON.stringify(
        {
          emails: payload,
          threadCount: emails.length,
          unreadInPage: emails.filter((e: any) => e.hasUnread).length,
          totalEstimate: emails.length,
        },
        null,
        2,
      );
    }
    return JSON.stringify(payload, null, 2);
  },
});
