import { createHash, createHmac } from "node:crypto";

import { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbExec = vi.hoisted(() => {
  const exec = { execute: vi.fn() };
  return {
    ...exec,
    transaction: vi.fn(async (run: (tx: typeof exec) => unknown) => run(exec)),
  };
});

vi.mock("../db/client.js", () => ({
  getDbExec: () => dbExec,
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn(async () => {}),
  ensureTableExists: vi.fn(async () => {}),
}));

import { CHATGPT_DIRECTORY_PROFILE as slidesProfile } from "../../../../templates/slides/server/lib/chatgpt-directory-tools.js";
import {
  EMBED_SESSION_COOKIE,
  EMBED_TARGET_HEADER,
  EMBED_TARGET_QUERY_PARAM,
  createMcpDirectoryWidgetReadCapability,
  createMcpDirectoryWidgetWriteCapability,
  getMcpDirectoryWidgetWriteCapabilityGrant,
  isMcpDirectoryWidgetReadCapabilityScope,
  isMcpDirectoryWidgetWriteCapabilityScope,
  renewMcpDirectoryWidgetCapabilityScope,
} from "../shared/embed-auth.js";
import { resolveEmbedRequestOrigin } from "./embed-request-origin.js";
import { createEmbedStartRouteHandler } from "./embed-route.js";
import {
  requestMatchesEmbedTarget,
  normalizeEmbedTargetPath,
  requestHasEmbedAuthMarker,
  resolveEmbedSessionFromRequest,
  consumeEmbedSessionTicket as consumeEmbedSessionTicketForAudience,
  createEmbedSessionTicket as createEmbedSessionTicketForAudience,
  hasExplicitEmbedSessionCredential,
  hasPresentedEmbedSessionCredential,
  hasEmbedSessionRequestMarker,
  isExpiredMcpDirectoryWidgetSessionRequest,
  readMcpDirectoryWidgetRenewalTicket as readMcpDirectoryWidgetRenewalTicketForAudience,
  renewMcpDirectoryWidgetSession as renewMcpDirectoryWidgetSessionForAudience,
  revokeEmbedSessionsForOwner,
  revokeEmbedSessionsForOwners,
  resolveEmbedSessionCookieOwners,
  resolveEmbedSessionTokenForHost,
  setEmbedSessionCookie,
  signEmbedSessionToken,
  verifyEmbedSessionToken,
  embedSessionsStore,
} from "./embed-session.js";
import { getRequestContext, runWithRequestContext } from "./request-context.js";

const ORIGINAL_ENV = { ...process.env };

function ticketAudienceFixture(
  audienceHost = "content.example.test",
  audienceBasePath = "",
) {
  return { audience_host: audienceHost, audience_base_path: audienceBasePath };
}

function createEmbedSessionTicket(
  input: Parameters<typeof createEmbedSessionTicketForAudience>[0],
) {
  return createEmbedSessionTicketForAudience({
    audienceHost: "content.example.test",
    ...input,
  });
}

function consumeEmbedSessionTicket(
  ticket: string | undefined | null,
  options: Parameters<typeof consumeEmbedSessionTicketForAudience>[1] = {},
) {
  return consumeEmbedSessionTicketForAudience(ticket, {
    audienceHost: "content.example.test",
    ...options,
  });
}

function readMcpDirectoryWidgetRenewalTicket(
  ticket: string,
  options: { audienceHost?: string } = {},
) {
  return readMcpDirectoryWidgetRenewalTicketForAudience(ticket, {
    audienceHost: "content.example.test",
    ...options,
  });
}

function renewMcpDirectoryWidgetSession(
  input: Parameters<typeof renewMcpDirectoryWidgetSessionForAudience>[0],
) {
  return renewMcpDirectoryWidgetSessionForAudience({
    audienceHost: "content.example.test",
    ...input,
  });
}

function installTicketStore() {
  const rows = new Map<string, Record<string, any>>();
  dbExec.execute.mockImplementation(async ({ sql, args }: any) => {
    if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
      rows.set(args[0], {
        ticket_hash: args[0],
        owner_email: args[1],
        org_id: args[2],
        target_path: args[3],
        scope: args[4],
        created_at: args[5],
        expires_at: args[6],
        consumed_at: args[7],
        renewal_expires_at: args[8],
        session_active_until: args[9],
        audience_host: args[10],
        audience_base_path: args[11],
      });
    }
    if (sql.includes("FROM agent_native_embed_tickets WHERE ticket_hash")) {
      const row = rows.get(args[0]);
      return { rows: row ? [{ ...row }] : [], rowsAffected: 0 };
    }
    if (sql.startsWith("UPDATE agent_native_embed_tickets SET consumed_at")) {
      const row = rows.get(args[2]);
      if (!row || row.consumed_at !== null)
        return { rows: [], rowsAffected: 0 };
      row.consumed_at = args[0];
      row.session_active_until = args[1];
    }
    if (sql.startsWith("UPDATE agent_native_embed_tickets SET scope")) {
      const row = rows.get(args[2]);
      if (!row || row.scope !== args[3]) return { rows: [], rowsAffected: 0 };
      row.scope = args[0];
      row.session_active_until = args[1];
    }
    return { rows: [], rowsAffected: 1 };
  });
  return rows;
}

function contentWidgetWriteScope({
  userEmail = "owner@example.com",
  orgId,
  expiresAtMs = Date.now() + 15 * 60 * 1000,
  resourceId = "doc_123",
}: {
  userEmail?: string;
  orgId?: string;
  expiresAtMs?: number;
  resourceId?: string;
} = {}): string {
  const scope = createMcpDirectoryWidgetWriteCapability({
    appId: "content",
    resourceUri: "ui://content/shell-v66",
    resourceIds: { documentId: resourceId },
    userEmail,
    ...(orgId ? { orgId } : {}),
    expiresAtMs,
    readActionArguments: {
      "get-document": { documentId: resourceId },
    },
    writeActionArguments: {
      "update-document": {
        documentId: resourceId,
        content: { type: "actionSchema" },
      },
    },
  });
  if (!scope) throw new Error("Could not build widget write scope fixture.");
  return scope;
}

describe("embed session tokens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    dbExec.execute.mockReset().mockResolvedValue({ rows: [], rowsAffected: 1 });
    process.env = { ...ORIGINAL_ENV, OAUTH_STATE_SECRET: "embed-test-secret" };
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...ORIGINAL_ENV };
  });

  it("round-trips signed owner/org claims", () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      targetPath: "/_agent-native/open?view=inbox",
      ttlSeconds: 60,
    });

    const verified = verifyEmbedSessionToken(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.ownerEmail).toBe("owner@example.com");
      expect(verified.claims.orgId).toBe("org_123");
      expect(verified.claims.targetPath).toBe("/_agent-native/open?view=inbox");
    }
  });

  it("rejects tampered and expired tokens", () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/dashboard",
      ttlSeconds: 1,
    });
    const tampered = `${token.slice(0, -1)}x`;
    expect(verifyEmbedSessionToken(tampered).ok).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(verifyEmbedSessionToken(token)).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });

  it("checks host audience and logout revocation without an H3 request", async () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "calendar.example.test",
      targetPath: "/inbox",
    });

    await expect(
      resolveEmbedSessionTokenForHost(token, "other.example.test"),
    ).resolves.toBeNull();
    await expect(
      resolveEmbedSessionTokenForHost(token, "calendar.example.test"),
    ).resolves.toMatchObject({ ownerEmail: "owner@example.com" });

    const legacyToken = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/inbox",
    });
    await expect(
      resolveEmbedSessionTokenForHost(
        legacyToken,
        "beta.calendar.agent-native.com",
      ),
    ).resolves.toBeNull();

    dbExec.execute.mockResolvedValueOnce({
      rows: [{ revoked_before: Date.now() }],
      rowsAffected: 0,
    });
    await expect(
      resolveEmbedSessionTokenForHost(token, "calendar.example.test"),
    ).resolves.toBeNull();
  });

  it("rejects revoked write-widget tickets", async () => {
    const ticketCreatedAtMs = Date.now() - 1000;
    const revokedBefore = Date.now() - 500;
    const scope = contentWidgetWriteScope({
      expiresAtMs: Date.now() + 60_000,
    });
    dbExec.execute.mockImplementation(async ({ sql }: any) => {
      if (sql.includes("FROM agent_native_embed_tickets")) {
        return {
          rows: [
            {
              ticket_hash: "a".repeat(64),
              owner_email: "owner@example.com",
              target_path: "/page/doc_123",
              ...ticketAudienceFixture(),
              scope,
              created_at: ticketCreatedAtMs,
              consumed_at: ticketCreatedAtMs,
              renewal_expires_at: ticketCreatedAtMs + 30 * 24 * 60 * 60 * 1000,
              session_active_until: Date.now() + 60_000,
            },
          ],
        };
      }
      return sql.includes("SELECT revoked_before")
        ? { rows: [{ revoked_before: revokedBefore }] }
        : { rows: [], rowsAffected: 1 };
    });
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "content.example.test",
      targetPath: "/page/doc_123",
      scope,
      ticketCreatedAtMs,
      sessionId: "a".repeat(64),
    });

    await expect(
      resolveEmbedSessionTokenForHost(token, "content.example.test"),
    ).resolves.toBeNull();
    expect(dbExec.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("SELECT revoked_before"),
      }),
    );
  });

  it("rejects a write-widget ticket created before logout when redeemed later", async () => {
    const createdAt = Date.now() - 1000;
    const revokedBefore = Date.now() - 500;
    dbExec.transaction.mockClear();
    dbExec.execute.mockImplementation(async ({ sql }: any) => {
      if (sql.includes("FROM agent_native_embed_tickets")) {
        return {
          rows: [
            {
              owner_email: "owner@example.com",
              target_path: "/page/doc_123",
              ...ticketAudienceFixture(),
              scope: contentWidgetWriteScope(),
              created_at: createdAt,
              expires_at: Date.now() + 60_000,
              consumed_at: null,
            },
          ],
        };
      }
      if (sql.includes("SELECT revoked_before")) {
        return { rows: [{ revoked_before: revokedBefore }] };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const onResult = vi.fn();

    await expect(
      consumeEmbedSessionTicket("pre-logout-widget-ticket", {
        allowCapabilityIdentityMismatch: true,
        onResult,
      }),
    ).resolves.toBeNull();

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "revoked" }),
    );
    expect(dbExec.transaction).toHaveBeenCalled();
  });

  it("rejects a read-widget ticket created before logout", async () => {
    const createdAtMs = Date.now() - 1000;
    const revokedBefore = Date.now() - 500;
    dbExec.transaction.mockClear();
    dbExec.execute.mockImplementation(async ({ sql }: any) => {
      if (sql.includes("FROM agent_native_embed_tickets")) {
        return {
          rows: [
            {
              owner_email: "owner@example.com",
              target_path: "/page/doc_123",
              ...ticketAudienceFixture(),
              scope: "capability:mcp-directory-widget-read:example",
              created_at: createdAtMs,
              expires_at: Date.now() + 60_000,
              consumed_at: null,
            },
          ],
        };
      }
      if (sql.includes("SELECT revoked_before")) {
        return { rows: [{ revoked_before: revokedBefore }] };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const onResult = vi.fn();

    await expect(
      consumeEmbedSessionTicket("pre-logout-read-widget-ticket", {
        allowCapabilityIdentityMismatch: true,
        onResult,
      }),
    ).resolves.toBeNull();

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "revoked" }),
    );
    expect(dbExec.transaction).toHaveBeenCalled();
  });

  it("does not allow another signed-in user to redeem a write-widget ticket", async () => {
    const createdAt = Date.now();
    dbExec.transaction.mockClear();
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? {
            rows: [
              {
                ticket_hash: "a".repeat(64),
                owner_email: "owner@example.com",
                target_path: "/page/doc_123",
                ...ticketAudienceFixture(),
                scope: contentWidgetWriteScope(),
                created_at: createdAt,
                expires_at: Date.now() + 60_000,
                consumed_at: null,
              },
            ],
          }
        : { rows: [], rowsAffected: 1 },
    );

    await expect(
      consumeEmbedSessionTicket("other-user-widget-ticket", {
        expectedOwnerEmail: "other@example.com",
        allowCapabilityIdentityMismatch: true,
      }),
    ).resolves.toBeNull();
    expect(dbExec.transaction).not.toHaveBeenCalled();
  });

  it("revokes read-widget tokens after owner logout", async () => {
    const ticketCreatedAtMs = Date.now() - 1000;
    const scope = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: "ui://content/shell",
      resourceIds: { documentId: "doc_123" },
      actionArguments: {
        "get-document": { documentId: "doc_123" },
      },
    });
    expect(scope).toBeDefined();
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "content.example.test",
      targetPath: "/page/doc_123",
      scope: scope!,
      ticketCreatedAtMs,
    });
    dbExec.execute.mockResolvedValue({
      rows: [{ revoked_before: Date.now() }],
      rowsAffected: 0,
    });

    await expect(
      resolveEmbedSessionTokenForHost(token, "content.example.test"),
    ).resolves.toBeNull();
    expect(dbExec.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("SELECT revoked_before"),
      }),
    );
  });

  it("finds signed sibling-host cookie owners for logout without authenticating them", async () => {
    const siblingToken = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.example.test",
      targetPath: "/inbox",
    });
    const capabilityToken = signEmbedSessionToken({
      ownerEmail: "capability-owner@example.com",
      audienceHost: "mail.example.test",
      targetPath: "/inbox",
      scope: "capability:calendar.read",
    });

    await expect(
      resolveEmbedSessionCookieOwners([siblingToken, capabilityToken]),
    ).resolves.toEqual(["owner@example.com"]);
    await expect(
      resolveEmbedSessionTokenForHost(siblingToken, "calendar.example.test"),
    ).resolves.toBeNull();
  });
});

