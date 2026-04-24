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

  await e.execute({
    sql: `INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`,
    args: [orgId, name, email, now],
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
    const target = await e.execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [ctx.orgId, memberEmailLower],
    });
    if ((target.rows[0] as any)?.role === "owner") {
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
