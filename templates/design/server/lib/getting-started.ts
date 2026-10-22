import { getDbExec } from "@agent-native/core/db";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  registerOnboardingStep,
  type OnboardingResolveContext,
  type OnboardingStep,
} from "@agent-native/core/onboarding";
import { isMissingOrganizationTableError } from "@agent-native/core/org";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, notInArray, sql, type AnyColumn } from "drizzle-orm";

import { DESIGN_SYSTEM_WORKFLOWS } from "../../shared/design-flags.js";
import { PRODUCTION_DESIGN_SYSTEM_TEMPLATES } from "../../shared/design-system-templates.js";
import { getDb, schema } from "../db/index.js";

export const GETTING_STARTED_CHECKLIST = "getting-started";

type Ctx = OnboardingResolveContext | undefined;

function ownerEmailOf(ctx: Ctx): string | null {
  return ctx?.userEmail?.trim().toLowerCase() || null;
}

function ownedBy(column: AnyColumn, email: string) {
  return sql`lower(trim(${column})) = ${email}`;
}

/** The user has created at least one design of their own. */
export async function hasOwnDesign(ctx: Ctx): Promise<boolean> {
  const email = ownerEmailOf(ctx);
  if (!email) return false;
  const rows = await getDb()
    .select({ id: schema.designs.id })
    .from(schema.designs)
    .where(
      and(
        accessFilter(schema.designs, schema.designShares),
        ownedBy(schema.designs.ownerEmail, email),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * A design system that is not an untouched copy of a built-in template.
 * `create-design-system` stores a template copy's `data` as the exact JSON of
 * the template snapshot, so any edit or custom system counts as the user's
 * brand while a one-click copy does not.
 */
export async function hasOwnBrand(ctx: Ctx): Promise<boolean> {
  const email = ownerEmailOf(ctx);
  if (!email) return false;
  const rows = await getDb()
    .select({ id: schema.designSystems.id })
    .from(schema.designSystems)
    .where(
      and(
        accessFilter(schema.designSystems, schema.designSystemShares),
        ownedBy(schema.designSystems.ownerEmail, email),
        notInArray(
          schema.designSystems.data,
          PRODUCTION_DESIGN_SYSTEM_TEMPLATES.map((template) =>
            JSON.stringify(template.data),
          ),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * `create-design-system` refuses to run while the design-system workflows flag
 * is off, so the step would be impossible to finish. A user who already has a
 * brand keeps the step either way.
 */
export async function canAddBrand(ctx: Ctx): Promise<boolean> {
  const enabled = await isFeatureFlagEnabled(DESIGN_SYSTEM_WORKFLOWS, {
    userEmail: ctx?.userEmail,
    orgId: ctx?.orgId ?? undefined,
  });
  return enabled || (await hasOwnBrand(ctx));
}

/**
 * The user connected a running app (a localhost connection) to Design, so
 * designs can start from its real screens and data. Design has no other
 * per-user data-source row; a connection that errored does not count.
 */
export async function hasConnectedDataSource(ctx: Ctx): Promise<boolean> {
  const email = ownerEmailOf(ctx);
  if (!email) return false;
  const rows = await getDb()
    .select({ id: schema.designLocalhostConnections.id })
    .from(schema.designLocalhostConnections)
    .where(
      and(
        ownedBy(schema.designLocalhostConnections.ownerEmail, email),
        inArray(schema.designLocalhostConnections.status, [
          "connected",
          "manual",
        ]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Something the user shared on purpose. New designs in an organization start
 * with `org` visibility, so only an explicit grant to someone else or a public
 * link counts.
 */
export async function hasSharedDesign(ctx: Ctx): Promise<boolean> {
  const email = ownerEmailOf(ctx);
  if (!email) return false;
  const db = getDb();
  const ownDesign = and(
    accessFilter(schema.designs, schema.designShares),
    ownedBy(schema.designs.ownerEmail, email),
  );
  const [grants, publicDesigns] = await Promise.all([
    db
      .select({ id: schema.designShares.id })
      .from(schema.designShares)
      .innerJoin(
        schema.designs,
        eq(schema.designs.id, schema.designShares.resourceId),
      )
      .where(
        and(
          ownDesign,
          sql`not (${schema.designShares.principalType} = 'user' and lower(trim(${schema.designShares.principalId})) = ${email})`,
        ),
      )
      .limit(1),
    db
      .select({ id: schema.designs.id })
      .from(schema.designs)
      .where(and(ownDesign, eq(schema.designs.visibility, "public")))
      .limit(1),
  ]);
  return grants.length > 0 || publicDesigns.length > 0;
}

/**
 * The organization has someone besides the caller, or an invitation waiting.
 * No active organization (or no organization tables at all) means no teammate
 * can exist yet; any other read failure rejects so it is not reported as "no".
 */
export async function hasInvitedTeammate(ctx: Ctx): Promise<boolean> {
  const orgId = ctx?.orgId;
  if (!orgId) return false;
  try {
    const db = getDbExec();
    const members = await db.execute({
      sql: `SELECT 1 FROM org_members
            WHERE org_id = ? AND federation_removal_pending_at IS NULL
            LIMIT 2`,
      args: [orgId],
    });
    if (members.rows.length > 1) return true;
    const invitations = await db.execute({
      sql: `SELECT 1 FROM org_invitations
            WHERE org_id = ? AND status = 'pending'
            LIMIT 1`,
      args: [orgId],
    });
    return invitations.rows.length > 0;
  } catch (error) {
    if (isMissingOrganizationTableError(error)) return false;
    throw error;
  }
}

/** The user saved a design as a template of their own. */
export async function hasSavedTemplate(ctx: Ctx): Promise<boolean> {
  const email = ownerEmailOf(ctx);
  if (!email) return false;
  const rows = await getDb()
    .select({ id: schema.designTemplates.id })
    .from(schema.designTemplates)
    .where(
      and(
        accessFilter(schema.designTemplates, schema.designTemplateShares),
        ownedBy(schema.designTemplates.ownerEmail, email),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

type GettingStartedStep = Pick<
  OnboardingStep,
  | "id"
  | "order"
  | "title"
  | "description"
  | "href"
  | "isAvailable"
  | "isComplete"
>;

export const GETTING_STARTED_STEPS: GettingStartedStep[] = [
  {
    id: "create-design",
    order: 10,
    title: "Create your first design",
    description: "Describe what you want and let the agent build it.",
    href: "/home",
    isComplete: hasOwnDesign,
  },
  {
    id: "add-brand",
    order: 20,
    title: "Add your brand",
    description: "Set up a design system with your colors, type, and logo.",
    href: "/design-systems/setup",
    isAvailable: canAddBrand,
    isComplete: hasOwnBrand,
  },
  {
    id: "use-real-data",
    order: 30,
    title: "Use your real data",
    description: "Connect a running app so designs start from real screens.",
    href: "/settings/integrations",
    isComplete: hasConnectedDataSource,
  },
  {
    id: "share-feedback",
    order: 40,
    title: "Share for feedback",
    description: "Share a design with someone or publish a link.",
    href: "/home",
    isComplete: hasSharedDesign,
  },
  {
    id: "invite-teammate",
    order: 50,
    title: "Invite a teammate",
    description: "Add someone to your organization.",
    href: "/settings/organization",
    isComplete: hasInvitedTeammate,
  },
  {
    id: "save-template",
    order: 60,
    title: "Save a design as a template",
    description: "Turn a finished design into something your team can reuse.",
    href: "/home",
    isComplete: hasSavedTemplate,
  },
];

/** Safe to call from every entry point that reads the checklist; a repeat replaces the same ids. */
export function registerGettingStartedSteps(): void {
  for (const step of GETTING_STARTED_STEPS) {
    registerOnboardingStep({
      ...step,
      checklist: GETTING_STARTED_CHECKLIST,
      required: false,
      methods: [],
    });
  }
}
