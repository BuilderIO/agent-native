import { createHash } from "node:crypto";

export const HUB_APP = "dispatch";

const STANDARD_ORG_ID = /^[0-9a-f]{32}$/i;
const ORG_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "member"]);

export type OrgRole = "owner" | "admin" | "member";

export interface BackfillOrg {
  id: string;
  name: string;
  allowedDomain: string | null;
  identityAuthority: string | null;
  identityId: string | null;
  createdAt: number;
}

export interface BackfillMember {
  orgId: string;
  email: string;
  role: string;
}

export interface AppSnapshot {
  app: string;
  orgs: BackfillOrg[];
  members: BackfillMember[];
}

export interface RosterMember {
  email: string;
  role: OrgRole;
}

export interface HubOrgCreate {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  members: RosterMember[];
}

export interface AppLink {
  app: string;
  orgId: string;
  canonicalId: string;
}

export type SkipReason =
  | "has-domain"
  | "already-linked"
  | "non-standard-id"
  | "no-members"
  | "no-owner"
  | "invalid-role"
  | "duplicate-in-app"
  | "hub-id-conflict";

export interface SkippedOrg {
  app: string;
  orgId: string;
  reason: SkipReason;
}

export interface SameTeamGroup {
  orgs: Array<{ app: string; orgId: string }>;
}

export interface PlanCounts {
  peopleLinked: number;
  onePersonOrgsLinked: number;
  multiPersonOrgsLinked: number;
  hubCreates: number;
  appLinksByApp: Record<string, number>;
  skippedByReason: Record<string, number>;
}

export interface BackfillPlan {
  authority: string;
  hubCreates: HubOrgCreate[];
  appLinks: AppLink[];
  skipped: SkippedOrg[];
  sameTeamAcrossApps: SameTeamGroup[];
  counts: PlanCounts;
}

interface Candidate {
  app: string;
  org: BackfillOrg;
  roster: RosterMember[];
}

/** Stable text form of a roster, so two rosters compare by email and role. */
export function rosterKey(
  roster: readonly { email: string; role: string }[],
): string {
  return roster
    .map((member) => `${member.email.trim().toLowerCase()}|${member.role}`)
    .sort()
    .join("\n");
}

/** Digest of a roster: lets a manifest prove a roster is unchanged without storing emails. */
export function rosterHash(
  roster: readonly { email: string; role: string }[],
): string {
  return createHash("sha256").update(rosterKey(roster)).digest("hex");
}

function byCreation(left: Candidate, right: Candidate): number {
  return (
    left.org.createdAt - right.org.createdAt ||
    left.app.localeCompare(right.app) ||
    left.org.id.localeCompare(right.org.id)
  );
}

