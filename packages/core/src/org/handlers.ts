import {
  defineEventHandler,
  getRouterParam,
  getRequestURL,
  createError,
  type H3Event,
} from "h3";

/**
 * Extract the :id from invitation-accept paths. The framework request handler
 * strips the mount prefix before calling the handler, so `event.url.pathname`
 * is the relative tail — e.g. `/some-id/accept`. Falls back to matching the
 * full path for contexts that don't strip, and to the h3 router param.
 */
function extractInvitationId(event: H3Event): string | undefined {
  const fromRouter = getRouterParam(event, "id");
  if (fromRouter) return fromRouter;
  const path = getRequestURL(event).pathname;
  const match =
    path.match(/^\/([^\/]+)\/accept\/?$/) ??
    path.match(/\/org\/invitations\/([^\/]+)\/accept\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/** Extract the :email from member-delete paths. Same prefix-stripping caveat. */
function extractMemberEmail(event: H3Event): string | undefined {
  const fromRouter = getRouterParam(event, "email");
  if (fromRouter) return fromRouter;
  const path = getRequestURL(event).pathname;
  const match =
    path.match(/^\/([^\/]+)\/?$/) ?? path.match(/\/org\/members\/([^\/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);
import { readBody } from "../server/h3-helpers.js";
import { getSession } from "../server/auth.js";
import { putUserSetting } from "../settings/user-settings.js";
import { getDbExec } from "../db/client.js";
import { sendEmail, isEmailConfigured } from "../server/email.js";
import { renderInviteEmail } from "../server/email-templates.js";
import { getAppProductionUrl } from "../server/app-url.js";
import { getOrgContext } from "./context.js";
import type { OrgRole } from "./types.js";

function getInviteAppUrl(event: H3Event): string {
  return getAppProductionUrl(event);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function exec() {
  return getDbExec();
}

function requireAuthEmail(session: { email?: string } | null): string {
  const email = session?.email;
  if (!email) {
    throw createError({ statusCode: 401, message: "Authentication required" });
  }
  return email;
}

/** GET /_agent-native/org/me — current user's active org, all orgs, pending invitations */
export const getMyOrgHandler = defineEventHandler(async (event: H3Event) => {
  const ctx = await getOrgContext(event);

  const e = await exec();
  const allOrgsRes = await e.execute({
    sql: `SELECT m.org_id AS "orgId", m.role AS role, o.name AS "orgName"
          FROM org_members m
          INNER JOIN organizations o ON m.org_id = o.id
          WHERE LOWER(m.email) = ?`,
    args: [ctx.email.toLowerCase()],
  });
  const orgs = allOrgsRes.rows.map((r: any) => ({
    orgId: String(r.orgId ?? r.org_id),
    role: String(r.role) as OrgRole,
    orgName: String(r.orgName ?? r.org_name),
  }));

  let domainMatches: Array<{ orgId: string; orgName: string }> = [];
  if (!ctx.orgId) {
    const domain = ctx.email.split("@")[1]?.toLowerCase();
    if (domain) {
      try {
        const dmRes = await e.execute({
          sql: `SELECT id, name FROM organizations WHERE LOWER(allowed_domain) = ?`,
          args: [domain],
        });
        domainMatches = dmRes.rows.map((r: any) => ({
          orgId: String(r.id),
          orgName: String(r.name),
        }));
      } catch {
        // allowed_domain column may not exist yet if migration hasn't run
      }
    }
  }

  let allowedDomain: string | null = null;
  let a2aSecret: string | null = null;
  if (ctx.orgId) {
    try {
      const adRes = await e.execute({
        sql: `SELECT allowed_domain, a2a_secret FROM organizations WHERE id = ? LIMIT 1`,
        args: [ctx.orgId],
      });
      if (adRes.rows[0]) {
        allowedDomain =
          String((adRes.rows[0] as any).allowed_domain ?? "") || null;
        a2aSecret = String((adRes.rows[0] as any).a2a_secret ?? "") || null;
      }
    } catch {
      // Column may not exist yet
    }
  }

  const isOwnerOrAdmin = ctx.role === "owner" || ctx.role === "admin";

  const invitesRes = await e.execute({
    // Case-insensitive match: invitations are stored with whatever case
    // the inviter typed, but the session email may be normalized
    // differently by the auth provider. LOWER(both sides) keeps these
    // discoverable and matches getOrgContext.hasPendingInvitation.
    sql: `SELECT i.id AS id, i.org_id AS "orgId", o.name AS "orgName", i.invited_by AS "invitedBy"
          FROM org_invitations i
          INNER JOIN organizations o ON i.org_id = o.id
          WHERE LOWER(i.email) = ? AND i.status = 'pending'`,
    args: [ctx.email.toLowerCase()],
  });
  const pendingInvitations = invitesRes.rows.map((r: any) => ({
    id: String(r.id),
    orgId: String(r.orgId ?? r.org_id),
    orgName: String(r.orgName ?? r.org_name),
    invitedBy: String(r.invitedBy ?? r.invited_by),
  }));

  return {
    email: ctx.email,
    orgId: ctx.orgId,
    orgName: ctx.orgName,
    role: ctx.role,
    orgs,
    pendingInvitations,
    domainMatches,
    allowedDomain,
    a2aSecret: isOwnerOrAdmin ? a2aSecret : undefined,
  };
});

/** POST /_agent-native/org — create a new organization */
export const createOrgHandler = defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  const email = requireAuthEmail(session);

  const body = await readBody(event);
  const name = body?.name?.trim();
  if (!name) {
    throw createError({
      statusCode: 400,
      message: "Organization name is required",
    });
  }

  const orgId = nanoid();
  const now = Date.now();
  const e = await exec();

  // Auto-generate a per-org A2A secret for cross-app delegation
  const { randomBytes } = await import("node:crypto");
  const a2aSecret = randomBytes(32).toString("base64url");

  await e.execute({
    sql: `INSERT INTO organizations (id, name, created_by, created_at, a2a_secret) VALUES (?, ?, ?, ?, ?)`,
    args: [orgId, name, email, now, a2aSecret],
  });

  await e.execute({
    sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
    args: [nanoid(), orgId, email, "owner", now],
  });

  await putUserSetting(email, "active-org-id", { orgId });

  return { id: orgId, name, role: "owner" };
});

/** GET /_agent-native/org/members — list org members */
export const listMembersHandler = defineEventHandler(async (event: H3Event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.orgId) return { members: [] };

  const e = await exec();
  const { rows } = await e.execute({
    sql: `SELECT email, role, joined_at AS "joinedAt" FROM org_members WHERE org_id = ?`,
    args: [ctx.orgId],
  });
  const members = rows.map((r: any) => ({
    email: String(r.email),
    role: String(r.role) as OrgRole,
    joinedAt: Number(r.joinedAt ?? r.joined_at),
  }));
  return { members };
});

/** POST /_agent-native/org/invitations — invite a user by email */
export const createInvitationHandler = defineEventHandler(
  async (event: H3Event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.orgId) {
      throw createError({
        statusCode: 400,
        message: "You must belong to an organization to invite members",
      });
    }
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw createError({
        statusCode: 403,
        message: "Only owners and admins can invite members",
      });
    }

    const body = await readBody(event);
    const email = body?.email?.trim()?.toLowerCase();
    if (!email) {
      throw createError({ statusCode: 400, message: "Email is required" });
    }

    const e = await exec();

    // Existing rows in org_members / org_invitations may have any case
    // (writes haven't been normalized historically). Compare with LOWER
    // on both sides so an "alice@..." invite check correctly recognizes
    // an existing "Alice@..." membership. `email` is already lowercased
    // at parse time above, but call .toLowerCase() explicitly here so
    // the contract at the SQL boundary matches every other handler in
    // this file.
    const existingMember = await e.execute({
      sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [ctx.orgId, email.toLowerCase()],
    });
    if (existingMember.rows.length > 0) {
      throw createError({
        statusCode: 409,
        message: "User is already a member of this organization",
      });
    }

    const existingInvite = await e.execute({
      sql: `SELECT 1 FROM org_invitations WHERE org_id = ? AND LOWER(email) = ? AND status = 'pending' LIMIT 1`,
      args: [ctx.orgId, email.toLowerCase()],
    });
    if (existingInvite.rows.length > 0) {
      throw createError({
        statusCode: 409,
        message: "An invitation is already pending for this email",
      });
    }

    const id = nanoid();
    await e.execute({
      sql: `INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
      args: [id, ctx.orgId, email, ctx.email, Date.now()],
    });

    let emailSent = false;
    let emailError: string | undefined;
    if (isEmailConfigured()) {
      try {
        const { subject, html, text } = renderInviteEmail({
          invitee: email,
          orgName: ctx.orgName || "your team",
          acceptUrl: getInviteAppUrl(event),
          inviter: ctx.email,
        });
        await sendEmail({ to: email, subject, html, text });
        emailSent = true;
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
        console.error("[org/invitations] failed to send invite email", err);
      }
    }

    return { id, email, status: "pending", emailSent, emailError };
  },
);

/** GET /_agent-native/org/invitations — list pending invitations for the org */
export const listInvitationsHandler = defineEventHandler(
  async (event: H3Event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.orgId) return { invitations: [] };

    const e = await exec();
    const { rows } = await e.execute({
      sql: `SELECT id, email, invited_by AS "invitedBy", created_at AS "createdAt", status
            FROM org_invitations
            WHERE org_id = ? AND status = 'pending'`,
      args: [ctx.orgId],
    });
    const invitations = rows.map((r: any) => ({
      id: String(r.id),
      email: String(r.email),
      invitedBy: String(r.invitedBy ?? r.invited_by),
      createdAt: Number(r.createdAt ?? r.created_at),
      status: String(r.status),
    }));
    return { invitations };
  },
);

/** POST /_agent-native/org/invitations/:id/accept — accept an invitation */
export const acceptInvitationHandler = defineEventHandler(
  async (event: H3Event) => {
    const session = await getSession(event);
    const email = requireAuthEmail(session);

    const invitationId = extractInvitationId(event);
    if (!invitationId) {
      throw createError({
        statusCode: 400,
        message: "Invitation ID required",
      });
    }

    const e = await exec();

    const invRes = await e.execute({
      // Case-insensitive on email — see comment on the analogous
      // pending-invitations query in getMyOrgHandler.
      sql: `SELECT id, org_id AS "orgId" FROM org_invitations
            WHERE id = ? AND LOWER(email) = ? AND status = 'pending' LIMIT 1`,
      args: [invitationId, email.toLowerCase()],
    });
    if (invRes.rows.length === 0) {
      throw createError({
        statusCode: 404,
        message: "Invitation not found or already used",
      });
    }
    const inv = invRes.rows[0] as any;
    const invOrgId = String(inv.orgId ?? inv.org_id);

    const existingMembership = await e.execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [invOrgId, email.toLowerCase()],
    });

    const orgRes = await e.execute({
      sql: `SELECT name FROM organizations WHERE id = ? LIMIT 1`,
      args: [invOrgId],
    });
    const orgName = String((orgRes.rows[0] as any)?.name ?? "");

    if (existingMembership.rows.length > 0) {
      await e.execute({
        sql: `UPDATE org_invitations SET status = 'accepted' WHERE id = ?`,
        args: [invitationId],
      });
      await putUserSetting(email, "active-org-id", { orgId: invOrgId });
      return {
        orgId: invOrgId,
        orgName,
        role: String((existingMembership.rows[0] as any).role) as OrgRole,
      };
    }

    await e.execute({
      sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, 'member', ?)`,
      args: [nanoid(), invOrgId, email, Date.now()],
    });

    await e.execute({
      sql: `UPDATE org_invitations SET status = 'accepted' WHERE id = ?`,
      args: [invitationId],
    });

    await putUserSetting(email, "active-org-id", { orgId: invOrgId });

    return { orgId: invOrgId, orgName, role: "member" as OrgRole };
  },
);

/** DELETE /_agent-native/org/members/:email — remove a member (owner/admin only) */
export const removeMemberHandler = defineEventHandler(
  async (event: H3Event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.orgId) {
      throw createError({ statusCode: 400, message: "No organization found" });
    }
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw createError({
        statusCode: 403,
        message: "Only owners and admins can remove members",
      });
    }

    const memberEmail = extractMemberEmail(event);
    if (!memberEmail) {
      throw createError({ statusCode: 400, message: "Email is required" });
    }

    // memberEmail comes from the URL path verbatim; org_members may
    // hold the row with any case. LOWER both sides for the lookup AND
    // the DELETE so removal works regardless of how either side cased
    // it. The self-removal guard ALSO compares case-insensitively —
    // otherwise an owner whose email was stored as Alice@... could
    // remove themselves via the lowercase URL alice@..., bypassing the
    // guard and leaving the org ownerless.
    const memberEmailLower = memberEmail.toLowerCase();
    if (memberEmailLower === ctx.email.toLowerCase() && ctx.role === "owner") {
      throw createError({
        statusCode: 400,
        message: "Organization owner cannot remove themselves",
      });
    }
    const e = await exec();
    // Look specifically for an OWNER row matching this email rather
    // than just "any matching row". Duplicate-case rows are possible
    // (e.g. legacy data with both "Alice@..." and "alice@..." in
    // org_members), and the prior `SELECT role ... LIMIT 1` could
    // return the non-owner duplicate, pass the role check, and then
    // the case-insensitive DELETE below would remove BOTH rows —
    // including the owner — leaving the org ownerless. Querying for
    // the owner row directly closes that case-mismatch attack.
    const ownerCheck = await e.execute({
      sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = ? AND role = 'owner' LIMIT 1`,
      args: [ctx.orgId, memberEmailLower],
    });
    if (ownerCheck.rows.length > 0) {
      throw createError({
        statusCode: 403,
        message: "Cannot remove the organization owner",
      });
    }

    await e.execute({
      sql: `DELETE FROM org_members WHERE org_id = ? AND LOWER(email) = ?`,
      args: [ctx.orgId, memberEmailLower],
    });

    return { success: true };
  },
);

/** PATCH /_agent-native/org — rename the current organization (owner/admin only) */
export const updateOrgHandler = defineEventHandler(async (event: H3Event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.orgId) {
    throw createError({ statusCode: 400, message: "No organization found" });
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw createError({
      statusCode: 403,
      message: "Only owners and admins can update the organization",
    });
  }

  const body = await readBody(event);
  const name = body?.name?.trim();
  if (!name) {
    throw createError({
      statusCode: 400,
      message: "Organization name is required",
    });
  }

  const e = await exec();
  await e.execute({
    sql: `UPDATE organizations SET name = ? WHERE id = ?`,
    args: [name, ctx.orgId],
  });

  return { orgId: ctx.orgId, name };
});

/** PUT /_agent-native/org/switch — switch the user's active organization */
export const switchOrgHandler = defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  const email = requireAuthEmail(session);

  const body = await readBody(event);
  const orgId = body?.orgId;

  if (!orgId) {
    await putUserSetting(email, "active-org-id", { orgId: null });
    return { orgId: null, orgName: null, role: null };
  }

  const e = await exec();
  const membership = await e.execute({
    sql: `SELECT m.role AS role, o.name AS "orgName"
          FROM org_members m
          INNER JOIN organizations o ON m.org_id = o.id
          WHERE m.org_id = ? AND LOWER(m.email) = ? LIMIT 1`,
    args: [orgId, email.toLowerCase()],
  });

  if (membership.rows.length === 0) {
    throw createError({
      statusCode: 403,
      message: "You are not a member of that organization",
    });
  }

  await putUserSetting(email, "active-org-id", { orgId });

  const row = membership.rows[0] as any;
  return {
    orgId,
    orgName: String(row.orgName ?? row.org_name),
    role: String(row.role) as OrgRole,
  };
});

/** POST /_agent-native/org/join-by-domain — join an org whose allowed_domain matches your email */
export const joinByDomainHandler = defineEventHandler(
  async (event: H3Event) => {
    const session = await getSession(event);
    const email = requireAuthEmail(session);

    const body = await readBody(event);
    const orgId = body?.orgId;
    if (!orgId) {
      throw createError({ statusCode: 400, message: "orgId is required" });
    }

    const e = await exec();

    const orgRes = await e.execute({
      sql: `SELECT id, name, allowed_domain FROM organizations WHERE id = ? LIMIT 1`,
      args: [orgId],
    });
    if (orgRes.rows.length === 0) {
      throw createError({ statusCode: 404, message: "Organization not found" });
    }
    const org = orgRes.rows[0] as any;
    const allowedDomain = String(org.allowed_domain || "").toLowerCase();
    const userDomain = email.split("@")[1]?.toLowerCase();

    if (!allowedDomain || allowedDomain !== userDomain) {
      throw createError({
        statusCode: 403,
        message:
          "Your email domain does not match this organization's allowed domain",
      });
    }

    const existing = await e.execute({
      sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, email.toLowerCase()],
    });
    if (existing.rows.length > 0) {
      throw createError({
        statusCode: 409,
        message: "Already a member of this organization",
      });
    }

    await e.execute({
      sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, 'member', ?)`,
      args: [nanoid(), orgId, email, Date.now()],
    });

    await putUserSetting(email, "active-org-id", { orgId });

    return {
      orgId,
      orgName: String(org.name),
      role: "member" as OrgRole,
    };
  },
);

