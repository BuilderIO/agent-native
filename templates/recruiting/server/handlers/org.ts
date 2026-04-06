import { defineEventHandler, readBody, getRouterParam, createError } from "h3";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getSession } from "@agent-native/core/server";
import { db, schema } from "../db/index.js";
import { getOrgContext } from "../lib/org-context.js";

/** GET /api/org/me — current user's org + role, plus any pending invitations */
export const getMyOrgHandler = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);

  // Check for pending invitations
  const pendingInvitations =
    ctx.email !== "local@localhost"
      ? await db
          .select({
            id: schema.orgInvitations.id,
            orgId: schema.orgInvitations.orgId,
            orgName: schema.organizations.name,
            invitedBy: schema.orgInvitations.invitedBy,
          })
          .from(schema.orgInvitations)
          .innerJoin(
            schema.organizations,
            eq(schema.orgInvitations.orgId, schema.organizations.id),
          )
          .where(
            and(
              eq(schema.orgInvitations.email, ctx.email),
              eq(schema.orgInvitations.status, "pending"),
            ),
          )
      : [];

  return {
    email: ctx.email,
    orgId: ctx.orgId,
    orgName: ctx.orgName,
    role: ctx.role,
    pendingInvitations,
  };
});

/** POST /api/org — create a new organization */
export const createOrgHandler = defineEventHandler(async (event) => {
  const session = await getSession(event);
  const email = session?.email;
  if (!email || email === "local@localhost") {
    throw createError({
      statusCode: 401,
      message: "Authentication required to create an organization",
    });
  }

  // Check if user already belongs to an org
  const existing = await db
    .select()
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.email, email))
    .limit(1);
  if (existing.length > 0) {
    throw createError({
      statusCode: 409,
      message: "You already belong to an organization",
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

  const orgId = nanoid();
  const now = Date.now();

  await db.insert(schema.organizations).values({
    id: orgId,
    name,
    createdBy: email,
    createdAt: now,
  });

  await db.insert(schema.orgMembers).values({
    id: nanoid(),
    orgId,
    email,
    role: "owner",
    joinedAt: now,
  });

  return { id: orgId, name, role: "owner" };
});

/** GET /api/org/members — list org members */
export const listMembersHandler = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.orgId) {
    return { members: [] };
  }

  const members = await db
    .select({
      email: schema.orgMembers.email,
      role: schema.orgMembers.role,
      joinedAt: schema.orgMembers.joinedAt,
    })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.orgId, ctx.orgId));

  return { members };
});

/** POST /api/org/invitations — invite a user by email */
export const createInvitationHandler = defineEventHandler(async (event) => {
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

  // Check if already a member
  const existingMember = await db
    .select()
    .from(schema.orgMembers)
    .where(
      and(
        eq(schema.orgMembers.orgId, ctx.orgId),
        eq(schema.orgMembers.email, email),
      ),
    )
    .limit(1);
  if (existingMember.length > 0) {
    throw createError({
      statusCode: 409,
      message: "User is already a member of this organization",
    });
  }

  // Check for existing pending invitation
  const existingInvite = await db
    .select()
    .from(schema.orgInvitations)
    .where(
      and(
        eq(schema.orgInvitations.orgId, ctx.orgId),
        eq(schema.orgInvitations.email, email),
        eq(schema.orgInvitations.status, "pending"),
      ),
    )
    .limit(1);
  if (existingInvite.length > 0) {
    throw createError({
      statusCode: 409,
      message: "An invitation is already pending for this email",
    });
  }

  const id = nanoid();
  await db.insert(schema.orgInvitations).values({
    id,
    orgId: ctx.orgId,
    email,
    invitedBy: ctx.email,
    createdAt: Date.now(),
    status: "pending",
  });

  return { id, email, status: "pending" };
});

/** GET /api/org/invitations — list pending invitations for the org */
export const listInvitationsHandler = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.orgId) {
    return { invitations: [] };
  }

  const invitations = await db
    .select()
    .from(schema.orgInvitations)
    .where(
      and(
        eq(schema.orgInvitations.orgId, ctx.orgId),
        eq(schema.orgInvitations.status, "pending"),
      ),
    );

  return { invitations };
});

/** POST /api/org/invitations/:id/accept — accept an invitation */
export const acceptInvitationHandler = defineEventHandler(async (event) => {
  const session = await getSession(event);
  const email = session?.email;
  if (!email || email === "local@localhost") {
    throw createError({ statusCode: 401, message: "Authentication required" });
  }

  const invitationId = getRouterParam(event, "id");
  if (!invitationId) {
    throw createError({
      statusCode: 400,
      message: "Invitation ID required",
    });
  }

  const invitation = await db
    .select()
    .from(schema.orgInvitations)
    .where(
      and(
        eq(schema.orgInvitations.id, invitationId),
        eq(schema.orgInvitations.email, email),
        eq(schema.orgInvitations.status, "pending"),
      ),
    )
    .limit(1);

  if (invitation.length === 0) {
    throw createError({
      statusCode: 404,
      message: "Invitation not found or already used",
    });
  }

  // Check if user already belongs to an org
  const existingMembership = await db
    .select()
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.email, email))
    .limit(1);
  if (existingMembership.length > 0) {
    throw createError({
      statusCode: 409,
      message: "You already belong to an organization",
    });
  }

  const inv = invitation[0];
  const now = Date.now();

  // Add as member
  await db.insert(schema.orgMembers).values({
    id: nanoid(),
    orgId: inv.orgId,
    email,
    role: "member",
    joinedAt: now,
  });

  // Mark invitation as accepted
  await db
    .update(schema.orgInvitations)
    .set({ status: "accepted" })
    .where(eq(schema.orgInvitations.id, invitationId));

  // Get org name
  const org = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, inv.orgId))
    .limit(1);

  return {
    orgId: inv.orgId,
    orgName: org[0]?.name ?? "",
    role: "member",
  };
});

/** DELETE /api/org/members/:email — remove a member (owner/admin only) */
export const removeMemberHandler = defineEventHandler(async (event) => {
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

  const memberEmail = getRouterParam(event, "email");
  if (!memberEmail) {
    throw createError({ statusCode: 400, message: "Email is required" });
  }

  // Can't remove yourself if you're the owner
  if (memberEmail === ctx.email && ctx.role === "owner") {
    throw createError({
      statusCode: 400,
      message: "Organization owner cannot remove themselves",
    });
  }

  await db
    .delete(schema.orgMembers)
    .where(
      and(
        eq(schema.orgMembers.orgId, ctx.orgId),
        eq(schema.orgMembers.email, memberEmail),
      ),
    );

  return { success: true };
});