function isOrgRole(role: string): role is OrgRole {
  return ORG_ROLES.has(role);
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

/**
 * Decides which organizations get a shared identity and what each database
 * must write. Pure: every row comes from the snapshots, nothing is read or
 * written here. Organizations with a domain are left alone because the domain
 * path already works for them.
 */
export function buildBackfillPlan(
  snapshots: readonly AppSnapshot[],
  options: { authority: string; hubApp?: string },
): BackfillPlan {
  const hubApp = options.hubApp ?? HUB_APP;
  const ordered = [...snapshots].sort((a, b) => a.app.localeCompare(b.app));
  const hub = ordered.find((snapshot) => snapshot.app === hubApp);
  if (!hub) throw new Error(`The ${hubApp} snapshot is required.`);
  const hubOrgIds = new Set(hub.orgs.map((org) => org.id));
  const hubOrgsById = new Map(hub.orgs.map((org) => [org.id, org]));
  const hubRosterMembers = new Map<
    string,
    Array<{ email: string; role: string }>
  >();
  for (const member of hub.members) {
    const list = hubRosterMembers.get(member.orgId) ?? [];
    list.push({ email: member.email, role: member.role });
    hubRosterMembers.set(member.orgId, list);
  }
  // An interrupted apply leaves hub rows created but app workspaces unlinked.
  // A hub row this script would have written (self-mapped to the authority,
  // same roster) is resumable, not a conflict.
  const hubRowResumes = (id: string, roster: readonly RosterMember[]) => {
    const org = hubOrgsById.get(id);
    return (
      org !== undefined &&
      org.identityAuthority?.trim() === options.authority &&
      org.identityId?.trim() === id &&
      rosterKey(hubRosterMembers.get(id) ?? []) === rosterKey(roster)
    );
  };

  const skipped: SkippedOrg[] = [];
  const onePerson: Candidate[] = [];
  const multiPerson: Candidate[] = [];
  const linkedOnePerson: Array<{
    app: string;
    org: BackfillOrg;
    email: string;
  }> = [];

  for (const snapshot of ordered) {
    const membersByOrg = new Map<string, BackfillMember[]>();
    for (const member of snapshot.members) {
      const list = membersByOrg.get(member.orgId) ?? [];
      list.push(member);
      membersByOrg.set(member.orgId, list);
    }
    for (const org of snapshot.orgs) {
      const skip = (reason: SkipReason) =>
        skipped.push({ app: snapshot.app, orgId: org.id, reason });
      if (org.identityAuthority?.trim() || org.identityId?.trim()) {
        const linkedEmails = new Set(
          (membersByOrg.get(org.id) ?? []).map((member) =>
            member.email.trim().toLowerCase(),
          ),
        );
        const [soleMember] = [...linkedEmails];
        if (
          org.identityAuthority?.trim() === options.authority &&
          org.identityId?.trim() &&
          linkedEmails.size === 1 &&
          soleMember
        ) {
          linkedOnePerson.push({ app: snapshot.app, org, email: soleMember });
        }
        skip("already-linked");
        continue;
      }
      if (org.allowedDomain?.trim()) {
        skip("has-domain");
        continue;
      }
      if (!STANDARD_ORG_ID.test(org.id)) {
        skip("non-standard-id");
        continue;
      }
      const seen = new Set<string>();
      const roster: RosterMember[] = [];
      let invalidRole = false;
      for (const member of membersByOrg.get(org.id) ?? []) {
        const email = member.email.trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        if (!isOrgRole(member.role)) {
          invalidRole = true;
          continue;
        }
        roster.push({ email, role: member.role });
      }
      if (invalidRole) {
        skip("invalid-role");
        continue;
      }
      if (roster.length === 0) {
        skip("no-members");
        continue;
      }
      if (!roster.some((member) => member.role === "owner")) {
        skip("no-owner");
        continue;
      }
      roster.sort((a, b) => a.email.localeCompare(b.email));
      (roster.length === 1 ? onePerson : multiPerson).push({
        app: snapshot.app,
        org,
        roster,
      });
    }
  }

  // A rerun must extend a person's existing shared id, never start a second
  // one: their already-linked workspaces keep their slot in each app.
  const existingCanonical = new Map<string, string>();
  const occupied = new Set<string>();
  for (const linked of [...linkedOnePerson].sort(
    (a, b) =>
      a.org.createdAt - b.org.createdAt ||
      a.app.localeCompare(b.app) ||
      a.org.id.localeCompare(b.org.id),
  )) {
    if (!existingCanonical.has(linked.email)) {
      existingCanonical.set(linked.email, (linked.org.identityId ?? "").trim());
    }
    occupied.add(`${linked.email}\n${linked.app}`);
  }

  const hubCreates: HubOrgCreate[] = [];
  const hubCreateIds = new Set<string>();
  const appLinks: AppLink[] = [];

  const byPerson = new Map<string, Candidate[]>();
  for (const candidate of onePerson) {
    const person = candidate.roster[0]?.email;
    if (!person) continue;
    const group = byPerson.get(person) ?? [];
    group.push(candidate);
    byPerson.set(person, group);
  }
  let peopleLinked = 0;
  let onePersonOrgsLinked = 0;
  for (const [person, group] of [...byPerson.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const existing = existingCanonical.get(person);
    const perApp = new Map<string, Candidate>();
    for (const candidate of [...group].sort(byCreation)) {
      if (
        perApp.has(candidate.app) ||
        occupied.has(`${person}\n${candidate.app}`) ||
        (existing && candidate.app === hubApp)
      ) {
        skipped.push({
          app: candidate.app,
          orgId: candidate.org.id,
          reason: "duplicate-in-app",
        });
        continue;
      }
      perApp.set(candidate.app, candidate);
    }
    const members = [...perApp.values()].sort(byCreation);
    if (existing) {
      for (const candidate of members) {
        appLinks.push({
          app: candidate.app,
          orgId: candidate.org.id,
          canonicalId: existing,
        });
        onePersonOrgsLinked += 1;
      }
      if (members.length > 0) peopleLinked += 1;
      continue;
    }
    const hubMember = perApp.get(hubApp);
    const canonical = hubMember ?? members[0];
    if (!canonical) continue;
    const canonicalId = canonical.org.id;
    const soleOwner: RosterMember[] = [{ email: person, role: "owner" }];
    const resumes = !hubMember && hubRowResumes(canonicalId, soleOwner);
    if (
      !hubMember &&
      !resumes &&
      (hubOrgIds.has(canonicalId) || hubCreateIds.has(canonicalId))
    ) {
      for (const candidate of members) {
        skipped.push({
          app: candidate.app,
          orgId: candidate.org.id,
          reason: "hub-id-conflict",
        });
      }
      continue;
    }
    if (!hubMember && !resumes) {
      hubCreates.push({
        id: canonicalId,
        name: canonical.org.name,
        createdBy: person,
        createdAt: canonical.org.createdAt,
        members: soleOwner,
      });
      hubCreateIds.add(canonicalId);
    }
    for (const candidate of members) {
      appLinks.push({
        app: candidate.app,
        orgId: candidate.org.id,
        canonicalId,
      });
      onePersonOrgsLinked += 1;
    }
    peopleLinked += 1;
  }

  const linkedMulti: Candidate[] = [];
  for (const candidate of [...multiPerson].sort(byCreation)) {
    const id = candidate.org.id;
    const inHub = candidate.app === hubApp;
    const resumes = !inHub && hubRowResumes(id, candidate.roster);
    if (!inHub && !resumes && (hubOrgIds.has(id) || hubCreateIds.has(id))) {
      skipped.push({
        app: candidate.app,
        orgId: id,
        reason: "hub-id-conflict",
      });
      continue;
    }
    if (!inHub && !resumes) {
      const owner = candidate.roster.find((member) => member.role === "owner");
      hubCreates.push({
        id,
        name: candidate.org.name,
        createdBy: owner ? owner.email : "",
        createdAt: candidate.org.createdAt,
        members: candidate.roster,
      });
      hubCreateIds.add(id);
    }
    appLinks.push({ app: candidate.app, orgId: id, canonicalId: id });
    linkedMulti.push(candidate);
  }

  const teams = new Map<string, Array<{ app: string; orgId: string }>>();
  for (const candidate of linkedMulti) {
    const key = createHash("sha256")
      .update(candidate.roster.map((member) => member.email).join(","))
      .digest("hex");
    const list = teams.get(key) ?? [];
    list.push({ app: candidate.app, orgId: candidate.org.id });
    teams.set(key, list);
  }
  const sameTeamAcrossApps: SameTeamGroup[] = [...teams.values()]
    .filter((orgs) => new Set(orgs.map((org) => org.app)).size > 1)
    .map((orgs) => ({ orgs }));

  skipped.sort(
    (a, b) =>
      a.app.localeCompare(b.app) ||
      a.orgId.localeCompare(b.orgId) ||
      a.reason.localeCompare(b.reason),
  );

  const counts: PlanCounts = {
    peopleLinked,
    onePersonOrgsLinked,
    multiPersonOrgsLinked: linkedMulti.length,
    hubCreates: hubCreates.length,
    appLinksByApp: {},
    skippedByReason: {},
  };
  for (const link of appLinks) increment(counts.appLinksByApp, link.app);
  for (const entry of skipped) increment(counts.skippedByReason, entry.reason);

  return {
    authority: options.authority,
    hubCreates,
    appLinks,
    skipped,
    sameTeamAcrossApps,
    counts,
  };
}