/** PUT /_agent-native/org/domain — set or clear the allowed email domain (owner/admin only) */
export const setDomainHandler = defineEventHandler(async (event: H3Event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.orgId) {
    throw createError({ statusCode: 400, message: "No active organization" });
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw createError({
      statusCode: 403,
      message: "Only owners and admins can set the allowed domain",
    });
  }

  const body = await readBody(event);
  const raw = body?.domain?.trim()?.toLowerCase() || null;

  if (raw && !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(raw)) {
    throw createError({
      statusCode: 400,
      message: "Invalid domain format",
    });
  }

  const e = await exec();

  if (raw) {
    const existing = await e.execute({
      sql: `SELECT id FROM organizations WHERE LOWER(allowed_domain) = ? AND id != ? LIMIT 1`,
      args: [raw, ctx.orgId],
    });
    if (existing.rows.length > 0) {
      throw createError({
        statusCode: 409,
        message: "Another organization already uses this domain",
      });
    }
  }

  await e.execute({
    sql: `UPDATE organizations SET allowed_domain = ? WHERE id = ?`,
    args: [raw, ctx.orgId],
  });

  return { domain: raw };
});

/** PUT /_agent-native/org/a2a-secret — regenerate or set the org's A2A secret (owner/admin only) */
export const setA2ASecretHandler = defineEventHandler(
  async (event: H3Event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.orgId) {
      throw createError({
        statusCode: 400,
        message: "No active organization",
      });
    }
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw createError({
        statusCode: 403,
        message: "Only owners and admins can manage the A2A secret",
      });
    }

    const body = await readBody(event);
    let secret = body?.secret?.trim() || null;

    // If no secret provided, auto-generate one
    if (!secret) {
      const { randomBytes } = await import("node:crypto");
      secret = randomBytes(32).toString("base64url");
    }

    const e = await exec();
    // Read the previous secret BEFORE overwriting so the client can chain a
    // sync call that signs JWTs with the secret peers still hold.
    const prevRes = await e.execute({
      sql: `SELECT a2a_secret FROM organizations WHERE id = ? LIMIT 1`,
      args: [ctx.orgId],
    });
    const previousSecret =
      String((prevRes.rows[0] as any)?.a2a_secret ?? "") || null;

    await e.execute({
      sql: `UPDATE organizations SET a2a_secret = ? WHERE id = ?`,
      args: [secret, ctx.orgId],
    });

    return { a2aSecret: secret, previousSecret };
  },
);

