import { canManageOrg, orgMembers, type OrgRole } from "@agent-native/core/org";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { getOrgSetting, mutateOrgSetting } from "@agent-native/core/settings";
import { and, eq, sql } from "drizzle-orm";

import { getDb, schema } from "./db/index.js";

const WORKSPACE_DEFAULTS_KEY = "slides.brand-defaults";

export interface WorkspaceDefaults {
  referenceDeckId: string | null;
  designSystemId: string | null;
}

const EMPTY_DEFAULTS: WorkspaceDefaults = {
  referenceDeckId: null,
  designSystemId: null,
};

function readId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Workspace defaults live on the org, so a caller with no org (personal
 * context, CLI, cron) genuinely has none — that is absent, not unreadable, and
 * every read below distinguishes the two by letting store failures propagate.
 */
export async function getWorkspaceDefaults(): Promise<WorkspaceDefaults> {
  const orgId = getRequestOrgId();
  if (!orgId) return EMPTY_DEFAULTS;
  const raw = await getOrgSetting(orgId, WORKSPACE_DEFAULTS_KEY);
  if (!raw) return EMPTY_DEFAULTS;
  return {
    referenceDeckId: readId(raw.referenceDeckId),
    designSystemId: readId(raw.designSystemId),
  };
}

export async function getCallerOrgRole(): Promise<OrgRole | null> {
  const orgId = getRequestOrgId();
  const email = getRequestUserEmail();
  if (!orgId || !email) return null;
  const rows = await getDb()
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, orgId),
        eq(sql`lower(${orgMembers.email})`, email.toLowerCase()),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  return role === "owner" || role === "admin" || role === "member"
    ? role
    : null;
}

export async function canManageWorkspaceDefaults(): Promise<boolean> {
  return canManageOrg(await getCallerOrgRole());
}

async function assertWorkspaceAdmin(): Promise<string> {
  const orgId = getRequestOrgId();
  if (!orgId) {
    throw Object.assign(
      new Error(
        "Workspace defaults belong to an organization. Switch out of Personal context to set them.",
      ),
      { statusCode: 400 },
    );
  }
  if (!canManageOrg(await getCallerOrgRole())) {
    throw Object.assign(
      new Error("Only workspace admins can change the workspace defaults."),
      { statusCode: 403 },
    );
  }
  return orgId;
}

export async function writeWorkspaceDefaults(
  patch: Partial<WorkspaceDefaults>,
): Promise<WorkspaceDefaults> {
  const orgId = await assertWorkspaceAdmin();
  const next = await mutateOrgSetting(
    orgId,
    WORKSPACE_DEFAULTS_KEY,
    (raw: Record<string, unknown> | null) => {
      const current: WorkspaceDefaults = raw
        ? {
            referenceDeckId: readId(raw.referenceDeckId),
            designSystemId: readId(raw.designSystemId),
          }
        : EMPTY_DEFAULTS;
      return { ...current, ...patch };
    },
  );
  return {
    referenceDeckId: readId(next.referenceDeckId),
    designSystemId: readId(next.designSystemId),
  };
}

/**
 * A default nobody else can open is worse than no default: every teammate's
 * first prompt would 404 on the reference lookup and silently produce an
 * off-brand deck. Refuse to set one that is still private, and refuse an
 * `org`-visible resource that belongs to a different org than the one it is
 * being set as the default for — an individual viewer share on the caller's
 * side must not make a foreign org's resource resolvable workspace-wide.
 */
export async function assertWorkspaceVisible(
  kind: "deck" | "design-system",
  id: string,
): Promise<void> {
  const t = kind === "deck" ? schema.decks : schema.designSystems;
  const rows = await getDb()
    .select({ visibility: t.visibility, orgId: t.orgId })
    .from(t)
    .where(eq(t.id, id))
    .limit(1);
  if (rows.length === 0) {
    throw Object.assign(new Error(`${kind} not found`), { statusCode: 404 });
  }
  const { visibility, orgId } = rows[0];
  if (visibility === "private") {
    throw Object.assign(
      new Error(
        `This ${kind} is private, so nobody else in the workspace could use it. Share it with the workspace first, then set it as the default.`,
      ),
      { statusCode: 400 },
    );
  }
  if (visibility === "org" && orgId !== getRequestOrgId()) {
    throw Object.assign(
      new Error(
        `This ${kind} belongs to a different organization, so this workspace's members could not use it. Share it with this workspace first, then set it as the default.`,
      ),
      { statusCode: 400 },
    );
  }
}

/**
 * Design-system precedence: an explicit pick wins, then the caller's own
 * default, then the workspace default. A user who never set one still gets
 * on-brand output; one who did keeps their choice.
 */
export async function resolveDefaultDesignSystemId(
  ownerEmail: string,
): Promise<string | null> {
  const personal = await getDb()
    .select({ id: schema.designSystems.id })
    .from(schema.designSystems)
    .where(
      and(
        eq(schema.designSystems.ownerEmail, ownerEmail),
        eq(schema.designSystems.isDefault, true),
      ),
    )
    .limit(1);
  if (personal[0]?.id) return personal[0].id;
  return (await getWorkspaceDefaults()).designSystemId;
}