describe("embed session tickets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    dbExec.execute.mockReset().mockResolvedValue({ rows: [], rowsAffected: 1 });
    dbExec.transaction
      .mockReset()
      .mockImplementation(async (run) => run(dbExec));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores a separate 30-day renewal cutoff for directory widget tickets", async () => {
    const inserted: { sql: string; args: unknown[] }[] = [];
    dbExec.execute.mockImplementation(async ({ sql, args }: any) => {
      if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
        inserted.push({ sql, args });
      }
      return { rows: [], rowsAffected: 1 };
    });

    const ticket = await createEmbedSessionTicket({
      ownerEmail: "owner@example.com",
      targetPath: "/page/doc_123",
      scope: "capability:mcp-directory-widget-read:example",
      ttlSeconds: 15 * 60,
      revocationAnchorCreatedAtMs: Date.now(),
    });

    expect(ticket.expiresAt).toBe(Date.now() + 15 * 60 * 1000);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].sql).toContain("renewal_expires_at");
    expect(inserted[0].args[6]).toBe(Date.now() + 15 * 60 * 1000);
    expect(inserted[0].args[7]).toBeNull();
    expect(inserted[0].args[8]).toBe(Date.now() + 30 * 24 * 60 * 60 * 1000);
    expect(inserted[0].args[9]).toBeNull();
    expect(inserted[0].args.slice(10)).toEqual(["content.example.test", ""]);
    expect(inserted[0].args).toHaveLength(12);
  });

  it("rejects an initial write-widget ticket authenticated before owner logout", async () => {
    const credentialIssuedAtMs = Date.now() - 1000;
    const revokedBefore = credentialIssuedAtMs + 1;
    let ticketInserted = false;
    dbExec.execute.mockImplementation(async ({ sql }) => {
      if (sql.includes("SELECT revoked_before")) {
        return { rows: [{ revoked_before: revokedBefore }] };
      }
      if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
        ticketInserted = true;
      }
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.com",
          identityAuthenticatedAtMs: Date.now(),
          mcpCredentialIssuedAtMs: credentialIssuedAtMs,
        },
        () =>
          createEmbedSessionTicket({
            ownerEmail: "owner@example.com",
            targetPath: "/page/doc_123",
            scope: contentWidgetWriteScope(),
            revocationAnchorCreatedAtMs:
              getRequestContext()?.mcpCredentialIssuedAtMs,
          }),
      ),
    ).rejects.toThrow("Embed session ticket creation was revoked by logout.");

    expect(dbExec.transaction).toHaveBeenCalledOnce();
    expect(dbExec.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("SELECT revoked_before"),
      }),
    );
    expect(ticketInserted).toBe(false);
  });

  it("rejects an initial widget ticket when no trusted credential issue time exists", async () => {
    await expect(
      createEmbedSessionTicket({
        ownerEmail: "owner@example.com",
        targetPath: "/page/doc_123",
        scope: contentWidgetWriteScope(),
      }),
    ).rejects.toThrow(
      "Directory widget ticket requires a trusted revocation anchor.",
    );
    expect(dbExec.execute).not.toHaveBeenCalled();
    expect(dbExec.transaction).not.toHaveBeenCalled();
  });

  it("serializes initial write-widget ticket issuance with owner logout", async () => {
    const credentialIssuedAtMs = Date.now() - 1000;
    let revokedBefore: number | null = null;
    let ticketInserted = false;
    dbExec.execute.mockImplementation(async ({ sql, args }: any) => {
      if (sql.includes("SELECT revoked_before")) {
        return {
          rows:
            revokedBefore === null ? [] : [{ revoked_before: revokedBefore }],
        };
      }
      if (sql.includes("INSERT INTO agent_native_embed_session_revocations")) {
        revokedBefore = Number(args[1]);
      }
      if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
        ticketInserted = true;
      }
      return { rows: [], rowsAffected: 1 };
    });

    let releaseMint!: () => void;
    let signalMint!: () => void;
    const mintStarted = new Promise<void>((resolve) => {
      signalMint = resolve;
    });
    const releaseTransaction = new Promise<void>((resolve) => {
      releaseMint = resolve;
    });
    let transactionCount = 0;
    dbExec.transaction.mockImplementation(async (run) => {
      transactionCount += 1;
      if (transactionCount === 1) {
        signalMint();
        await releaseTransaction;
      }
      return run(dbExec);
    });

    const pendingMint = runWithRequestContext(
      {
        userEmail: "owner@example.com",
        mcpCredentialIssuedAtMs: credentialIssuedAtMs,
      },
      () =>
        createEmbedSessionTicket({
          ownerEmail: "owner@example.com",
          targetPath: "/page/doc_123",
          scope: contentWidgetWriteScope(),
          revocationAnchorCreatedAtMs:
            getRequestContext()?.mcpCredentialIssuedAtMs,
        }),
    );

    await mintStarted;
    await revokeEmbedSessionsForOwner("owner@example.com");
    releaseMint();

    await expect(pendingMint).rejects.toThrow(
      "Embed session ticket creation was revoked by logout.",
    );
    expect(ticketInserted).toBe(false);
  });

  it("preserves the original renewal cutoff when minting a renewed ticket", async () => {
    const inserted: { sql: string; args: unknown[] }[] = [];
    const renewalExpiresAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const revocationAnchorCreatedAtMs = Date.now() - 10_000;
    dbExec.execute.mockImplementation(async ({ sql, args }: any) => {
      if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
        inserted.push({ sql, args });
      }
      return { rows: [], rowsAffected: 1 };
    });

    await createEmbedSessionTicket({
      ownerEmail: "owner@example.com",
      targetPath: "/page/doc_123",
      scope: contentWidgetWriteScope(),
      ttlSeconds: 15 * 60,
      renewalExpiresAtMs,
      revocationAnchorCreatedAtMs,
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].args[8]).toBe(renewalExpiresAtMs);
    expect(inserted[0].args[9]).toBe(Date.now() + 15 * 60 * 1000);
    expect(inserted[0].args.slice(10)).toEqual(["content.example.test", ""]);
    expect(inserted[0].args).toHaveLength(12);
  });

  it("rejects renewing a widget ticket created before owner logout", async () => {
    const createdAtMs = Date.now() - 1000;
    const inserted: { sql: string; args: unknown[] }[] = [];
    dbExec.execute.mockImplementation(async ({ sql, args }: any) => {
      if (sql.includes("SELECT revoked_before")) {
        return { rows: [{ revoked_before: Date.now() }] };
      }
      if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
        inserted.push({ sql, args });
      }
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      createEmbedSessionTicket({
        ownerEmail: "owner@example.com",
        targetPath: "/page/doc_123",
        scope: contentWidgetWriteScope(),
        ttlSeconds: 15 * 60,
        revocationAnchorCreatedAtMs: createdAtMs,
      }),
    ).rejects.toThrow("Embed session ticket creation was revoked by logout.");

    expect(dbExec.transaction).toHaveBeenCalledOnce();
    expect(inserted).toHaveLength(0);
  });

  it("rejects renewing a read-widget ticket after owner logout", async () => {
    const credentialIssuedAtMs = Date.now() - 1000;
    const inserted: { sql: string; args: unknown[] }[] = [];
    dbExec.execute.mockImplementation(async ({ sql, args }: any) => {
      if (sql.includes("SELECT revoked_before")) {
        return { rows: [{ revoked_before: Date.now() }] };
      }
      if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
        inserted.push({ sql, args });
      }
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      createEmbedSessionTicket({
        ownerEmail: "owner@example.com",
        targetPath: "/page/doc_123",
        scope: "capability:mcp-directory-widget-read:example",
        revocationAnchorCreatedAtMs: credentialIssuedAtMs,
      }),
    ).rejects.toThrow("Embed session ticket creation was revoked by logout.");

    expect(dbExec.transaction).toHaveBeenCalledOnce();
    expect(inserted).toHaveLength(0);
  });

  it("serializes widget ticket renewal with owner logout", async () => {
    const createdAtMs = Date.now() - 1000;
    let revokedBefore: number | null = null;
    let ticketInserted = false;
    dbExec.execute.mockImplementation(async ({ sql, args }: any) => {
      if (sql.includes("SELECT revoked_before")) {
        return {
          rows:
            revokedBefore === null ? [] : [{ revoked_before: revokedBefore }],
          rowsAffected: 0,
        };
      }
      if (sql.includes("INSERT INTO agent_native_embed_session_revocations")) {
        revokedBefore = Number(args[1]);
      }
      if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
        ticketInserted = true;
      }
      return { rows: [], rowsAffected: 1 };
    });

    let releaseRenewal!: () => void;
    let signalRenewal!: () => void;
    const renewalStarted = new Promise<void>((resolve) => {
      signalRenewal = resolve;
    });
    const releaseTransaction = new Promise<void>((resolve) => {
      releaseRenewal = resolve;
    });
    let transactionCount = 0;
    dbExec.transaction.mockImplementation(async (run) => {
      transactionCount += 1;
      if (transactionCount === 1) {
        signalRenewal();
        await releaseTransaction;
      }
      return run(dbExec);
    });

    const pendingRenewal = createEmbedSessionTicket({
      ownerEmail: "owner@example.com",
      targetPath: "/page/doc_123",
      scope: contentWidgetWriteScope(),
      ttlSeconds: 15 * 60,
      revocationAnchorCreatedAtMs: createdAtMs,
    });

    await renewalStarted;
    await revokeEmbedSessionsForOwner("owner@example.com");
    releaseRenewal();

    await expect(pendingRenewal).rejects.toThrow(
      "Embed session ticket creation was revoked by logout.",
    );
    expect(ticketInserted).toBe(false);
  });

  it("keeps renewal available after the short-lived widget ticket expires", async () => {
    const createdAt = Date.now() - 16 * 60 * 1000;
    const expiresAt = createdAt + 15 * 60 * 1000;
    const renewalExpiresAt = createdAt + 30 * 24 * 60 * 60 * 1000;
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? {
            rows: [
              {
                ticket_hash: "b".repeat(64),
                owner_email: "owner@example.com",
                target_path: "/page/doc_123",
                ...ticketAudienceFixture(),
                scope: "capability:mcp-directory-widget-write:example",
                created_at: createdAt,
                expires_at: expiresAt,
                renewal_expires_at: renewalExpiresAt,
              },
            ],
          }
        : { rows: [], rowsAffected: 1 },
    );

    await expect(
      readMcpDirectoryWidgetRenewalTicket("expired-capability-ticket"),
    ).resolves.toMatchObject({
      ownerEmail: "owner@example.com",
      createdAtMs: createdAt,
      expiresAtMs: expiresAt,
      renewalExpiresAtMs: renewalExpiresAt,
    });
  });

  it("bounds persisted renewal handles to 30 days from creation", async () => {
    const createdAt = Date.now() - 29 * 24 * 60 * 60 * 1000;
    const renewalExpiryCap = createdAt + 30 * 24 * 60 * 60 * 1000;
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? {
            rows: [
              {
                ticket_hash: "c".repeat(64),
                owner_email: "owner@example.com",
                target_path: "/page/doc_123",
                ...ticketAudienceFixture(),
                scope: "capability:mcp-directory-widget-read:example",
                created_at: createdAt,
                expires_at: createdAt + 15 * 60 * 1000,
                renewal_expires_at: renewalExpiryCap + 60 * 60 * 1000,
              },
            ],
          }
        : { rows: [], rowsAffected: 1 },
    );

    await expect(
      readMcpDirectoryWidgetRenewalTicket("overlong-renewal-ticket"),
    ).resolves.toMatchObject({ renewalExpiresAtMs: renewalExpiryCap });

    vi.setSystemTime(renewalExpiryCap);
    await expect(
      readMcpDirectoryWidgetRenewalTicket("overlong-renewal-ticket"),
    ).resolves.toBeNull();
  });

  it("uses createdAt plus 30 days when a stored renewal deadline is absent", async () => {
    const createdAt = Date.now() - 29 * 24 * 60 * 60 * 1000;
    const renewalExpiryCap = createdAt + 30 * 24 * 60 * 60 * 1000;
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? {
            rows: [
              {
                ticket_hash: "d".repeat(64),
                owner_email: "owner@example.com",
                target_path: "/page/doc_123",
                ...ticketAudienceFixture(),
                scope: "capability:mcp-directory-widget-read:example",
                created_at: createdAt,
                expires_at: createdAt + 5 * 60 * 1000,
              },
            ],
          }
        : { rows: [], rowsAffected: 1 },
    );

    await expect(
      readMcpDirectoryWidgetRenewalTicket("legacy-ticket"),
    ).resolves.toMatchObject({ renewalExpiresAtMs: renewalExpiryCap });

    vi.setSystemTime(renewalExpiryCap + 1);
    await expect(
      readMcpDirectoryWidgetRenewalTicket("legacy-ticket"),
    ).resolves.toBeNull();
  });

  it("rejects ticket creation when logout wins after the request was authenticated", async () => {
    let revokedBefore: number | null = null;
    let ticketInserted = false;
    dbExec.execute.mockImplementation(async ({ sql, args }) => {
      if (sql.includes("SELECT revoked_before")) {
        return {
          rows:
            revokedBefore === null ? [] : [{ revoked_before: revokedBefore }],
          rowsAffected: 0,
        };
      }
      if (sql.includes("INSERT INTO agent_native_embed_session_revocations")) {
        revokedBefore = Number(args[1]);
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
        ticketInserted = true;
      }
      return { rows: [], rowsAffected: 1 };
    });

    let releaseTicketInsert!: () => void;
    let signalTicketTransaction!: () => void;
    const ticketTransactionStarted = new Promise<void>((resolve) => {
      signalTicketTransaction = resolve;
    });
    const releaseTicketTransaction = new Promise<void>((resolve) => {
      releaseTicketInsert = resolve;
    });
    let transactionCount = 0;
    dbExec.transaction.mockImplementation(async (run) => {
      transactionCount += 1;
      if (transactionCount === 1) {
        signalTicketTransaction();
        await releaseTicketTransaction;
      }
      return run(dbExec);
    });

    const pendingTicket = runWithRequestContext(
      { userEmail: "owner@example.com" },
      async () => {
        const authenticatedAtMs =
          getRequestContext()?.identityAuthenticatedAtMs;
        expect(authenticatedAtMs).toBe(Date.now());
        return runWithRequestContext({ userEmail: "OWNER@example.com" }, () => {
          expect(getRequestContext()?.identityAuthenticatedAtMs).toBe(
            authenticatedAtMs,
          );
          return createEmbedSessionTicket({
            ownerEmail: "owner@example.com",
            targetPath: "/inbox",
          });
        });
      },
    ) as Promise<unknown>;

    await ticketTransactionStarted;
    await revokeEmbedSessionsForOwner("owner@example.com");
    releaseTicketInsert();

    await expect(pendingTicket).rejects.toThrow(
      "Embed session ticket creation was revoked by logout.",
    );
    expect(ticketInserted).toBe(false);
    expect(revokedBefore).toBe(Date.now());

    vi.advanceTimersByTime(1);
    await expect(
      runWithRequestContext({ userEmail: "owner@example.com" }, () =>
        createEmbedSessionTicket({
          ownerEmail: "owner@example.com",
          targetPath: "/inbox",
        }),
      ),
    ).resolves.toMatchObject({ ticket: expect.any(String) });
    expect(ticketInserted).toBe(true);
  });

  it("rejects ticket creation when the presented source session was revoked", async () => {
    let ticketInserted = false;
    dbExec.execute.mockImplementation(async ({ sql }) => {
      if (sql.includes("to_regclass")) {
        return {
          rows: [
            {
              legacy_sessions: "sessions",
              better_auth_sessions: "session",
              better_auth_users: "user",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
        ticketInserted = true;
      }
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.com",
          identityAuthenticatedAtMs: Date.now(),
          identitySessionToken: "revoked-cookie-session",
        },
        () =>
          createEmbedSessionTicket({
            ownerEmail: "owner@example.com",
            targetPath: "/inbox",
          }),
      ),
    ).rejects.toThrow("Embed session ticket source session was revoked.");
    expect(ticketInserted).toBe(false);
  });

  it("commits source-session deletion under the same owner locks as cutoffs", async () => {
    const operations: string[] = [];
    dbExec.execute.mockImplementation(async ({ sql }) => {
      operations.push(sql);
      return { rows: [], rowsAffected: 1 };
    });
    dbExec.transaction.mockImplementation(async (run) => {
      operations.push("BEGIN");
      await run(dbExec);
      operations.push("COMMIT");
    });

    await revokeEmbedSessionsForOwners(["owner@example.com"], async (tx) => {
      await tx.execute({
        sql: "DELETE FROM sessions WHERE email = ?",
        args: ["owner@example.com"],
      });
    });

    expect(operations).toEqual([
      "BEGIN",
      "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
      expect.stringContaining(
        "INSERT INTO agent_native_embed_session_revocations",
      ),
      "DELETE FROM sessions WHERE email = ?",
      "COMMIT",
    ]);
  });

  it("lets a signed-in collaborator redeem a resource-scoped capability", async () => {
    dbExec.execute
      .mockResolvedValueOnce({
        rows: [
          {
            owner_email: "owner@example.com",
            org_id: "owner-org",
            target_path: "/visual-edit/design-1?editorView=overview",
            ...ticketAudienceFixture(),
            scope: "capability:visual-edit:design:design-1",
            created_at: Date.now(),
            expires_at: Date.now() + 60_000,
            consumed_at: null,
          },
        ],
        rowsAffected: 0,
      })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    await expect(
      consumeEmbedSessionTicket("collaborator-ticket", {
        expectedOwnerEmail: "collaborator@example.com",
        allowCapabilityIdentityMismatch: true,
      }),
    ).resolves.toMatchObject({
      ownerEmail: "owner@example.com",
      scope: "capability:visual-edit:design:design-1",
    });
  });
});

