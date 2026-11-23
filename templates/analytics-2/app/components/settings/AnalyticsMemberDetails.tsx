import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useOrgDeactivatedMembers,
  useOrgInvitations,
  useOrgMembers,
} from "@agent-native/core/client/org";
import type { OrgMember, OrgRole } from "@agent-native/core/org/types";
import type { WorkspaceUserGroup } from "@agent-native/core/workspace-connections/groups";
import {
  formatLocaleDate,
  useReaderLocale,
} from "@agent-native/toolkit/app/shared/reader-locale";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type MemberDirectoryStatus = "active" | "invited" | "deactivated";

export interface MemberWithLastActive extends OrgMember {
  lastActiveAt?: number | null;
}

export interface MemberDetailRow {
  email: string;
  displayName: string;
  role: OrgRole;
  groups: string[];
  lastActiveAt: number | null;
  status: MemberDirectoryStatus;
}

export interface MemberRoleCounts {
  owner: number;
  admin: number;
  member: number;
  invited: number;
  deactivated: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatMemberLastActive(
  lastActiveAt: number | null | undefined,
  now: number,
  locale: string,
  labels: { today: string; yesterday: string; never: string },
): string {
  if (typeof lastActiveAt !== "number" || !Number.isFinite(lastActiveAt)) {
    return labels.never;
  }
  const nowDate = new Date(now);
  const todayStart = Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate(),
  );
  if (lastActiveAt >= todayStart) return labels.today;
  if (lastActiveAt >= todayStart - DAY_MS) return labels.yesterday;
  return formatLocaleDate(new Date(lastActiveAt).toISOString(), locale);
}