/**
 * POST /_agent-native/org/a2a-secret/sync — push the org's A2A secret to all
 * connected apps so cross-app delegation works without manual copy/paste.
 *
 * Auth: standard session — owner/admin only.
 *
 * For each discovered agent, signs a JWT with the org's CURRENT a2a_secret
 * and POSTs to `<app>/_agent-native/org/a2a-secret/receive` with the same
 * secret + the org's domain. The receiving app verifies the JWT using its
 * own copy of the secret (peers must already share a secret to be trusted)
 * — for the first-ever sync this means at least one peer must already hold
 * the secret, which is the bootstrap. For ongoing rotation, regenerate
 * locally and call sync immediately; sync signs with the secret that's
 * currently in DB, which the peers still have.
 *
 * Body (optional): { signSecret?: string } — sign the outbound JWTs with
 * this secret instead of the org's current secret. Used by the regenerate-
 * then-sync flow: regenerate stores the NEW secret, but sync needs to
 * authenticate using the OLD one that peers still hold. Owner/admin only,
 * gated by the session.
 */
export const syncA2ASecretHandler = defineEventHandler(
  async (event: H3Event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.orgId) {
      throw createError({
        statusCode: 400,
        message: "No active organization",
      });
    }
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw createError({
        statusCode: 403,
        message: "Only owners and admins can sync the A2A secret",
      });
    }

    const body = await readBody(event).catch(() => null);
    const overrideSignSecret =
      typeof body?.signSecret === "string" && body.signSecret.trim()
        ? body.signSecret.trim()
        : null;

    const e = await exec();
    const orgRes = await e.execute({
      sql: `SELECT a2a_secret, allowed_domain FROM organizations WHERE id = ? LIMIT 1`,
      args: [ctx.orgId],
    });
    if (orgRes.rows.length === 0) {
      throw createError({
        statusCode: 404,
        message: "Organization not found",
      });
    }
    const orgRow = orgRes.rows[0] as any;
    const secret = String(orgRow.a2a_secret ?? "") || null;
    const orgDomain = String(orgRow.allowed_domain ?? "") || null;

    if (!secret) {
      throw createError({
        statusCode: 400,
        message: "Org has no A2A secret. Generate one first before syncing.",
      });
    }
    if (!orgDomain) {
      throw createError({
        statusCode: 400,
        message:
          "Org has no allowed domain set. Set the email domain first so connected apps can identify which org to update.",
      });
    }

    const signSecret = overrideSignSecret || secret;

    const { discoverAgents } = await import("../server/agent-discovery.js");
    const { signA2AToken } = await import("../a2a/client.js");

    const agents = await discoverAgents();

    const results: Array<{
      id: string;
      name: string;
      url: string;
      ok: boolean;
      status?: number;
      error?: string;
    }> = [];

    await Promise.all(
      agents.map(async (agent) => {
        try {
          const token = await signA2AToken(ctx.email, orgDomain, signSecret);

          const target = `${agent.url.replace(/\/$/, "")}/_agent-native/org/a2a-secret/receive`;
          const res = await fetch(target, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ secret, orgDomain }),
          });

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            results.push({
              id: agent.id,
              name: agent.name,
              url: agent.url,
              ok: false,
              status: res.status,
              error: text || res.statusText,
            });
            return;
          }
          results.push({
            id: agent.id,
            name: agent.name,
            url: agent.url,
            ok: true,
            status: res.status,
          });
        } catch (err) {
          results.push({
            id: agent.id,
            name: agent.name,
            url: agent.url,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );

    const succeeded = results.filter((r) => r.ok).length;
    return {
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };
  },
);

