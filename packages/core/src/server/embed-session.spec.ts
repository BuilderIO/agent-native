import { createHash } from "node:crypto";

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

import {
  EMBED_SESSION_COOKIE,
  EMBED_TARGET_HEADER,
  EMBED_TARGET_QUERY_PARAM,
  createMcpDirectoryWidgetReadCapability,
  createMcpDirectoryWidgetWriteCapability,
} from "../shared/embed-auth.js";
import {
  requestMatchesEmbedTarget,
  normalizeEmbedTargetPath,
  requestHasEmbedAuthMarker,
  resolveEmbedSessionFromRequest,
  consumeEmbedSessionTicket,
  createEmbedSessionTicket,
  hasExplicitEmbedSessionCredential,
  readMcpDirectoryWidgetRenewalTicket,
  renewMcpDirectoryWidgetSession,
  revokeEmbedSessionsForOwner,
  revokeEmbedSessionsForOwners,
  resolveEmbedSessionCookieOwners,
  resolveEmbedSessionTokenForHost,
  setEmbedSessionCookie,
  signEmbedSessionToken,
  verifyEmbedSessionToken,
} from "./embed-session.js";
import { getRequestContext, runWithRequestContext } from "./request-context.js";

const ORIGINAL_ENV = { ...process.env };

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
    process.env = ORIGINAL_ENV;
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
    expect(inserted[0].args).toHaveLength(10);
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
    expect(inserted[0].args).toHaveLength(10);
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
    process.env = ORIGINAL_ENV;
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
    process.env = ORIGINAL_ENV;
  });

  function fakeEvent(
    path: string,
    headers: Record<string, string> = {},
    options: { clientAddress?: string } = {},
  ) {
    const requestHeaders = new Headers(headers);
    const requestUrl = new URL(path, `http://${headers.host ?? "mail.test"}`);
    return {
      path,
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
      res: { headers: new Headers(), status: 200 },
    } as any;
  }

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

  it("allows app runtime requests from the embedded target referrer", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/_agent-native/application-state/compose", {
          host: "mail.agent-native.com",
          referer: "https://mail.agent-native.com/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox&composeDraftId=d1",
      ),
    ).toBe(true);
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
    event.url = {
      search: "?app=mail&view=inbox&embedded=1&__an_embed_token=tok",
    };

    expect(
      requestMatchesEmbedTarget(
        event,
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(true);
  });

  it("rejects unrelated page routes for the same token", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/settings?embedded=1"),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(false);
  });

  it("allows same-origin fetches only when the embed target header matches", () => {
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/_agent-native/actions/list-emails", {
          [EMBED_TARGET_HEADER]: "/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(true);
    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/api/emails?view=inbox&limit=25", {
          [EMBED_TARGET_HEADER]: "/inbox?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(true);

    expect(
      requestMatchesEmbedTarget(
        fakeEvent("/_agent-native/actions/list-emails", {
          [EMBED_TARGET_HEADER]: "/settings?embedded=1",
        }),
        "/_agent-native/open?app=mail&view=inbox",
      ),
    ).toBe(false);
  });

  it("treats bearer embed tokens as embed auth markers for CORS headers", () => {
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
    ).toBe(true);
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

  it("allows app runtime requests with the embed cookie when referrer headers are unavailable", async () => {
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

    expect(runtimeSession).toMatchObject({
      email: "owner@example.com",
      orgId: "org_123",
      targetPath: "/inbox?__an_mcp_chat_bridge=1",
    });

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
    ).toBe(false);
    expect(
      hasExplicitEmbedSessionCredential(
        fakeEvent("/_agent-native/actions/get-document", {
          cookie: `${EMBED_SESSION_COOKIE}=${embedCookie}`,
          [EMBED_TARGET_HEADER]: "/design/design-1",
        }),
      ),
    ).toBe(true);
  });

  it("resolves the embed owner for logout without a target referrer", async () => {
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
    ).resolves.toMatchObject({ email: "owner@example.com" });
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
    expect(leaseUpdate?.[0].args).toEqual([Date.now(), expiresAt, ticketHash]);
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

    setEmbedSessionCookie(event, "embed-token");

    const cookie = event.res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${EMBED_SESSION_COOKIE}=embed-token`);
    expect(cookie).not.toMatch(/Domain=\.agent-native\.com/i);
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

  it("binds capability sessions to their visual-edit target on data requests", async () => {
    process.env.OAUTH_STATE_SECRET = "embed-test-secret";
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/visual-edit/design-1?editorView=overview",
      scope: "capability:visual-edit:design:design-1",
      ttlSeconds: 60,
    });
    const matchingTarget = encodeURIComponent(
      "/visual-edit/design-1?editorView=overview&embedded=1",
    );

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent(
          `/_agent-native/actions/get-design?__an_embed_token=${token}&${EMBED_TARGET_QUERY_PARAM}=${matchingTarget}`,
          { host: "mail.test" },
        ),
      ),
    ).resolves.toMatchObject({
      scope: "capability:visual-edit:design:design-1",
      targetPath: "/visual-edit/design-1?editorView=overview",
    });

    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent(
          `/_agent-native/actions/get-design?__an_embed_token=${token}&${EMBED_TARGET_QUERY_PARAM}=${encodeURIComponent("/design/design-1")}`,
          { host: "mail.test" },
        ),
      ),
    ).resolves.toBeNull();
    await expect(
      resolveEmbedSessionFromRequest(
        fakeEvent("/_agent-native/actions/get-design", {
          host: "mail.test",
          cookie: `${EMBED_SESSION_COOKIE}=${token}`,
        }),
      ),
    ).resolves.toBeNull();
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
        fakeEvent("/_agent-native/actions/get-design", {
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
    process.env = ORIGINAL_ENV;
  });

  function sessionRow(overrides: Record<string, unknown> = {}) {
    const createdAtMs = Date.now() - 60_000;
    return {
      owner_email: "owner@example.com",
      org_id: "org_123",
      target_path: "/page/doc_123",
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