export function buildMemberDetailsSummary(input: {
  members: readonly MemberWithLastActive[];
  invitations: readonly { email: string; role: Exclude<OrgRole, "owner"> }[];
  deactivated: readonly { email: string; role: Exclude<OrgRole, "owner"> }[];
  groups: readonly WorkspaceUserGroup[];
}): { rows: MemberDetailRow[]; counts: MemberRoleCounts } {
  const groupsByEmail = new Map<string, Set<string>>();
  for (const group of input.groups) {
    const groupName = group.name.trim();
    if (!groupName) continue;
    for (const rawEmail of group.memberEmails) {
      const normalized = rawEmail.trim().toLowerCase();
      if (!normalized) continue;
      let names = groupsByEmail.get(normalized);
      if (!names) {
        names = new Set();
        groupsByEmail.set(normalized, names);
      }
      names.add(groupName);
    }
  }

  const groupsFor = (email: string): string[] =>
    [...(groupsByEmail.get(email.trim().toLowerCase()) ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );

  const counts: MemberRoleCounts = {
    owner: 0,
    admin: 0,
    member: 0,
    invited: 0,
    deactivated: 0,
  };
  const seen = new Set<string>();
  const rows: MemberDetailRow[] = [];

  for (const member of input.members) {
    const key = member.email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    counts[member.role] += 1;
    rows.push({
      email: member.email,
      displayName: member.name?.trim() || member.email,
      role: member.role,
      groups: groupsFor(member.email),
      lastActiveAt:
        typeof member.lastActiveAt === "number" ? member.lastActiveAt : null,
      status: "active",
    });
  }

  for (const invite of input.invitations) {
    const key = invite.email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    counts.invited += 1;
    rows.push({
      email: invite.email,
      displayName: invite.email,
      role: invite.role,
      groups: groupsFor(invite.email),
      lastActiveAt: null,
      status: "invited",
    });
  }

  for (const former of input.deactivated) {
    const key = former.email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    counts.deactivated += 1;
    rows.push({
      email: former.email,
      displayName: former.email,
      role: former.role,
      groups: groupsFor(former.email),
      lastActiveAt: null,
      status: "deactivated",
    });
  }

  return { rows, counts };
}

function roleLabel(
  role: OrgRole,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  if (role === "owner") {
    return t("analytics.settings.users.memberDetails.roleOwner");
  }
  if (role === "admin") {
    return t("analytics.settings.users.memberDetails.roleAdmin");
  }
  return t("analytics.settings.users.memberDetails.roleMember");
}

function statusLabel(
  status: MemberDirectoryStatus,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  if (status === "invited") {
    return t("analytics.settings.users.memberDetails.statusInvited");
  }
  if (status === "deactivated") {
    return t("analytics.settings.users.memberDetails.statusDeactivated");
  }
  return t("analytics.settings.users.memberDetails.statusActive");
}

export function AnalyticsMemberDetails() {
  const t = useT();
  const locale = useReaderLocale();
  const membersQuery = useOrgMembers(0, "");
  const invitationsQuery = useOrgInvitations();
  const deactivatedQuery = useOrgDeactivatedMembers();
  const groupsQuery = useActionQuery<WorkspaceUserGroup[]>(
    "list-workspace-user-groups",
    {},
    { retry: 1 },
  );

  const memberList = (membersQuery.data?.members ??
    []) as MemberWithLastActive[];
  const invitations = invitationsQuery.data?.invitations ?? [];
  const deactivated = deactivatedQuery.data?.members ?? [];
  const groups = Array.isArray(groupsQuery.data) ? groupsQuery.data : [];

  const { rows, counts } = buildMemberDetailsSummary({
    members: memberList,
    invitations,
    deactivated,
    groups,
  });

  const now = Date.now();
  const lastActiveLabels = {
    today: t("analytics.settings.users.memberDetails.lastActiveToday"),
    yesterday: t("analytics.settings.users.memberDetails.lastActiveYesterday"),
    never: t("analytics.settings.users.memberDetails.lastActiveNever"),
  };

  return (
    <section
      aria-labelledby="member-details-heading"
      className="space-y-3"
      data-member-details=""
    >
      <h2
        id="member-details-heading"
        className="text-sm font-semibold text-foreground"
      >
        {t("analytics.settings.users.memberDetails.title")}
      </h2>

      {membersQuery.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("analytics.settings.users.memberDetails.loading")}
        </p>
      ) : membersQuery.error || !membersQuery.data ? (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
          role="alert"
        >
          <p className="text-sm text-destructive">
            {t("analytics.settings.users.memberDetails.loadError")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void membersQuery.refetch();
            }}
          >
            {t("analytics.organizationCatalog.retry")}
          </Button>
        </div>
      ) : (
        <>
          <div
            className="flex flex-wrap items-center gap-2"
            data-member-role-counts=""
          >
            <Badge variant="outline" data-role-count="owner">
              {t("analytics.settings.users.memberDetails.ownersCount", {
                count: counts.owner,
              })}
            </Badge>
            <Badge variant="outline" data-role-count="admin">
              {t("analytics.settings.users.memberDetails.adminsCount", {
                count: counts.admin,
              })}
            </Badge>
            <Badge variant="outline" data-role-count="member">
              {t("analytics.settings.users.memberDetails.membersCount", {
                count: counts.member,
              })}
            </Badge>
            {counts.invited > 0 ? (
              <Badge variant="secondary" data-status-count="invited">
                {t("analytics.settings.users.memberDetails.invitedCount", {
                  count: counts.invited,
                })}
              </Badge>
            ) : null}
            {counts.deactivated > 0 ? (
              <Badge variant="secondary" data-status-count="deactivated">
                {t("analytics.settings.users.memberDetails.deactivatedCount", {
                  count: counts.deactivated,
                })}
              </Badge>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("analytics.settings.users.memberDetails.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("analytics.settings.users.memberDetails.columnMember")}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("analytics.settings.users.memberDetails.columnRole")}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("analytics.settings.users.memberDetails.columnGroups")}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t(
                        "analytics.settings.users.memberDetails.columnLastActive",
                      )}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("analytics.settings.users.memberDetails.columnStatus")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.email} data-member-detail={row.email}>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-foreground">
                          {row.displayName}
                        </div>
                        {row.displayName !== row.email ? (
                          <div className="text-xs text-muted-foreground">
                            {row.email}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {roleLabel(row.role, t)}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.groups.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.groups.map((groupName) => (
                              <Badge key={groupName} variant="secondary">
                                {groupName}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {row.status === "active"
                          ? formatMemberLastActive(
                              row.lastActiveAt,
                              now,
                              locale,
                              lastActiveLabels,
                            )
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant={
                            row.status === "active" ? "outline" : "secondary"
                          }
                          data-member-status={row.status}
                        >
                          {statusLabel(row.status, t)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
