import { getDbExec, type DbExec } from "../db/client.js";
import {
  parseJobResource,
  type JobFrontmatter,
  type JobResourceClassification,
} from "../jobs/frontmatter.js";
import {
  organizationIdFromResourceOwner,
  resourceGet,
  resourceListAllOwners,
  SHARED_OWNER,
  type Resource,
} from "../resources/store.js";
import {
  loadAutomationSharingGrants,
  loadAutomationSharingOverlays,
  type AutomationSharingGrantRole,
  type AutomationSharingGrantRow,
  type AutomationSharingOverlayRow,
} from "./sharing-store.js";

export type AutomationEffectiveRole = "owner" | "collaborate" | "view";
export type AutomationAccessSource = "explicit" | "legacy";
export type AutomationEffectiveVisibility =
  | "private"
  | "organization"
  | "shared";

export interface AutomationCapabilities {
  canEdit: boolean;
  canOperate: boolean;
  canDelete: boolean;
  canManageSharing: boolean;
}

export interface AutomationSharingGrantSummary {
  email: string;
  role: AutomationSharingGrantRole;
  name: string | null;
  avatar: string | null;
}

export interface AutomationSharingListSummary {
  source: AutomationAccessSource;
  visibility: AutomationEffectiveVisibility;
  organizationId: string | null;
  grantCount: number;
  grants?: AutomationSharingGrantSummary[];
}

export interface AutomationCreatorSummary {
  email: string | null;
  label: string | null;
}

export interface AccessibleAutomation {
  resource: Resource;
  name: string;
  classification: JobResourceClassification;
  meta: JobFrontmatter;
  body: string;
  immutableCreator: string | null;
  owningOrganizationId: string | null;
  effectiveRole: AutomationEffectiveRole;
  capabilities: AutomationCapabilities;
  sharing: AutomationSharingListSummary;
  creator: AutomationCreatorSummary;
}

export interface AutomationAccessActor {
  userEmail: string;
}

interface ParsedCandidate {
  resource: Resource;
  name: string;
  classification: JobResourceClassification;
  meta: JobFrontmatter;
  body: string;
  immutableCreator: string | null;
  owningOrganizationId: string | null;
  sharedCompatibility: boolean;
}

interface AutomationAccountProfile {
  name: string | null;
  avatar: string | null;
}

interface AccessData {
  overlays: Map<string, AutomationSharingOverlayRow>;
  grants: Map<string, AutomationSharingGrantRow[]>;
  memberships: Set<string>;
  profiles: Map<string, AutomationAccountProfile>;
}

const SQL_BATCH_SIZE = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized && EMAIL_RE.test(normalized) ? normalized : null;
}

function normalizeActor(actor: AutomationAccessActor): string {
  const email = normalizeEmail(actor.userEmail);
  if (!email) {
    throw Object.assign(new Error("Not authenticated."), { statusCode: 401 });
  }
  return email;
}