describe("normalizeEmbedTargetPath", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts same-origin absolute URLs and strips APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/mail";
    expect(
      normalizeEmbedTargetPath(
        "https://app.example.com/mail/inbox?threadId=t1",
        "https://app.example.com",
      ),
    ).toBe("/inbox?threadId=t1");
  });

  it("rejects auth entry paths even when they include the configured base path", () => {
    process.env.APP_BASE_PATH = "/mail";
    expect(normalizeEmbedTargetPath("/mail/login")).toBeNull();
    expect(normalizeEmbedTargetPath("/mail/signup")).toBeNull();
  });

  it("rejects same-origin absolute URLs outside the current APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/dispatch";
    expect(
      normalizeEmbedTargetPath(
        "https://app.example.com/analytics/dashboards/q2",
        "https://app.example.com",
      ),
    ).toBeNull();
  });

  it("rejects cross-origin and unsafe relative paths", () => {
    expect(
      normalizeEmbedTargetPath(
        "https://evil.example.com/inbox",
        "https://app.example.com",
      ),
    ).toBeNull();
    expect(normalizeEmbedTargetPath("//evil.example.com")).toBeNull();
    expect(normalizeEmbedTargetPath("/http://evil.example.com")).toBeNull();
    expect(normalizeEmbedTargetPath("/foo\u0001bar")).toBeNull();
  });
});