/**
 * POST /_agent-native/org/a2a-secret/receive — accept a secret push from a
 * connected agent-native app. Auth-exempt at the route guard; we verify a
 * JWT signed by the calling app using OUR copy of the org's a2a_secret. If
 * verification succeeds the calling app is a trusted peer and we overwrite
 * our local org's secret with the supplied value.
 *
 * Body: { secret: string, orgDomain: string }
 *
 * Header: Authorization: Bearer <JWT signed with the existing shared
 * a2a_secret, with `org_domain` matching the body's orgDomain>.
 */
export const receiveA2ASecretHandler = defineEventHandler(
  async (event: H3Event) => {
    const { getRequestHeader } = await import("h3");
    const jose = await import("jose");

    const authHeader = getRequestHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw createError({
        statusCode: 401,
        message: "Bearer token required",
      });
    }
    const token = authHeader.slice("Bearer ".length);

    const body = await readBody(event);
    const newSecret =
      typeof body?.secret === "string" ? body.secret.trim() : "";
    const orgDomain =
      typeof body?.orgDomain === "string"
        ? body.orgDomain.trim().toLowerCase()
        : "";
    if (!newSecret || !orgDomain) {
      throw createError({
        statusCode: 400,
        message: "secret and orgDomain are required",
      });
    }

    // Peek at JWT (unverified) to confirm it claims the same domain we're
    // updating. Verification still happens below with the trusted secret.
    let claimedDomain: string | undefined;
    try {
      const unverified = jose.decodeJwt(token);
      claimedDomain =
        (unverified.org_domain as string | undefined) || undefined;
    } catch {
      throw createError({
        statusCode: 401,
        message: "Malformed JWT",
      });
    }
    if (
      !claimedDomain ||
      claimedDomain.toLowerCase() !== orgDomain.toLowerCase()
    ) {
      throw createError({
        statusCode: 401,
        message: "JWT org_domain does not match request body",
      });
    }

    // Look up our local org by the domain and grab the existing secret.
    const e = await exec();
    const orgRes = await e.execute({
      sql: `SELECT id, a2a_secret FROM organizations WHERE LOWER(allowed_domain) = ? LIMIT 1`,
      args: [orgDomain],
    });
    if (orgRes.rows.length === 0) {
      throw createError({
        statusCode: 404,
        message: "No local org matches that domain",
      });
    }
    const row = orgRes.rows[0] as any;
    const localOrgId = String(row.id);
    const existingSecret = String(row.a2a_secret ?? "") || null;

    if (!existingSecret) {
      // Bootstrap requires an existing shared secret to verify the caller.
      // If we have nothing on file, we can't verify trust — refuse.
      throw createError({
        statusCode: 401,
        message:
          "Local org has no A2A secret yet — cannot verify caller. Set the secret manually for the first time.",
      });
    }

    // Verify the JWT using OUR existing secret. If the caller is a trusted
    // peer they signed with the same secret and verification succeeds.
    try {
      await jose.jwtVerify(token, new TextEncoder().encode(existingSecret));
    } catch {
      throw createError({
        statusCode: 401,
        message: "Invalid or expired JWT signature",
      });
    }

    // Trusted — apply the new secret.
    await e.execute({
      sql: `UPDATE organizations SET a2a_secret = ? WHERE id = ?`,
      args: [newSecret, localOrgId],
    });

    return { ok: true, orgId: localOrgId };
  },
);