function automationName(path: string): string {
  return path.replace(/^jobs\//, "").replace(/\.md$/, "");
}

function isJobResource(resource: Resource): boolean {
  return (
    resource.path.startsWith("jobs/") &&
    resource.path.endsWith(".md") &&
    !resource.path.endsWith(".keep")
  );
}

function parseCandidate(resource: Resource): ParsedCandidate | null {
  if (!isJobResource(resource)) return null;
  const parsed = parseJobResource(resource.content);
  const owningOrganizationId = organizationIdFromResourceOwner(resource.owner);
  const sharedCompatibility = resource.owner === SHARED_OWNER;

  if (sharedCompatibility) {
    return {
      resource,
      name: automationName(resource.path),
      ...parsed,
      immutableCreator: normalizeEmail(parsed.meta.createdBy),
      owningOrganizationId: null,
      sharedCompatibility: true,
    };
  }

  if (owningOrganizationId) {
    const immutableCreator = normalizeEmail(parsed.meta.createdBy);
    if (
      !immutableCreator ||
      (parsed.meta.orgId !== undefined &&
        parsed.meta.orgId.trim() !== owningOrganizationId)
    ) {
      return null;
    }
    return {
      resource,
      name: automationName(resource.path),
      ...parsed,
      immutableCreator,
      owningOrganizationId,
      sharedCompatibility: false,
    };
  }

  const owner = normalizeEmail(resource.owner);
  const declaredCreator =
    parsed.meta.createdBy === undefined
      ? null
      : normalizeEmail(parsed.meta.createdBy);
  if (
    !owner ||
    (parsed.meta.createdBy !== undefined && declaredCreator !== owner)
  ) {
    return null;
  }
  return {
    resource,
    name: automationName(resource.path),
    ...parsed,
    immutableCreator: owner,
    owningOrganizationId: null,
    sharedCompatibility: false,
  };
}

function chunks<T>(values: readonly T[], size = SQL_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function membershipKey(orgId: string, email: string): string {
  return `${orgId}\u0000${email}`;
}

async function loadMemberships(
  candidates: readonly ParsedCandidate[],
  overlays: ReadonlyMap<string, AutomationSharingOverlayRow>,
  callerEmail: string,
  client: DbExec,
): Promise<Set<string>> {
  const organizationIds = [
    ...new Set(
      candidates
        .flatMap((candidate) => [
          candidate.owningOrganizationId,
          overlays.get(candidate.resource.id)?.organizationId?.trim() || null,
        ])
        .filter((value): value is string => !!value),
    ),
  ];
  const creatorEmails = candidates
    .map((candidate) => candidate.immutableCreator)
    .filter((value): value is string => !!value);
  const emails = [...new Set([callerEmail, ...creatorEmails])];
  const memberships = new Set<string>();

  for (const orgBatch of chunks(organizationIds)) {
    for (const emailBatch of chunks(emails)) {
      const result = await client.execute({
        sql: `SELECT org_id, email FROM org_members WHERE org_id IN (${orgBatch.map(() => "?").join(", ")}) AND LOWER(email) IN (${emailBatch.map(() => "?").join(", ")})`,
        args: [...orgBatch, ...emailBatch],
      });
      for (const row of result.rows) {
        const orgId = String(row.org_id ?? "").trim();
        const email = normalizeEmail(String(row.email ?? ""));
        if (orgId && email) memberships.add(membershipKey(orgId, email));
      }
    }
  }
  return memberships;
}

async function loadProfiles(
  candidates: readonly ParsedCandidate[],
  grants: ReadonlyMap<string, AutomationSharingGrantRow[]>,
  client: DbExec,
): Promise<Map<string, AutomationAccountProfile>> {
  const emails = [
    ...new Set([
      ...candidates
        .map((candidate) => candidate.immutableCreator)
        .filter((value): value is string => !!value),
      ...[...grants.values()].flatMap((entries) =>
        entries
          .map((entry) => normalizeEmail(entry.email))
          .filter((value): value is string => !!value),
      ),
    ]),
  ];
  const profiles = new Map<string, AutomationAccountProfile>();
  for (const emailBatch of chunks(emails)) {
    const result = await client.execute({
      sql: `SELECT email, name, image FROM "user" WHERE LOWER(email) IN (${emailBatch.map(() => "?").join(", ")})`,
      args: emailBatch,
    });
    for (const row of result.rows) {
      const email = normalizeEmail(String(row.email ?? ""));
      if (!email) continue;
      const name = String(row.name ?? "").trim();
      const avatar = String(row.image ?? "").trim();
      profiles.set(email, {
        name: name || null,
        avatar: avatar || null,
      });
    }
  }
  return profiles;
}

function capabilitiesForRole(
  role: AutomationEffectiveRole,
): AutomationCapabilities {
  return {
    canEdit: role === "owner" || role === "collaborate",
    canOperate: role === "owner" || role === "collaborate",
    canDelete: role === "owner",
    canManageSharing: role === "owner",
  };
}

function explicitSharingSummary(
  overlay: AutomationSharingOverlayRow,
  grants: readonly AutomationSharingGrantRow[],
): AutomationSharingListSummary | null {
  if (overlay.visibility === "organization") {
    const organizationId = overlay.organizationId?.trim() || null;
    if (!organizationId) return null;
    return {
      source: "explicit",
      visibility: "organization",
      organizationId,
      grantCount: grants.length,
    };
  }
  return {
    source: "explicit",
    visibility: "private",
    organizationId: overlay.organizationId?.trim() || null,
    grantCount: grants.length,
  };
}

function legacySharingSummary(
  candidate: ParsedCandidate,
): AutomationSharingListSummary {
  if (candidate.sharedCompatibility) {
    return {
      source: "legacy",
      visibility: "shared",
      organizationId: null,
      grantCount: 0,
    };
  }
  if (candidate.owningOrganizationId) {
    return {
      source: "legacy",
      visibility: "organization",
      organizationId: candidate.owningOrganizationId,
      grantCount: 0,
    };
  }
  return {
    source: "legacy",
    visibility: "private",
    organizationId: null,
    grantCount: 0,
  };
}

function effectiveRole(
  candidate: ParsedCandidate,
  callerEmail: string,
  sharing: AutomationSharingListSummary,
  grants: readonly AutomationSharingGrantRow[],
  memberships: ReadonlySet<string>,
): AutomationEffectiveRole | null {
  if (
    !candidate.sharedCompatibility &&
    candidate.immutableCreator === callerEmail
  ) {
    return "owner";
  }
  const grant = grants.find((entry) => entry.email === callerEmail);
  if (grant) return grant.role as AutomationSharingGrantRole;
  if (candidate.sharedCompatibility && sharing.source === "legacy")
    return "view";
  if (
    sharing.visibility === "organization" &&
    sharing.organizationId &&
    memberships.has(membershipKey(sharing.organizationId, callerEmail))
  ) {
    return "view";
  }
  return null;
}

function evaluateCandidate(
  candidate: ParsedCandidate,
  callerEmail: string,
  data: AccessData,
): AccessibleAutomation | null {
  if (
    candidate.owningOrganizationId &&
    (!candidate.immutableCreator ||
      !data.memberships.has(
        membershipKey(
          candidate.owningOrganizationId,
          candidate.immutableCreator,
        ),
      ))
  ) {
    return null;
  }

  const overlay = data.overlays.get(candidate.resource.id);
  const grants = data.grants.get(candidate.resource.id) ?? [];
  const sharing = overlay
    ? explicitSharingSummary(overlay, grants)
    : legacySharingSummary(candidate);
  if (!sharing) return null;
  if (
    overlay &&
    candidate.owningOrganizationId &&
    candidate.owningOrganizationId !== sharing.organizationId &&
    (sharing.visibility === "organization" || sharing.organizationId !== null)
  ) {
    return null;
  }

  const role = effectiveRole(
    candidate,
    callerEmail,
    sharing,
    grants,
    data.memberships,
  );
  if (!role) return null;
  const visibleSharing =
    role === "owner" && grants.length
      ? {
          ...sharing,
          grants: grants.map(({ email, role: grantRole }) => {
            const normalizedEmail = normalizeEmail(email);
            if (!normalizedEmail) {
              throw new Error(
                "Stored automation sharing grant has invalid email.",
              );
            }
            const profile = data.profiles.get(normalizedEmail);
            return {
              email: normalizedEmail,
              role: grantRole,
              name: profile?.name ?? null,
              avatar: profile?.avatar ?? null,
            };
          }),
        }
      : sharing;
  return {
    resource: candidate.resource,
    name: candidate.name,
    classification: candidate.classification,
    meta: candidate.meta,
    body: candidate.body,
    immutableCreator: candidate.immutableCreator,
    owningOrganizationId: candidate.owningOrganizationId,
    effectiveRole: role,
    capabilities: capabilitiesForRole(role),
    sharing: visibleSharing,
    creator: {
      email: candidate.immutableCreator,
      label: candidate.immutableCreator
        ? (data.profiles.get(candidate.immutableCreator)?.name ??
          candidate.immutableCreator)
        : null,
    },
  };
}

async function loadAccessData(
  candidates: readonly ParsedCandidate[],
  callerEmail: string,
  client: DbExec,
): Promise<AccessData> {
  const resourceIds = candidates.map((candidate) => candidate.resource.id);
  const [overlays, grants] = await Promise.all([
    loadAutomationSharingOverlays(resourceIds, client),
    loadAutomationSharingGrants(resourceIds, client),
  ]);
  const [memberships, profiles] = await Promise.all([
    loadMemberships(candidates, overlays, callerEmail, client),
    loadProfiles(candidates, grants, client),
  ]);
  return { overlays, grants, memberships, profiles };
}

export async function listAccessibleAutomations(
  actor: AutomationAccessActor,
): Promise<AccessibleAutomation[]> {
  const callerEmail = normalizeActor(actor);
  const resources = await resourceListAllOwners("jobs/");
  const candidates = resources
    .map(parseCandidate)
    .filter((candidate): candidate is ParsedCandidate => !!candidate);
  if (!candidates.length) return [];
  const data = await loadAccessData(candidates, callerEmail, getDbExec());
  return candidates
    .map((candidate) => evaluateCandidate(candidate, callerEmail, data))
    .filter((entry): entry is AccessibleAutomation => !!entry)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.resource.owner.localeCompare(right.resource.owner) ||
        left.resource.id.localeCompare(right.resource.id),
    );
}

export async function resolveAutomationAccess(
  actor: AutomationAccessActor,
  resourceId: string,
): Promise<AccessibleAutomation | null> {
  const callerEmail = normalizeActor(actor);
  const resource = await resourceGet(resourceId.trim());
  if (!resource) return null;
  const candidate = parseCandidate(resource);
  if (!candidate) return null;
  const data = await loadAccessData([candidate], callerEmail, getDbExec());
  return evaluateCandidate(candidate, callerEmail, data);
}