describe("requestMatchesEmbedTarget", () => {
  beforeEach(() => {
    dbExec.execute.mockReset().mockResolvedValue({ rows: [] });
    process.env = { ...ORIGINAL_ENV };
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function fakeEvent(
    path: string,
    headers: Record<string, string> = {},
    options: { clientAddress?: string; origin?: string } = {},
  ) {
    const requestHeaders = new Headers(headers);
    const requestUrl = new URL(
      path,
      options.origin ?? `http://${headers.host ?? "mail.test"}`,
    );
    const responseHeaders = new Headers();
    return {
      path,
      url: requestUrl,
      req: {
        url: requestUrl.href,
        headers: requestHeaders,
        context: { clientAddress: options.clientAddress },
      },
      request: { url: requestUrl.href, headers: requestHeaders },
      headers: requestHeaders,
      node: {
        req: {
          url: path,
          headers,
          socket: { remoteAddress: options.clientAddress },
        },
      },
      res: { headers: responseHeaders, status: 200 },
      responseHeaders,
    } as any;
  }

  it("resolves Visual Edit metadata without granting other framework routes", async () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/visual-edit/design_1",
      scope: "capability:visual-edit:design:design_1",
    });
    await expect(
      resolveEmbedSessionFromRequest(
        credentialEvent("/_agent-native/webmcp/manifest", token, "query"),
      ),
    ).resolves.toMatchObject({
      scope: "capability:visual-edit:design:design_1",
    });
    await expect(
      resolveEmbedSessionFromRequest(
        credentialEvent("/_agent-native/org/me", token, "query"),
      ),
    ).resolves.toBeNull();
    const ordinary = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/inbox",
    });
    await expect(
      resolveEmbedSessionFromRequest(
        credentialEvent("/_agent-native/webmcp/manifest", ordinary, "query"),
      ),
    ).resolves.toBeNull();
  });

  it("resolves card read metadata without admitting other framework routes", async () => {
    const scope = createMcpDirectoryWidgetReadCapability({
      appId: "content",
      resourceUri: "ui://content/card",
      resourceIds: { documentId: "doc-1" },
      actionArguments: { "get-document": { id: "doc-1" } },
    })!;
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/page/doc-1",
      scope,
      ticketCreatedAtMs: Date.now(),
    });
    for (const path of [
      "/_agent-native/webmcp/manifest",
      "/_agent-native/webmcp/manifest/",
    ]) {
      await expect(
        resolveEmbedSessionFromRequest(credentialEvent(path, token, "query")),
      ).resolves.toMatchObject({ scope });
    }
    await expect(
      resolveEmbedSessionFromRequest(
        credentialEvent("/_agent-native/org/me", token, "query"),
      ),
    ).resolves.toBeNull();
  });

  it("distinguishes explicit embed traffic from an ambient capability cookie", () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/visual-edit/design_1",
      scope: "capability:visual-edit:design:design_1",
    });
    const path = "/_agent-native/webmcp/manifest";
    expect(
      hasEmbedSessionRequestMarker(credentialEvent(path, token, "cookie")),
    ).toBe(false);
    expect(
      hasEmbedSessionRequestMarker(credentialEvent(path, token, "query")),
    ).toBe(true);
    expect(
      hasEmbedSessionRequestMarker(
        credentialEvent(path, token, "bearer", {
          [EMBED_TARGET_HEADER]: "/visual-edit/design_1",
        }),
      ),
    ).toBe(true);
  });

  it.each([
    "/page/github%3Aowner%2Frepo",
    "/page/local-file%3Adocs%2Freadme%2emd",
  ])("matches encoded embed target %s on h3's pathname", (target) => {
    const event = fakeEvent(target);
    event.url = new H3Event(new Request(event.req.url)).url;
    expect(requestMatchesEmbedTarget(event, target)).toBe(true);
    expect(requestMatchesEmbedTarget(event, "/page/unrelated")).toBe(false);
  });

  function credentialEvent(
    path: string,
    token: string,
    transport: "bearer" | "query" | "cookie",
    headers: Record<string, string> = {},
  ) {
    const url = new URL(path, "http://mail.test");
    if (transport === "query") url.searchParams.set("__an_embed_token", token);
    return fakeEvent(`${url.pathname}${url.search}`, {
      host: "mail.test",
      origin: "null",
      ...(transport === "bearer" ? { authorization: `Bearer ${token}` } : {}),
      ...(transport === "cookie"
        ? { cookie: `${EMBED_SESSION_COOKIE}=${token}` }
        : {}),
      ...headers,
    });
  }

  it.each([
    { "x-forwarded-host": "" },
    { "x-forwarded-host": "mail.test/path" },
    { "x-forwarded-proto": "" },
    { "x-forwarded-proto": "javascript" },
  ])(
    "does not resolve an embed session with malformed authority: %j",
    async (headers) => {
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        audienceHost: "mail.test",
        targetPath: "/inbox",
      });
      const event = credentialEvent("/inbox", token, "cookie", headers);
      event.req.context.clientAddress = "127.0.0.1";
      await expect(resolveEmbedSessionFromRequest(event)).resolves.toBeNull();
      await expect(
        isExpiredMcpDirectoryWidgetSessionRequest(event),
      ).resolves.toBe(false);
    },
  );

  it.each([
    { "x-forwarded-host": "" },
    { "x-forwarded-host": "mail.test/path" },
    { "x-forwarded-proto": "" },
    { "x-forwarded-proto": "javascript" },
  ])(
    "keeps ticket mint, start and renewal strict for malformed authority: %j",
    async (headers) => {
      await embedSessionsStore.ready();
      const rows = installTicketStore();
      const scope = contentWidgetWriteScope();
      const ticket = await createEmbedSessionTicket({
        ownerEmail: "owner@example.com",
        targetPath: "/inbox",
        scope,
        audienceHost: "mail.test",
        revocationAnchorCreatedAtMs: Date.now(),
      });
      const event = fakeEvent(
        `/_agent-native/embed/start?ticket=${ticket.ticket}`,
        {
          host: "mail.test",
          ...headers,
        },
        { clientAddress: "127.0.0.1" },
      );
      const context = {
        userEmail: "owner@example.com",
        requestOrigin: "http://mail.test",
        resolveEmbedRequestOrigin: () => resolveEmbedRequestOrigin(event),
      };
      await expect(
        runWithRequestContext(context, () =>
          createEmbedSessionTicketForAudience({
            ownerEmail: "owner@example.com",
            targetPath: "/inbox",
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(createEmbedStartRouteHandler()(event)).rejects.toMatchObject(
        { statusCode: 400 },
      );
      await expect(
        runWithRequestContext(context, () =>
          renewMcpDirectoryWidgetSessionForAudience({
            sourceTicket: ticket.ticket,
            ownerEmail: "owner@example.com",
            expectedScope: scope,
            renewedScope: scope,
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(rows.get(ticket.ticketHash)?.consumed_at).toBeNull();
      expect(rows.get(ticket.ticketHash)?.scope).toBe(scope);
    },
  );

  it.each([
    ["/_agent-native/auth/session", "GET"],
    ["/_agent-native/application-state", "GET"],
    ["/_agent-native/actions/update-document", "POST"],
    ["/api/emails", "GET"],
  ])(
    "rejects ordinary embed cookies on unrelated %s requests with target hints",
    async (path, method) => {
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        audienceHost: "mail.test",
        targetPath: "/inbox",
        scope: "full",
      });
      const event = credentialEvent(
        `${path}?__an_embed_target=%2Finbox`,
        token,
        "cookie",
        {
          [EMBED_TARGET_HEADER]: "/inbox",
          referer: "http://mail.test/inbox?embedded=1",
        },
      );
      event.req.method = method;
      await expect(resolveEmbedSessionFromRequest(event)).resolves.toBeNull();
      expect(requestHasEmbedAuthMarker(event)).toBe(false);
    },
  );

  it.each([undefined, "full", "minimal", "none"])(
    "limits ordinary scope %s to its document and static runtime requests",
    async (scope) => {
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        audienceHost: "mail.test",
        targetPath: "/inbox?documentId=doc-1",
        scope,
      });
      for (const transport of ["bearer", "query", "cookie"] as const) {
        for (const path of [
          "/inbox?documentId=doc-1",
          "/@vite/client",
          "/app/entry.client.tsx",
          "/assets/app.js",
        ]) {
          const event = credentialEvent(path, token, transport);
          await expect(
            resolveEmbedSessionFromRequest(event),
          ).resolves.toMatchObject({ email: "owner@example.com" });
          expect(requestHasEmbedAuthMarker(event)).toBe(true);
        }
        for (const path of [
          "/inbox?documentId=doc-2",
          "/inbox?documentId=doc-1&documentId=doc-2",
          "/inbox",
          "/settings",
          "/api/emails",
          "/_agent-native/actions/list-emails",
          "/_agent-native/webmcp/actions/list-emails",
          "/_agent-native/auth/session",
          "/_agent-native/auth/session?__an_embed_target=%2Finbox%3FdocumentId%3Ddoc-1",
          "/_agent-native/application-state",
          "/_agent-native/db/query",
          "/_agent-native/files",
          "/_agent-native/agent/run",
          "/app/private-data",
          "/@other/runtime",
        ]) {
          const event = credentialEvent(path, token, transport, {
            [EMBED_TARGET_HEADER]: "/inbox?documentId=doc-1",
            referer: "http://mail.test/inbox?documentId=doc-1",
          });
          await expect(
            resolveEmbedSessionFromRequest(event),
          ).resolves.toBeNull();
          expect(requestHasEmbedAuthMarker(event)).toBe(false);
        }
        await expect(
          resolveEmbedSessionFromRequest(
            credentialEvent("/inbox?documentId=doc-1", token, transport, {
              host: "other.test",
            }),
          ),
        ).resolves.toBeNull();
      }
    },
  );

  it.each(["read", "write", "visual-edit", "bootstrap"] as const)(
    "resolves %s capability actions without a target hint or referrer",
    async (kind) => {
      const scope =
        kind === "read"
          ? createMcpDirectoryWidgetReadCapability({
              appId: "content",
              resourceUri: "ui://content/shell-v66",
              resourceIds: { documentId: "doc_123" },
              actionArguments: { "get-document": { documentId: "doc_123" } },
            })
          : kind === "write"
            ? contentWidgetWriteScope()
            : kind === "bootstrap"
              ? `capability:visual-edit-bootstrap:${"a".repeat(32)}`
              : "capability:visual-edit:design:design-1";
      if (!scope) throw new Error("Could not build capability fixture.");
      const ticketCreatedAtMs = Date.now();
      if (kind === "write") {
        dbExec.execute.mockImplementation(async ({ sql }: any) => ({
          rows: sql.includes("FROM agent_native_embed_tickets")
            ? [
                {
                  ticket_hash: "a".repeat(64),
                  owner_email: "owner@example.com",
                  target_path: "/page/doc_123",
                  ...ticketAudienceFixture("mail.test"),
                  scope,
                  created_at: ticketCreatedAtMs,
                  consumed_at: ticketCreatedAtMs,
                  renewal_expires_at: ticketCreatedAtMs + 24 * 60 * 60 * 1000,
                  session_active_until: ticketCreatedAtMs + 60_000,
                },
              ]
            : [],
        }));
      }
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        audienceHost: "mail.test",
        targetPath: "/page/doc_123",
        scope,
        ticketCreatedAtMs,
        ...(kind === "write" ? { sessionId: "a".repeat(64) } : {}),
      });
      for (const transport of ["bearer", "query", "cookie"] as const) {
        for (const path of [
          "/page/doc_123",
          "/@vite/client",
          "/_agent-native/actions/get-document",
          "/_agent-native/webmcp/actions/get-document",
        ]) {
          const event = credentialEvent(path, token, transport);
          await expect(
            resolveEmbedSessionFromRequest(event),
          ).resolves.toMatchObject({ email: "owner@example.com", scope });
          expect(requestHasEmbedAuthMarker(event)).toBe(true);
          expect(hasExplicitEmbedSessionCredential(event)).toBe(true);
        }
        for (const path of [
          "/page/other-document",
          "/api/documents/doc_123",
          "/_agent-native/application-state",
          "/_agent-native/auth/session",
          "/_agent-native/actions-other/get-document",
          "/_agent-native/webmcp/actions-other/get-document",
        ]) {
          const event = credentialEvent(path, token, transport, {
            [EMBED_TARGET_HEADER]: "/page/doc_123",
            referer: "http://mail.test/page/doc_123",
          });
          await expect(
            resolveEmbedSessionFromRequest(event),
          ).resolves.toBeNull();
          expect(requestHasEmbedAuthMarker(event)).toBe(false);
        }
        await expect(
          resolveEmbedSessionFromRequest(
            credentialEvent(
              "/_agent-native/actions/get-document",
              token,
              transport,
              { host: "other.test" },
            ),
          ),
        ).resolves.toBeNull();
      }
    },
  );

  it.each([
    [
      "/_agent-native/open?app=content&view=editor&documentId=doc-2",
      "/_agent-native/open?app=content&view=editor&documentId=doc-1",
    ],
    [
      "/_agent-native/open?app=mail&view=editor&documentId=doc-1",
      "/_agent-native/open?app=content&view=editor&documentId=doc-1",
    ],
    ["/inbox?documentId=doc-2", "/inbox?documentId=doc-1"],
    ["/?documentId=doc-2", "/?documentId=doc-1"],
    ["/?documentId=doc-2", "/"],
    [
      "/inbox?documentId=doc-2",
      "/_agent-native/open?view=inbox&documentId=doc-1",
    ],
    ["/inbox", "/_agent-native/open?to=%2Finbox%3FdocumentId%3Ddoc-1"],
    [
      "/inbox?documentId=doc-2",
      "/_agent-native/open?to=%2Finbox%3FdocumentId%3Ddoc-1",
    ],
    [
      "/page/doc-1?documentId=doc-2",
      "/_agent-native/open?view=editor&documentId=doc-1",
    ],
  ])(
    "rejects resource selectors %s outside target %s",
    async (path, targetPath) => {
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        audienceHost: "mail.test",
        targetPath,
      });
      const event = credentialEvent(path, token, "query", {
        [EMBED_TARGET_HEADER]: targetPath,
      });
      expect(requestMatchesEmbedTarget(event, targetPath)).toBe(false);
      await expect(resolveEmbedSessionFromRequest(event)).resolves.toBeNull();
    },
  );

  it.each([
    [
      "/inbox?documentId=doc-1&embedded=1&agentSidebar=closed",
      "/_agent-native/open?to=%2Finbox%3FdocumentId%3Ddoc-1",
    ],
    ["/inbox", "/_agent-native/open?app=mail&view=inbox&to=%2Finbox"],
  ])("preserves signed open destination %s", async (path, targetPath) => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath,
    });
    await expect(
      resolveEmbedSessionFromRequest(credentialEvent(path, token, "query")),
    ).resolves.toMatchObject({ targetPath });
  });

  it.each([
    ["/inbox", undefined],
    ["/@vite/client", undefined],
    [
      "/_agent-native/actions/get-document",
      "capability:visual-edit:design:design-1",
    ],
  ])("confines %s to the configured mounted app", async (path, scope) => {
    process.env.APP_BASE_PATH = "/mail";
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/inbox",
      scope,
    });
    await expect(
      resolveEmbedSessionFromRequest(
        credentialEvent(`/mail${path}`, token, "cookie"),
      ),
    ).resolves.toMatchObject({ email: "owner@example.com" });
    for (const prefix of ["", "/calendar", "/mailbox", "/mail/../calendar"]) {
      const event = credentialEvent(`${prefix}${path}`, token, "cookie", {
        [EMBED_TARGET_HEADER]: "/mail/inbox",
      });
      await expect(resolveEmbedSessionFromRequest(event)).resolves.toBeNull();
      expect(requestHasEmbedAuthMarker(event)).toBe(false);
    }
    const mounted = credentialEvent(path, token, "cookie");
    mounted.context = { _mountedPathname: `/mail${path}` };
    mounted.url = new URL(mounted.req.url);
    await expect(
      resolveEmbedSessionFromRequest(mounted),
    ).resolves.toMatchObject({ email: "owner@example.com" });
    mounted.context._mountedPathname = `/calendar${path}`;
    await expect(resolveEmbedSessionFromRequest(mounted)).resolves.toBeNull();
  });

  it.each([
    ["/mail", "/calendar"],
    ["", "/mail"],
    ["/mail", ""],
  ])(
    "binds tokens issued at %s to that mount when config changes to %s",
    async (sourceBase, otherBase) => {
      process.env.APP_BASE_PATH = sourceBase ? `${sourceBase}/` : "";
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        audienceHost: "mail.test",
        targetPath: "/inbox?documentId=doc-1",
      });
      expect(verifyEmbedSessionToken(token)).toMatchObject({
        ok: true,
        claims: { audienceBasePath: sourceBase },
      });
      for (const transport of ["bearer", "query", "cookie"] as const) {
        process.env.APP_BASE_PATH = sourceBase;
        const source = credentialEvent(
          `${sourceBase}/inbox?documentId=doc-1`,
          token,
          transport,
        );
        await expect(
          resolveEmbedSessionFromRequest(source),
        ).resolves.toMatchObject({ email: "owner@example.com" });
        expect(requestHasEmbedAuthMarker(source)).toBe(true);
        await expect(
          resolveEmbedSessionTokenForHost(token, "mail.test"),
        ).resolves.toMatchObject({ audienceBasePath: sourceBase });

        process.env.APP_BASE_PATH = otherBase;
        const other = credentialEvent(
          `${otherBase}/inbox?documentId=doc-1`,
          token,
          transport,
          {
            [EMBED_TARGET_HEADER]: `${otherBase}/inbox?documentId=doc-1`,
          },
        );
        await expect(resolveEmbedSessionFromRequest(other)).resolves.toBeNull();
        await expect(
          resolveEmbedSessionTokenForHost(token, "mail.test"),
        ).resolves.toBeNull();
        expect(requestHasEmbedAuthMarker(other)).toBe(false);
      }
    },
  );

  it("allows pre-mount audience claims only in an unmounted app", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const current = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/inbox",
    });
    const claims = JSON.parse(
      Buffer.from(current.split(".")[0], "base64url").toString(),
    );
    delete claims.audienceBasePath;
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", "embed-test-secret")
      .update(payload)
      .digest("base64url");
    const legacy = `${payload}.${signature}`;
    await expect(
      resolveEmbedSessionFromRequest(
        credentialEvent("/inbox", legacy, "cookie"),
      ),
    ).resolves.toMatchObject({ email: "owner@example.com" });
    process.env.APP_BASE_PATH = "/mail";
    const mounted = credentialEvent("/mail/inbox", legacy, "cookie", {
      [EMBED_TARGET_HEADER]: "/mail/inbox",
    });
    await expect(resolveEmbedSessionFromRequest(mounted)).resolves.toBeNull();
    expect(requestHasEmbedAuthMarker(mounted)).toBe(false);
  });

  it("keeps renewed and expired widget sessions within their issuing mount", async () => {
    vi.useFakeTimers();
    try {
      process.env.APP_BASE_PATH = "/mail";
      const createdAtMs = Date.now();
      const scope = contentWidgetWriteScope();
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        audienceHost: "mail.test",
        targetPath: "/page/doc_123",
        scope,
        ticketCreatedAtMs: createdAtMs,
        sessionId: "a".repeat(64),
        ttlSeconds: 1,
      });
      let activeUntilMs = createdAtMs + 60_000;
      dbExec.execute.mockImplementation(async ({ sql }: any) => ({
        rows: sql.includes("FROM agent_native_embed_tickets")
          ? [
              {
                ticket_hash: "a".repeat(64),
                owner_email: "owner@example.com",
                target_path: "/page/doc_123",
                ...ticketAudienceFixture("mail.test", "/mail"),
                scope,
                created_at: createdAtMs,
                consumed_at: createdAtMs,
                renewal_expires_at: createdAtMs + 24 * 60 * 60 * 1000,
                session_active_until: activeUntilMs,
              },
            ]
          : [],
      }));
      vi.advanceTimersByTime(2_000);
      await expect(
        resolveEmbedSessionFromRequest(
          credentialEvent(
            "/mail/_agent-native/actions/get-document",
            token,
            "cookie",
          ),
        ),
      ).resolves.toMatchObject({ scope });
      activeUntilMs = Date.now() - 1;
      await expect(
        isExpiredMcpDirectoryWidgetSessionRequest(
          credentialEvent(
            "/mail/_agent-native/actions/get-document",
            token,
            "cookie",
          ),
        ),
      ).resolves.toBe(true);
      process.env.APP_BASE_PATH = "/calendar";
      const other = credentialEvent(
        "/calendar/_agent-native/actions/get-document",
        token,
        "cookie",
        { [EMBED_TARGET_HEADER]: "/calendar/page/doc_123" },
      );
      await expect(
        isExpiredMcpDirectoryWidgetSessionRequest(other),
      ).resolves.toBe(false);
      activeUntilMs = Date.now() + 60_000;
      await expect(resolveEmbedSessionFromRequest(other)).resolves.toBeNull();
      await expect(
        resolveEmbedSessionTokenForHost(token, "mail.test"),
      ).resolves.toBeNull();
      expect(requestHasEmbedAuthMarker(other)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["bearer", "cookie"] as const)(
    "distinguishes explicit %s credentials from ambient cookies by route eligibility and expiry",
    async (transport) => {
      vi.useFakeTimers();
      try {
        const token = signEmbedSessionToken({
          ownerEmail: "owner@example.com",
          audienceHost: "mail.test",
          targetPath: "/inbox",
          ttlSeconds: 1,
        });
        const event = credentialEvent(
          "/_agent-native/actions/get-document",
          token,
          transport,
        );
        event.req.method = "POST";
        await expect(resolveEmbedSessionFromRequest(event)).resolves.toBeNull();
        expect(hasExplicitEmbedSessionCredential(event)).toBe(false);
        expect(hasPresentedEmbedSessionCredential(event)).toBe(
          transport === "bearer",
        );
        const document = credentialEvent("/inbox", token, transport);
        expect(hasPresentedEmbedSessionCredential(document)).toBe(true);
        vi.advanceTimersByTime(2_000);
        expect(verifyEmbedSessionToken(token)).toMatchObject({
          ok: false,
          reason: "expired",
        });
        expect(hasPresentedEmbedSessionCredential(event)).toBe(
          transport === "bearer",
        );
        expect(hasPresentedEmbedSessionCredential(document)).toBe(
          transport === "bearer",
        );
        const invalid = credentialEvent(
          "/_agent-native/actions/get-document",
          "invalid-stale-token",
          transport,
        );
        expect(hasPresentedEmbedSessionCredential(invalid)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([
    {
      path: "/inbox?documentId=doc-1",
      host: "mail.test",
      base: "",
      presented: true,
    },
    {
      path: "/inbox?documentId=doc-2",
      host: "mail.test",
      base: "",
      presented: false,
    },
    {
      path: "/inbox?documentId=doc-1&extra=1",
      host: "mail.test",
      base: "",
      presented: false,
    },
    { path: "/settings", host: "mail.test", base: "", presented: false },
    {
      path: "/inbox?documentId=doc-1",
      host: "calendar.test",
      base: "",
      presented: false,
    },
    {
      path: "/calendar/inbox?documentId=doc-1",
      host: "mail.test",
      base: "/calendar",
      presented: false,
    },
  ])(
    "classifies an ambient cookie from its signed target: $host $path",
    async ({ path, host, base, presented }) => {
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        audienceHost: "mail.test",
        targetPath: "/inbox?documentId=doc-1",
      });
      process.env.APP_BASE_PATH = base;
      const event = credentialEvent(path, token, "cookie", {
        host,
        referer: "http://mail.test/inbox?documentId=doc-1",
      });
      expect(hasPresentedEmbedSessionCredential(event)).toBe(presented);
      if (!presented)
        await expect(resolveEmbedSessionFromRequest(event)).resolves.toBeNull();
    },
  );

  it("recognizes explicit embed markers without treating an unrelated cookie as embed credentials", () => {
    expect(
      hasPresentedEmbedSessionCredential(
        fakeEvent("/_agent-native/actions/get-document?embedded=1"),
      ),
    ).toBe(true);
    expect(
      hasPresentedEmbedSessionCredential(
        fakeEvent(
          "/_agent-native/actions/get-document?__an_embed_token=invalid",
        ),
      ),
    ).toBe(true);
    expect(
      hasPresentedEmbedSessionCredential(
        fakeEvent("/_agent-native/actions/get-document", {
          [EMBED_TARGET_HEADER]: "/inbox",
        }),
      ),
    ).toBe(true);
    expect(
      hasPresentedEmbedSessionCredential(
        fakeEvent(
          "/_agent-native/actions/get-document?__an_embed_target=%2Finbox",
        ),
      ),
    ).toBe(true);
    expect(
      hasPresentedEmbedSessionCredential(
        fakeEvent("/_agent-native/actions/get-document", {
          cookie: `${EMBED_SESSION_COOKIE}=invalid-stale-cookie`,
        }),
      ),
    ).toBe(false);
  });

  it.each(["mount", "host"] as const)(
    "checks the ticket issuing %s before embed-start consumption",
    async (change) => {
      process.env.APP_BASE_PATH = "/mail";
      const rows = installTicketStore();
      const ticket = await runWithRequestContext(
        { requestOrigin: "https://mail.test" },
        () =>
          createEmbedSessionTicketForAudience({
            ownerEmail: "owner@example.com",
            targetPath: "/inbox",
          }),
      );
      expect(rows.get(ticket.ticketHash)).toMatchObject({
        audience_host: "mail.test",
        audience_base_path: "/mail",
      });
      const { createEmbedStartRouteHandler } = await import("./embed-route.js");
      const handler = createEmbedStartRouteHandler();
      process.env.APP_BASE_PATH = change === "mount" ? "/calendar" : "/mail";
      const other = fakeEvent(
        `${process.env.APP_BASE_PATH}/_agent-native/embed/start?ticket=${ticket.ticket}`,
        {
          host: change === "host" ? "other.test" : "mail.test",
          [EMBED_TARGET_HEADER]: `${process.env.APP_BASE_PATH}/inbox`,
        },
      );
      other.req.method = "GET";
      const denied = (await handler(other)) as Response;
      expect(denied.status).toBe(401);
      expect(rows.get(ticket.ticketHash)?.consumed_at).toBeNull();

      process.env.APP_BASE_PATH = "/mail";
      const source = fakeEvent(
        `/mail/_agent-native/embed/start?ticket=${ticket.ticket}`,
        { host: "mail.test" },
      );
      source.req.method = "GET";
      const accepted = (await handler(source)) as Response;
      expect(accepted.status).toBe(302);
      const location = new URL(
        accepted.headers.get("location")!,
        "http://mail.test",
      );
      expect(location.pathname).toBe("/mail/inbox");
      expect(
        verifyEmbedSessionToken(location.searchParams.get("__an_embed_token")),
      ).toMatchObject({
        ok: true,
        claims: {
          audienceHost: "mail.test",
          audienceBasePath: "/mail",
          targetPath: "/inbox",
        },
      });
      expect(rows.get(ticket.ticketHash)?.consumed_at).toEqual(
        expect.any(Number),
      );
    },
  );

  it("redeems and resolves an embed using a non-loopback platform's public request URL", async () => {
    process.env.WORKSPACE_GATEWAY_URL = "https://workspace.example.test";
    process.env.APP_BASE_PATH = "/mail";
    installTicketStore();
    const ticket = await runWithRequestContext(
      { requestOrigin: "https://workspace.example.test" },
      () =>
        createEmbedSessionTicketForAudience({
          ownerEmail: "owner@example.com",
          targetPath: "/inbox",
        }),
    );
    const { createEmbedStartRouteHandler } = await import("./embed-route.js");
    const headers = {
      host: "workspace.example.test",
      "x-forwarded-host": "internal.gateway:8100",
      "x-forwarded-proto": "http",
    };
    const start = fakeEvent(
      `/mail/_agent-native/embed/start?ticket=${ticket.ticket}`,
      headers,
      {
        clientAddress: "203.0.113.20",
        origin: "https://workspace.example.test",
      },
    );
    start.req.method = "GET";
    const response = (await createEmbedStartRouteHandler()(start)) as Response;
    expect(response.status).toBe(302);
    const location = new URL(
      response.headers.get("location")!,
      "https://workspace.example.test",
    );
    const document = fakeEvent(
      `${location.pathname}${location.search}`,
      headers,
      {
        clientAddress: "203.0.113.20",
        origin: "https://workspace.example.test",
      },
    );
    await expect(
      resolveEmbedSessionFromRequest(document),
    ).resolves.toMatchObject({ email: "owner@example.com" });
    const otherHost = fakeEvent(
      `${location.pathname}${location.search}`,
      {
        ...headers,
        host: "other.example",
        "x-forwarded-host": "workspace.example.test",
      },
      { clientAddress: "203.0.113.20", origin: "https://other.example" },
    );
    await expect(resolveEmbedSessionFromRequest(otherHost)).resolves.toBeNull();
  });

  it.each(["audience_host", "audience_base_path"])(
    "requires a fresh ticket when legacy metadata %s is unknown",
    async (column) => {
      const rows = installTicketStore();
      const ticket = await createEmbedSessionTicketForAudience({
        ownerEmail: "owner@example.com",
        targetPath: "/inbox",
        audienceHost: "mail.test",
      });
      delete rows.get(ticket.ticketHash)![column];
      await expect(
        consumeEmbedSessionTicketForAudience(ticket.ticket, {
          audienceHost: "mail.test",
        }),
      ).resolves.toBeNull();
      expect(rows.get(ticket.ticketHash)?.consumed_at).toBeNull();
    },
  );

  it("requires a trusted origin or explicit server host to mint an embed ticket", async () => {
    installTicketStore();
    await expect(
      runWithRequestContext({ requestOrigin: undefined }, () =>
        createEmbedSessionTicketForAudience({
          ownerEmail: "owner@example.com",
          targetPath: "/inbox",
        }),
      ),
    ).rejects.toThrow("trusted app audience");
    await expect(
      runWithRequestContext({ requestOrigin: undefined }, () =>
        createEmbedSessionTicketForAudience({
          ownerEmail: "owner@example.com",
          targetPath: "/inbox",
          audienceHost: "mail.test",
        }),
      ),
    ).resolves.toMatchObject({ ticket: expect.any(String) });
  });

  it("binds source-ticket lookup and in-place renewal to the original host and mount", async () => {
    process.env.APP_BASE_PATH = "/mail";
    const rows = installTicketStore();
    const scope = contentWidgetWriteScope();
    const ticket = await runWithRequestContext(
      { requestOrigin: "https://mail.test" },
      () =>
        createEmbedSessionTicketForAudience({
          ownerEmail: "owner@example.com",
          targetPath: "/page/doc_123",
          scope,
          ttlSeconds: 300,
          revocationAnchorCreatedAtMs: Date.now(),
        }),
    );
    await expect(
      consumeEmbedSessionTicketForAudience(ticket.ticket, {
        audienceHost: "mail.test",
      }),
    ).resolves.toMatchObject({ ownerEmail: "owner@example.com" });
    const original = { ...rows.get(ticket.ticketHash)! };
    for (const [base, host] of [
      ["/calendar", "mail.test"],
      ["/mail", "other.test"],
      ["", "mail.test"],
    ]) {
      process.env.APP_BASE_PATH = base;
      await runWithRequestContext(
        { requestOrigin: `https://${host}` },
        async () => {
          await expect(
            readMcpDirectoryWidgetRenewalTicketForAudience(ticket.ticket),
          ).resolves.toBeNull();
          await expect(
            renewMcpDirectoryWidgetSessionForAudience({
              sourceTicket: ticket.ticket,
              ownerEmail: "owner@example.com",
              expectedScope: scope,
              renewedScope: scope,
            }),
          ).resolves.toBeNull();
        },
      );
      expect(rows.get(ticket.ticketHash)).toEqual(original);
    }
    process.env.APP_BASE_PATH = "/mail";
    await runWithRequestContext(
      { requestOrigin: "https://mail.test" },
      async () => {
        await expect(
          readMcpDirectoryWidgetRenewalTicketForAudience(ticket.ticket),
        ).resolves.toMatchObject({ targetPath: "/page/doc_123", scope });
        await expect(
          renewMcpDirectoryWidgetSessionForAudience({
            sourceTicket: ticket.ticket,
            ownerEmail: "owner@example.com",
            expectedScope: scope,
            renewedScope: scope,
          }),
        ).resolves.toBeGreaterThan(original.session_active_until);
      },
    );
  });

  it("allows the route produced by an embedded open deep link", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/inbox?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=mail&view=inbox&threadId=t1",
      ),
    ).toBe(true);
  });

  it("allows record routes produced by template open-route resolvers", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/adhoc/q2-traffic?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=analytics&view=adhoc&dashboardId=q2-traffic",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/dashboards/q2-traffic?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=analytics&view=adhoc&dashboardId=q2-traffic",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/analyses/analysis-1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=analytics&view=analyses&analysisId=analysis-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/design/design-1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=design&view=editor&designId=design-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/page/doc-1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=content&view=editor&documentId=doc-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/deck/deck-1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=slides&view=editor&deckId=deck-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/deck/deck-1/present?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=slides&view=present&deckId=deck-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=slides&view=list",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/search?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=brain&view=capture&captureId=capture-1",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=calendar&view=calendar&eventId=event-1",
      ),
    ).toBe(true);
  });

  it("allows resolved open routes when the app is deployed under APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/mail";

    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/mail/inbox?embedded=1&__an_embed_token=tok"),
        "/mail/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(true);
  });

  it("allows known dashboard alias redirects used by app embeds", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/overview?embedded=1&__an_embed_token=tok"),
        "/",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent(
          "/dashboards/agent-native-templates-first-party?embedded=1&__an_embed_token=tok",
        ),
        "/dashboards",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent(
          "/adhoc/agent-native-templates-first-party?embedded=1&__an_embed_token=tok",
        ),
        "/dashboards",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent(
          "/adhoc/agent-native-templates-first-party?embedded=1&__an_embed_token=tok",
        ),
        "/traffic-dashboard",
      ),
    ).toBe(true);
  });

  it("does not match runtime requests through an embedded target referrer", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/_agent-native/application-state/compose", {
          host: "mail.agent-native.com",
          referer: "https://mail.agent-native.com/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox&composeDraftId=d1",
      ),
    ).toBe(false);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/api/emails?view=inbox", {
          host: "mail.agent-native.com",
          referer: "https://evil.example/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox&composeDraftId=d1",
      ),
    ).toBe(false);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent(
          "/_agent-native/application-state/compose",
          {
            host: "internal.gateway:3000",
            "x-forwarded-host": "mail.agent-native.com",
            "x-forwarded-proto": "https, http",
            referer: "https://evil.example/inbox?embedded=1",
          },
          { clientAddress: "127.0.0.1" },
        ),
        "/_agent-native/open?app=mail&view=inbox&composeDraftId=d1",
      ),
    ).toBe(false);
  });

  it("does not build thread record paths from unsafe view paths", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/evil/t1?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=mail&view=//evil&threadId=t1",
      ),
    ).toBe(false);
  });

  it("rejects dot-segment record ids before route matching", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/deck?embedded=1&__an_embed_token=tok"),
        "/_agent-native/open?app=slides&view=editor&deckId=..",
      ),
    ).toBe(false);
  });

  it("uses the browser URL, not the mounted handler path, for framework routes", () => {
    const event = fakeEvent("/");
    event.context = { _mountedPathname: "/_agent-native/open" };
    event.url.search = "?app=mail&view=inbox&embedded=1&__an_embed_token=tok";

    expect(
      requestMatchesEmbedTarget(
        event,
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(true);
  });

  it.each([false, true])(
    "keeps signed open selectors at a base path (handler-relative URL: %s)",
    (handlerRelative) => {
      process.env.APP_BASE_PATH = "/mail";
      const event = fakeEvent("/mail/_agent-native/open?view=editor");
      if (handlerRelative) {
        event.context = { _mountedPathname: "/mail/_agent-native/open" };
        event.url = new URL("http://mail.test/?view=editor");
      }
      const target =
        "/_agent-native/open?app=content&view=editor&documentId=doc-1";
      expect(requestMatchesEmbedTarget(event, target)).toBe(false);
      event.url.search = "?app=content&view=editor&documentId=doc-1";
      expect(requestMatchesEmbedTarget(event, target)).toBe(true);
      event.url.search = "?app=content&view=editor&documentId=doc-2";
      expect(requestMatchesEmbedTarget(event, target)).toBe(false);
    },
  );

  it("rejects unrelated page routes for the same token", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/settings?embedded=1"),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(false);
  });

  it("does not match runtime requests through an embed target header", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/_agent-native/actions/list-emails", {
          [EMBED_TARGET_HEADER]: "/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(false);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/api/emails?view=inbox&limit=25", {
          [EMBED_TARGET_HEADER]: "/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(false);

    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/_agent-native/actions/list-emails", {
          [EMBED_TARGET_HEADER]: "/settings?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(false);
  });

  it("does not mark ordinary bearer sessions on action routes through target headers", () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/picker?embedded=1",
      ttlSeconds: 60,
    });

    expect(
      requestHasEmbedAuthMarker(
        fakeEvent("/_agent-native/actions/list-libraries", {
          host: "mail.test",
          authorization: `Bearer ${token}`,
          [EMBED_TARGET_HEADER]: "/picker?embedded=1",
        }),
      ),
    ).toBe(false);
    expect(
      requestHasEmbedAuthMarker(
        fakeEvent("/_agent-native/actions/list-libraries", {
          host: "mail.test",
          authorization: `Bearer ${token}`,
          [EMBED_TARGET_HEADER]: "/settings?embedded=1",
        }),
      ),
    ).toBe(false);
  });

  it("rejects app data requests with an ordinary embed cookie without referrer headers", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      targetPath: "/inbox?__an_mcp_chat_bridge=1",
      ttlSeconds: 60,
    });

    const runtimeSession = await resolveEmbedSessionFromRequest(
      fakeEvent("/api/emails?view=inbox&limit=25", {
        host: "mail.test",
        cookie: `${EMBED_SESSION_COOKIE}=${token}`,
      }),
    );

    expect(runtimeSession).toBeNull();

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/settings", {
          host: "mail.test",
          cookie: `${EMBED_SESSION_COOKIE}=${token}`,
        }),
      ),
    ).resolves.toBeNull();
  });

  it("recognizes widget credentials without treating an unrelated cookie as explicit", () => {
    expect(
      hasExplicitEmbedSessionCredential(
        fakeEvent(
          "/_agent-native/actions/get-document?__an_embed_token=invalid",
        ),
      ),
    ).toBe(true);
    expect(
      hasExplicitEmbedSessionCredential(
        fakeEvent("/_agent-native/actions/get-document", {
          authorization: "Bearer invalid-widget-token",
          [EMBED_TARGET_HEADER]: "/page/doc-1?embedded=1",
        }),
      ),
    ).toBe(true);
    expect(
      hasExplicitEmbedSessionCredential(
        fakeEvent("/_agent-native/actions/get-document", {
          authorization: "Bearer unrelated-api-token",
        }),
      ),
    ).toBe(false);

    const embedCookie = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/design/design-1",
      scope: "capability:mcp-directory-widget-read:test",
      ticketCreatedAtMs: Date.now(),
      ttlSeconds: 60,
    });
    expect(
      hasExplicitEmbedSessionCredential(
        fakeEvent("/_agent-native/actions/get-document", {
          cookie: `${EMBED_SESSION_COOKIE}=${embedCookie}`,
        }),
      ),
    ).toBe(true);
    expect(
      hasExplicitEmbedSessionCredential(
        fakeEvent("/_agent-native/actions/get-document", {
          cookie: `${EMBED_SESSION_COOKIE}=${embedCookie}`,
          [EMBED_TARGET_HEADER]: "/design/design-1",
        }),
      ),
    ).toBe(true);
  });

  it("does not authenticate logout with an ordinary embed cookie", async () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/inbox",
      ttlSeconds: 60,
    });

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/_agent-native/auth/logout", {
          host: "mail.test",
          cookie: `${EMBED_SESSION_COOKIE}=${token}`,
        }),
      ),
    ).resolves.toBeNull();
  });

  it("revokes embed cookies across browser partitions after logout", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    let revokedBefore: number | null = null;
    dbExec.execute.mockImplementation(async ({ sql, args }: any) => {
      if (sql.includes("SELECT revoked_before")) {
        return {
          rows:
            revokedBefore === null ? [] : [{ revoked_before: revokedBefore }],
        };
      }
      if (sql.includes("INSERT INTO agent_native_embed_session_revocations")) {
        revokedBefore = args[1];
      }
      return { rows: [] };
    });
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/inbox",
      audienceHost: "beta.calendar.agent-native.com",
      ttlSeconds: 60,
    });
    const partitionedEmbedRequest = fakeEvent("/inbox", {
      host: "beta.calendar.agent-native.com",
      cookie: `${EMBED_SESSION_COOKIE}=${token}`,
    });

    await expect(
      resolveEmbedSessionFromRequest(partitionedEmbedRequest),
    ).resolves.toMatchObject({ email: "owner@example.com" });

    await revokeEmbedSessionsForOwner("OWNER@example.com");

    await expect(
      resolveEmbedSessionFromRequest(partitionedEmbedRequest),
    ).resolves.toBeNull();
  });

  it("accepts a session issued later in the same second as logout", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const second = Math.floor(Date.now() / 1000) * 1000;
    const revokedBefore = second + 1;
    const issuedAtMs = second + 2;
    const now = vi.spyOn(Date, "now").mockReturnValue(issuedAtMs);
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("SELECT revoked_before")
        ? { rows: [{ revoked_before: revokedBefore }] }
        : { rows: [] },
    );
    try {
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        targetPath: "/inbox",
        ttlSeconds: 60,
      });

      await expect(
        resolveEmbedSessionFromRequest(
          fakeEvent("/inbox", {
            host: "mail.test",
            cookie: `${EMBED_SESSION_COOKIE}=${token}`,
          }),
        ),
      ).resolves.toMatchObject({ email: "owner@example.com" });
      const verified = verifyEmbedSessionToken(token);
      expect(verified.ok && verified.claims.issuedAtMs).toBeGreaterThan(
        revokedBefore,
      );
      expect(verified.ok && verified.claims.iat).toBe(
        Math.floor(revokedBefore / 1000),
      );
    } finally {
      now.mockRestore();
    }
  });

  it("rejects a ticket session redeemed after its logout cutoff", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const ticketCreatedAtMs = Date.now() - 1000;
    const revokedBefore = Date.now() - 1;
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("SELECT revoked_before")
        ? { rows: [{ revoked_before: revokedBefore }] }
        : { rows: [] },
    );
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/inbox",
      ticketCreatedAtMs,
      ttlSeconds: 60,
    });

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/inbox", { cookie: `${EMBED_SESSION_COOKIE}=${token}` }),
      ),
    ).resolves.toBeNull();
    const verified = verifyEmbedSessionToken(token);
    expect(verified.ok && verified.claims.issuedAtMs).toBeGreaterThan(
      revokedBefore,
    );
    expect(verified.ok && verified.claims.ticketCreatedAtMs).toBe(
      ticketCreatedAtMs,
    );
  });

  it("rejects an unused embed ticket minted before logout", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const createdAt = Date.now() - 1000;
    dbExec.execute.mockImplementation(async ({ sql }: any) => {
      if (sql.includes("FROM agent_native_embed_tickets")) {
        return {
          rows: [
            {
              owner_email: "owner@example.com",
              target_path: "/inbox",
              ...ticketAudienceFixture(),
              created_at: createdAt,
              expires_at: Date.now() + 60_000,
              consumed_at: null,
            },
          ],
        };
      }
      if (sql.includes("SELECT revoked_before")) {
        return { rows: [{ revoked_before: Date.now() }] };
      }
      return { rows: [], rowsAffected: 1 };
    });

    await expect(consumeEmbedSessionTicket("pre-logout-ticket")).resolves.toBe(
      null,
    );
  });

  it("initializes the active lease when consuming a legacy widget write ticket", async () => {
    const ticket = "legacy-widget-ticket";
    const ticketHash = createHash("sha256").update(ticket).digest("hex");
    const createdAt = Date.now() - 1000;
    const expiresAt = Date.now() + 60_000;
    const scope = contentWidgetWriteScope({
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });
    dbExec.execute.mockImplementation(async ({ sql }: any) => {
      if (sql.includes("FROM agent_native_embed_tickets")) {
        return {
          rows: [
            {
              ticket_hash: ticketHash,
              owner_email: "owner@example.com",
              target_path: "/page/doc_123",
              ...ticketAudienceFixture(),
              scope,
              created_at: createdAt,
              expires_at: expiresAt,
              consumed_at: null,
              renewal_expires_at: null,
            },
          ],
        };
      }
      if (sql.includes("SELECT revoked_before")) return { rows: [] };
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      consumeEmbedSessionTicket(ticket, {
        expectedOwnerEmail: "owner@example.com",
      }),
    ).resolves.toMatchObject({
      ownerEmail: "owner@example.com",
      targetPath: "/page/doc_123",
      sessionId: ticketHash,
      scope,
    });
    const leaseUpdate = dbExec.execute.mock.calls.find(([query]) =>
      query.sql.includes("SET consumed_at = ?, session_active_until = ?"),
    );
    expect(leaseUpdate?.[0].args[0]).toBeTypeOf("number");
    expect(leaseUpdate?.[0].args.slice(1)).toEqual([expiresAt, ticketHash]);
  });

  it("serializes identity ticket claims and logout with the same owner lock", async () => {
    dbExec.transaction.mockClear();
    const createdAt = Date.now() - 1000;
    dbExec.execute.mockImplementation(async ({ sql }: any) => {
      if (sql.includes("FROM agent_native_embed_tickets")) {
        return {
          rows: [
            {
              owner_email: "owner@example.com",
              target_path: "/inbox",
              ...ticketAudienceFixture(),
              created_at: createdAt,
              expires_at: Date.now() + 60_000,
              consumed_at: null,
            },
          ],
        };
      }
      if (sql.includes("SELECT revoked_before")) return { rows: [] };
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      consumeEmbedSessionTicket("ticket-before-logout"),
    ).resolves.toMatchObject({ ticketCreatedAtMs: createdAt });
    const { revokeEmbedSessionsForOwner } = await import("./embed-session.js");
    await revokeEmbedSessionsForOwner("owner@example.com");

    const lockCalls = dbExec.execute.mock.calls.filter(([query]) =>
      query.sql.includes("pg_advisory_xact_lock"),
    );
    expect(lockCalls).toHaveLength(2);
    expect(lockCalls[0][0].args).toEqual(lockCalls[1][0].args);
    expect(dbExec.transaction).toHaveBeenCalledTimes(2);
  });

  it("binds first-party embed sessions to the host that redeemed the ticket", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const betaHost = "beta.calendar.agent-native.com";
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/inbox",
      audienceHost: betaHost,
      ttlSeconds: 60,
    });
    const betaRequest = fakeEvent("/inbox", {
      host: betaHost,
      cookie: `${EMBED_SESSION_COOKIE}=${token}`,
    });

    await expect(
      resolveEmbedSessionFromRequest(betaRequest),
    ).resolves.toMatchObject({
      email: "owner@example.com",
    });

    const siblingRequest = fakeEvent("/inbox", {
      host: "mail.agent-native.com",
      cookie: `${EMBED_SESSION_COOKIE}=${token}`,
    });
    await expect(
      resolveEmbedSessionFromRequest(siblingRequest),
    ).resolves.toBeNull();
    expect(requestHasEmbedAuthMarker(siblingRequest)).toBe(false);

    const legacyToken = signEmbedSessionToken({
      ownerEmail: "previous-owner@example.com",
      targetPath: "/inbox",
      ttlSeconds: 60,
    });
    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/inbox", {
          host: betaHost,
          cookie: `${EMBED_SESSION_COOKIE}=${legacyToken}`,
        }),
      ),
    ).resolves.toBeNull();

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent(
          "/inbox",
          {
            host: "internal.gateway:3000",
            "x-forwarded-host": betaHost,
            "x-forwarded-proto": "https, http",
            cookie: `${EMBED_SESSION_COOKIE}=${legacyToken}`,
          },
          { clientAddress: "127.0.0.1" },
        ),
      ),
    ).resolves.toBeNull();

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/inbox", {
          host: "beta.calendar.agent-native.com.",
          cookie: `${EMBED_SESSION_COOKIE}=${legacyToken}`,
        }),
      ),
    ).resolves.toBeNull();
  });

  it("accepts signed-out visual-edit bootstrap tokens only on their issuing host", async () => {
    const host = "beta.design.agent-native.com";
    const token = signEmbedSessionToken({
      ownerEmail: "bootstrap@example.invalid",
      targetPath: "/visual-edit",
      audienceHost: host,
      scope: `capability:visual-edit-bootstrap:${"a".repeat(32)}`,
      ttlSeconds: 300,
    });

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent(
          "/visual-edit",
          {
            host: "internal.gateway:3000",
            "x-forwarded-host": host,
            "x-forwarded-proto": "https",
            authorization: `Bearer ${token}`,
          },
          { clientAddress: "127.0.0.1" },
        ),
      ),
    ).resolves.toMatchObject({
      email: "bootstrap@example.invalid",
      scope: `capability:visual-edit-bootstrap:${"a".repeat(32)}`,
    });

    const siblingRequest = fakeEvent(
      "/visual-edit",
      {
        host: "internal.gateway:3000",
        "x-forwarded-host": "beta.calendar.agent-native.com",
        "x-forwarded-proto": "https",
        authorization: `Bearer ${token}`,
      },
      { clientAddress: "127.0.0.1" },
    );
    await expect(resolveEmbedSessionFromRequest(siblingRequest)).resolves.toBe(
      null,
    );
    expect(requestHasEmbedAuthMarker(siblingRequest)).toBe(false);
  });

  it("binds custom-host embed sessions to their audience while preserving legacy tokens", async () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/inbox",
      audienceHost: "app-a.example.com",
      ttlSeconds: 60,
    });

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/inbox", {
          host: "app-a.example.com",
          cookie: `${EMBED_SESSION_COOKIE}=${token}`,
        }),
      ),
    ).resolves.toMatchObject({ email: "owner@example.com" });
    const siblingRequest = fakeEvent("/inbox", {
      host: "app-b.example.com",
      cookie: `${EMBED_SESSION_COOKIE}=${token}`,
    });
    await expect(
      resolveEmbedSessionFromRequest(siblingRequest),
    ).resolves.toBeNull();
    expect(requestHasEmbedAuthMarker(siblingRequest)).toBe(false);

    const legacyToken = signEmbedSessionToken({
      ownerEmail: "legacy@example.com",
      targetPath: "/inbox",
      ttlSeconds: 60,
    });
    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/inbox", {
          host: "app-b.example.com",
          cookie: `${EMBED_SESSION_COOKIE}=${legacyToken}`,
        }),
      ),
    ).resolves.toMatchObject({ email: "legacy@example.com" });
  });

  it("keeps first-party embed session cookies host-only", () => {
    vi.stubEnv("APP_NAME", "calendar");
    process.env.APP_URL = "https://beta.calendar.agent-native.com";
    process.env.COOKIE_DOMAIN = ".agent-native.com";
    const event = fakeEvent("/", {
      host: "beta.calendar.agent-native.com",
      "x-forwarded-proto": "https",
    });

    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/",
    });
    setEmbedSessionCookie(event, token);

    const cookie = event.res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${EMBED_SESSION_COOKIE}=${token}`);
    expect(cookie).not.toMatch(/Domain=\.agent-native\.com/i);
  });

  it("caps cookie Max-Age at the signed token's remaining lifetime", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
      const token = signEmbedSessionToken({
        ownerEmail: "owner@example.com",
        targetPath: "/inbox",
        ttlSeconds: 60,
      });
      vi.advanceTimersByTime(20_250);
      const event = fakeEvent("/inbox");
      setEmbedSessionCookie(event, token);
      expect(event.res.headers.get("set-cookie")).toMatch(/Max-Age=39(?:;|$)/i);
      vi.advanceTimersByTime(39_750);
      expect(verifyEmbedSessionToken(token)).toMatchObject({
        ok: false,
        reason: "expired",
      });
      const expired = fakeEvent("/inbox");
      setEmbedSessionCookie(expired, token);
      expect(expired.res.headers.get("set-cookie")).toMatch(
        /Max-Age=0(?:;|$)/i,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows Vite module runtime requests with the embed query token", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      targetPath: "/picker?mediaType=image",
      ttlSeconds: 60,
    });
    const event = fakeEvent(`/@vite/client?__an_embed_token=${token}`, {
      host: "mail.test",
    });

    await expect(resolveEmbedSessionFromRequest(event)).resolves.toMatchObject({
      email: "owner@example.com",
      orgId: "org_123",
      targetPath: "/picker?mediaType=image",
    });
    expect(requestHasEmbedAuthMarker(event)).toBe(true);
  });

  it("sets no-referrer when exchanging a query token for an embed cookie", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/inbox",
      ttlSeconds: 60,
    });
    const event = fakeEvent(
      `/inbox?embedded=1&__an_embed_token=${encodeURIComponent(token)}`,
      { host: "mail.test" },
    );

    await expect(resolveEmbedSessionFromRequest(event)).resolves.toMatchObject({
      email: "owner@example.com",
    });
    expect(event.responseHeaders.get("referrer-policy")).toBe("no-referrer");
  });

  it("allows visual-edit actions independently of target hints while retaining document scope", async () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      audienceHost: "mail.test",
      targetPath: "/visual-edit/design-1?editorView=overview",
      scope: "capability:visual-edit:design:design-1",
      ttlSeconds: 60,
    });
    for (const hint of ["/visual-edit/design-1", "/design/design-2"]) {
      const event = fakeEvent(
        `/_agent-native/actions/get-design?__an_embed_token=${token}&${EMBED_TARGET_QUERY_PARAM}=${encodeURIComponent(hint)}`,
        { host: "mail.test", origin: "null" },
      );
      await expect(
        resolveEmbedSessionFromRequest(event),
      ).resolves.toMatchObject({
        scope: "capability:visual-edit:design:design-1",
      });
    }
    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/design/design-1", {
          host: "mail.test",
          cookie: `${EMBED_SESSION_COOKIE}=${token}`,
        }),
      ),
    ).resolves.toBeNull();
  });

  it("allows capability-authenticated static modules without widening app routes", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/visual-edit/design-1",
      scope: "capability:visual-edit:design:design-1",
      ttlSeconds: 60,
    });

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/@vite/client", {
          host: "mail.test",
          cookie: `${EMBED_SESSION_COOKIE}=${token}`,
        }),
      ),
    ).resolves.toMatchObject({
      scope: "capability:visual-edit:design:design-1",
    });
    expect(
      requestHasEmbedAuthMarker(
        fakeEvent("/_agent-native/application-state", {
          host: "mail.test",
          cookie: `${EMBED_SESSION_COOKIE}=${token}`,
        }),
      ),
    ).toBe(false);
  });
});

describe("directory widget write session renewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    dbExec.execute.mockReset().mockResolvedValue({ rows: [], rowsAffected: 1 });
    dbExec.transaction
      .mockReset()
      .mockImplementation(async (run) => run(dbExec));
    process.env = { ...ORIGINAL_ENV, OAUTH_STATE_SECRET: "embed-test-secret" };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...ORIGINAL_ENV };
  });

  function sessionRow(overrides: Record<string, unknown> = {}) {
    const createdAtMs = Date.now() - 60_000;
    return {
      owner_email: "owner@example.com",
      org_id: "org_123",
      target_path: "/page/doc_123",
      ...ticketAudienceFixture(),
      scope: contentWidgetWriteScope({ orgId: "org_123" }),
      created_at: createdAtMs,
      consumed_at: createdAtMs + 1,
      renewal_expires_at: createdAtMs + 30 * 24 * 60 * 60 * 1000,
      session_active_until: Date.now() - 1,
      ...overrides,
    };
  }

  it("renews only the consumed user's original artifact and action scope", async () => {
    const currentScope = contentWidgetWriteScope({
      orgId: "org_123",
      expiresAtMs: Date.now() + 5 * 60 * 1000,
    });
    const renewedScope = contentWidgetWriteScope({ orgId: "org_123" });
    const updates: unknown[][] = [];
    dbExec.execute.mockImplementation(async ({ sql, args }: any) => {
      if (sql.includes("FROM agent_native_embed_tickets")) {
        return { rows: [sessionRow({ scope: currentScope })] };
      }
      if (sql.startsWith("UPDATE agent_native_embed_tickets")) {
        updates.push(args);
      }
      return { rows: [], rowsAffected: 1 };
    });

    await expect(
      renewMcpDirectoryWidgetSession({
        sourceTicket: "source-ticket",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        expectedScope: currentScope,
        renewedScope,
      }),
    ).resolves.toBe(Date.now() + 15 * 60 * 1000);

    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toBe(renewedScope);
    expect(updates[0][3]).toBe(currentScope);
  });

  it("rejects renewal into a different artifact scope", async () => {
    const currentScope = contentWidgetWriteScope({ orgId: "org_123" });
    const escapedScope = contentWidgetWriteScope({
      orgId: "org_123",
      resourceId: "another-document",
    });
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? { rows: [sessionRow({ scope: currentScope })] }
        : { rows: [], rowsAffected: 1 },
    );

    await expect(
      renewMcpDirectoryWidgetSession({
        sourceTicket: "source-ticket",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        expectedScope: currentScope,
        renewedScope: escapedScope,
      }),
    ).resolves.toBeNull();
    expect(dbExec.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("UPDATE agent_native_embed_tickets"),
      }),
    );
  });

  it("rejects renewal after the hard 30-day cutoff", async () => {
    const currentScope = contentWidgetWriteScope({ orgId: "org_123" });
    const createdAtMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? {
            rows: [
              sessionRow({
                scope: currentScope,
                created_at: createdAtMs,
                consumed_at: createdAtMs + 1,
                renewal_expires_at: createdAtMs + 30 * 24 * 60 * 60 * 1000,
              }),
            ],
          }
        : { rows: [], rowsAffected: 1 },
    );

    await expect(
      renewMcpDirectoryWidgetSession({
        sourceTicket: "source-ticket",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        expectedScope: currentScope,
        renewedScope: currentScope,
      }),
    ).resolves.toBeNull();
  });

  it("does not renew a ticket for another user", async () => {
    const currentScope = contentWidgetWriteScope({ orgId: "org_123" });
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? { rows: [sessionRow({ scope: currentScope })] }
        : { rows: [], rowsAffected: 1 },
    );

    await expect(
      renewMcpDirectoryWidgetSession({
        sourceTicket: "source-ticket",
        ownerEmail: "attacker@example.com",
        orgId: "org_123",
        expectedScope: currentScope,
        renewedScope: currentScope,
      }),
    ).resolves.toBeNull();
  });

  it("accepts an expired token only while its exact widget session lease is active", async () => {
    const createdAtMs = Date.now() - 60_000;
    const scope = contentWidgetWriteScope({ orgId: "org_123" });
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      audienceHost: "content.example.test",
      targetPath: "/page/doc_123",
      scope,
      ticketCreatedAtMs: createdAtMs,
      sessionId: "b".repeat(64),
      ttlSeconds: 1,
    });
    const row = sessionRow({
      scope,
      created_at: createdAtMs,
      consumed_at: createdAtMs + 1,
      session_active_until: Date.now() + 60_000,
    });
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? { rows: [row] }
        : { rows: [], rowsAffected: 1 },
    );
    vi.advanceTimersByTime(2_000);

    await expect(
      resolveEmbedSessionTokenForHost(token, "content.example.test"),
    ).resolves.toMatchObject({ ownerEmail: "owner@example.com", scope });

    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? {
            rows: [
              sessionRow({ ...row, session_active_until: Date.now() - 1 }),
            ],
          }
        : { rows: [], rowsAffected: 1 },
    );
    await expect(
      resolveEmbedSessionTokenForHost(token, "content.example.test"),
    ).resolves.toBeNull();
  });

  it("does not let another user use a session id from a widget token", async () => {
    const createdAtMs = Date.now() - 60_000;
    const token = signEmbedSessionToken({
      ownerEmail: "attacker@example.com",
      orgId: "org_123",
      audienceHost: "content.example.test",
      targetPath: "/page/doc_123",
      scope: contentWidgetWriteScope({
        userEmail: "attacker@example.com",
        orgId: "org_123",
      }),
      ticketCreatedAtMs: createdAtMs,
      sessionId: "c".repeat(64),
      ttlSeconds: 1,
    });
    dbExec.execute.mockImplementation(async ({ sql }: any) =>
      sql.includes("FROM agent_native_embed_tickets")
        ? {
            rows: [
              sessionRow({
                created_at: createdAtMs,
                consumed_at: createdAtMs + 1,
                session_active_until: Date.now() + 60_000,
              }),
            ],
          }
        : { rows: [], rowsAffected: 1 },
    );

    await expect(
      resolveEmbedSessionTokenForHost(token, "content.example.test"),
    ).resolves.toBeNull();
  });
});

describe("directory widget recovery after a chat reload", () => {
  const OWNER = "owner@example.com";
  const ORG = "org_123";
  const RESOURCE_URI = "ui://content/shell-v66";
  const HOUR_MS = 60 * 60 * 1000;
  const rows = new Map<string, Record<string, unknown>>();
  let revokedBefore: number | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    process.env = { ...ORIGINAL_ENV, OAUTH_STATE_SECRET: "embed-test-secret" };
    rows.clear();
    revokedBefore = null;
    dbExec.transaction
      .mockReset()
      .mockImplementation(async (run) => run(dbExec));
    dbExec.execute
      .mockReset()
      .mockImplementation(async ({ sql, args }: any) => {
        if (sql.includes("INSERT INTO agent_native_embed_tickets")) {
          const [hash, owner, org, target, scope, created, expires, , renewal] =
            args;
          rows.set(hash, {
            ticket_hash: hash,
            owner_email: owner,
            org_id: org,
            target_path: target,
            audience_host: args[10],
            audience_base_path: args[11],
            scope,
            created_at: created,
            expires_at: expires,
            consumed_at: null,
            renewal_expires_at: renewal,
            session_active_until: args[9],
          });
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("FROM agent_native_embed_tickets WHERE ticket_hash")) {
          const row = rows.get(args[0]);
          return { rows: row ? [{ ...row }] : [], rowsAffected: 0 };
        }
        if (
          sql.startsWith("UPDATE agent_native_embed_tickets SET consumed_at")
        ) {
          const row = rows.get(args[2]);
          if (!row || row.consumed_at != null)
            return { rows: [], rowsAffected: 0 };
          row.consumed_at = args[0];
          row.session_active_until = args[1];
          return { rows: [], rowsAffected: 1 };
        }
        if (sql.includes("SELECT revoked_before")) {
          return {
            rows:
              revokedBefore === null ? [] : [{ revoked_before: revokedBefore }],
          };
        }
        if (
          sql.includes("INSERT INTO agent_native_embed_session_revocations")
        ) {
          revokedBefore = Number(args[1]);
        }
        return { rows: [], rowsAffected: 1 };
      });
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...ORIGINAL_ENV };
  });

  /** The result ticket the tool call minted, as the widget persists it. */
  async function mintAndConsumeSourceTicket(scope: string) {
    const createdBefore = Date.now() - 1000;
    const { ticket } = await createEmbedSessionTicket({
      ownerEmail: OWNER,
      orgId: ORG,
      targetPath: "/page/doc_123",
      scope,
      ttlSeconds: 5 * 60,
      revocationAnchorCreatedAtMs: createdBefore,
    });
    await expect(
      consumeEmbedSessionTicket(ticket, { expectedOwnerEmail: OWNER }),
    ).resolves.toMatchObject({ ownerEmail: OWNER, orgId: ORG });
    return ticket;
  }

  /** What the start tool does for a persisted source ticket. */
  async function renewFrom(
    sourceTicket: string,
    caller: { readAllowed?: boolean; writeAllowed?: boolean } = {},
  ) {
    const original = await readMcpDirectoryWidgetRenewalTicket(sourceTicket);
    if (!original) throw new Error("source ticket unavailable");
    const scope = renewMcpDirectoryWidgetCapabilityScope(original.scope, {
      appId: "content",
      resourceUri: RESOURCE_URI,
      userEmail: OWNER,
      orgId: ORG,
      expiresAtMs: Date.now() + 15 * 60 * 1000,
      readAllowed: caller.readAllowed ?? true,
      writeAllowed: caller.writeAllowed ?? true,
    });
    if (!scope) throw new Error("renewed scope unavailable");
    const renewed = await createEmbedSessionTicket({
      ownerEmail: OWNER,
      orgId: ORG,
      targetPath: original.targetPath,
      scope,
      ttlSeconds: 15 * 60,
      renewalExpiresAtMs: original.renewalExpiresAtMs,
      revocationAnchorCreatedAtMs: original.createdAtMs,
    });
    return { original, scope, renewed };
  }

  it("refuses the replayed start URL but renews the same user and artifact hours later", async () => {
    const source = await mintAndConsumeSourceTicket(
      contentWidgetWriteScope({ orgId: ORG }),
    );

    vi.advanceTimersByTime(3 * HOUR_MS);

    let replay: string | undefined;
    await expect(
      consumeEmbedSessionTicket(source, {
        expectedOwnerEmail: OWNER,
        onResult: (diagnostic) => {
          replay = diagnostic.outcome;
        },
      }),
    ).resolves.toBeNull();
    expect(replay).toBe("already-consumed");

    const { scope, renewed } = await renewFrom(source);
    const session = await consumeEmbedSessionTicket(renewed.ticket, {
      expectedOwnerEmail: OWNER,
    });

    expect(session).toMatchObject({
      ownerEmail: OWNER,
      orgId: ORG,
      targetPath: "/page/doc_123",
      scope,
    });
    expect(
      getMcpDirectoryWidgetWriteCapabilityGrant(session?.scope, {
        appId: "content",
        resourceUri: RESOURCE_URI,
        userEmail: OWNER,
        orgId: ORG,
      }),
    ).toEqual({
      resourceIds: { documentId: "doc_123" },
      actionNames: ["update-document"],
    });

    // A second reload still holds only the first result's ticket.
    vi.advanceTimersByTime(HOUR_MS);
    const again = await renewFrom(source);
    await expect(
      consumeEmbedSessionTicket(again.renewed.ticket, {
        expectedOwnerEmail: OWNER,
      }),
    ).resolves.toMatchObject({ ownerEmail: OWNER, scope: again.scope });
  });

  it("degrades a restored write widget to read without upgrading it", async () => {
    const source = await mintAndConsumeSourceTicket(
      contentWidgetWriteScope({ orgId: ORG }),
    );
    vi.advanceTimersByTime(3 * HOUR_MS);

    const { scope } = await renewFrom(source, { writeAllowed: false });
    expect(isMcpDirectoryWidgetReadCapabilityScope(scope)).toBe(true);
    expect(isMcpDirectoryWidgetWriteCapabilityScope(scope)).toBe(false);

    const readSource = await mintAndConsumeSourceTicket(
      createMcpDirectoryWidgetReadCapability({
        appId: "content",
        resourceUri: RESOURCE_URI,
        resourceIds: { documentId: "doc_123" },
        actionArguments: { "get-document": { documentId: "doc_123" } },
      })!,
    );
    const renewedRead = await renewFrom(readSource, { writeAllowed: true });
    expect(isMcpDirectoryWidgetWriteCapabilityScope(renewedRead.scope)).toBe(
      false,
    );
  });

  it("refuses to renew once the owner logged out after the source ticket was minted", async () => {
    const source = await mintAndConsumeSourceTicket(
      contentWidgetWriteScope({ orgId: ORG }),
    );
    vi.advanceTimersByTime(HOUR_MS);
    await revokeEmbedSessionsForOwner(OWNER);
    vi.advanceTimersByTime(HOUR_MS);

    await expect(renewFrom(source)).rejects.toThrow(
      "Embed session ticket creation was revoked by logout.",
    );
  });

  it("stops renewing 30 days after the source ticket was minted", async () => {
    const source = await mintAndConsumeSourceTicket(
      contentWidgetWriteScope({ orgId: ORG }),
    );
    vi.advanceTimersByTime(30 * 24 * HOUR_MS);

    await expect(
      readMcpDirectoryWidgetRenewalTicket(source),
    ).resolves.toBeNull();
  });
});

describe("directory widget session token size", () => {
  // A browser drops a cookie whose name and value exceed 4096 bytes.
  const COOKIE_NAME_VALUE_LIMIT = 4096;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, OAUTH_STATE_SECRET: "embed-test-secret" };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function slidesWidgetToken({
    deckId,
    email,
    orgId,
  }: {
    deckId: string;
    email: string;
    orgId?: string;
  }) {
    const target = {
      resourceIds: { deckId, resourceType: "deck" },
      writeActions: Object.keys(slidesProfile.widgetWriteActionArguments),
    };
    const materialize = (
      argumentMaps: Record<string, Record<string, unknown>>,
      only?: readonly string[],
    ) =>
      Object.fromEntries(
        Object.entries(argumentMaps)
          .filter(([name]) => !only || only.includes(name))
          .map(([name, args]) => [
            name,
            Object.fromEntries(
              Object.entries(args).map(([key, rule]) => [
                key,
                typeof rule === "string" ? target.resourceIds[rule] : rule,
              ]),
            ),
          ]),
      );
    const scope = createMcpDirectoryWidgetWriteCapability({
      appId: "slides",
      resourceUri: "ui://slides/shell-v69",
      resourceIds: target.resourceIds,
      userEmail: email,
      ...(orgId ? { orgId } : {}),
      expiresAtMs: Date.now() + 15 * 60 * 1000,
      readActionArguments: materialize(
        slidesProfile.widgetReadActionArguments as never,
      ) as never,
      writeActionArguments: materialize(
        slidesProfile.widgetWriteActionArguments as never,
        target.writeActions,
      ) as never,
    });
    if (!scope) throw new Error("Could not build the Slides widget scope.");
    return {
      scope,
      token: signEmbedSessionToken({
        ownerEmail: email,
        orgId,
        targetPath: `/deck/${encodeURIComponent(deckId)}?__an_mcp_chat_bridge=1`,
        audienceHost: "slides.agent-native.com",
        scope,
        ticketCreatedAtMs: Date.now(),
        sessionId: "a".repeat(64),
        ttlSeconds: 15 * 60,
      }),
    };
  }

  it("fits a representative deck grant in one cookie for a realistic user and org", () => {
    const { scope, token } = slidesWidgetToken({
      deckId: "deck-V1StGXR8_Z5jdHi6B-myT-cd1",
      email: "taylor.reviewer@example-company.com",
      orgId: "org_2f6c1f6e-9a2b-4c0a-8d4e-0b7f1b8e3a11",
    });
    const cookieBytes = `${EMBED_SESSION_COOKIE}=${token}`.length;

    expect(scope.length).toBeLessThan(2500);
    // Keep at least 800 bytes between a realistic widget and the cookie limit.
    expect(cookieBytes).toBeLessThan(COOKIE_NAME_VALUE_LIMIT - 800);
  });

  function cookieEvent(host: string) {
    const requestHeaders = new Headers({
      host,
      "x-forwarded-proto": "https",
    });
    const requestUrl = new URL("/", `https://${host}`);
    return {
      path: "/",
      req: { url: requestUrl.href, headers: requestHeaders },
      request: { url: requestUrl.href, headers: requestHeaders },
      headers: requestHeaders,
      node: { req: { url: "/", headers: { host } } },
      res: { headers: new Headers(), status: 200 },
    } as any;
  }

  it("sets the realistic token as a cookie", () => {
    const { token } = slidesWidgetToken({
      deckId: "deck-V1StGXR8_Z5jdHi6B-myT-cd1",
      email: "taylor.reviewer@example-company.com",
      orgId: "org_2f6c1f6e-9a2b-4c0a-8d4e-0b7f1b8e3a11",
    });
    const event = cookieEvent("slides.agent-native.com");

    setEmbedSessionCookie(event, token);

    expect(event.res.headers.get("set-cookie")).toContain(
      `${EMBED_SESSION_COOKIE}=${token}`,
    );
  });

  it("expires the cookie instead of sending the widest grant the browser would drop", () => {
    const { token } = slidesWidgetToken({
      deckId: `deck-${"x".repeat(240)}`,
      email: `${"u".repeat(64)}@${"d".repeat(63)}.${"e".repeat(63)}.${"f".repeat(64)}.com`,
      orgId: "o".repeat(256),
    });
    expect(`${EMBED_SESSION_COOKIE}=${token}`.length).toBeGreaterThan(
      COOKIE_NAME_VALUE_LIMIT,
    );
    // The token is still valid: the page keeps it and sends it as a query or
    // bearer token, which resolve ahead of the cookie.
    expect(verifyEmbedSessionToken(token).ok).toBe(true);
    const event = cookieEvent("slides.agent-native.com");

    setEmbedSessionCookie(event, token);

    const cookie = event.res.headers.get("set-cookie") ?? "";
    expect(cookie).not.toContain(token);
    expect(cookie).toContain(`${EMBED_SESSION_COOKIE}=;`);
    expect(cookie).toMatch(/Max-Age=0/i);
  });
});
