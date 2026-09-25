import { Skeleton } from "@agent-native/toolkit/design-system";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@agent-native/toolkit/ui/avatar";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  IconDots,
  IconSearch,
  IconUserMinus,
  IconUserPlus,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

// Type-only: erased at build time, so declaring app roles pulls no server or
// database code into the browser bundle.
import type { AppRolesDescriptor } from "../../../org/app-roles.js";
import { canInviteOrgMembers } from "../../../org/permissions.js";
import type { OrgInfo, OrgRole } from "../../../org/types.js";
import { useT } from "../../i18n.js";
import { useSettingsPageHeader } from "../../settings/shell/context.js";
import { DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS } from "../../sharing/share-controller-helpers.js";
import { BulkInviteForm } from "../BulkInviteForm.js";
import { GroupsSection } from "../GroupsSection.js";
import {
  useAppRoles,
  useChangeMemberRole,
  useOrgInvitations,
  useOrgMembers,
  useRemoveMember,
} from "../hooks.js";
import { AppPermissionsPanel, AppRoleControl } from "../MemberAppRoles.js";
import { MemberPagination } from "../MembersSection.js";
import { ErrorText } from "../TeamPrimitives.js";
import { OrgPageGate, orgRoleLabel } from "./OrgPageGate.js";

interface MemberItem {
  email: string;
  role: OrgRole;
  name?: string | null;
  image?: string | null;
}

const REMOVE_VALUE = "remove";

function initials(value: string): string {
  const base = value.includes("@") ? (value.split("@", 1)[0] ?? value) : value;
  const letters = base
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return letters || "?";
}

function RemoveMemberDialog({
  member,
  orgName,
  candidates,
  currentUserEmail,
  onClose,
}: {
  member: MemberItem | null;
  orgName: string;
  candidates: MemberItem[];
  currentUserEmail: string;
  onClose: () => void;
}) {
  const t = useT();
  const removeMember = useRemoveMember();
  const [transferTo, setTransferTo] = useState(currentUserEmail);
  const options = useMemo(() => {
    if (!member) return [];
    const target = member.email.toLowerCase();
    const list = candidates.filter(
      (candidate) => candidate.email.toLowerCase() !== target,
    );
    if (
      !list.some(
        (candidate) =>
          candidate.email.toLowerCase() === currentUserEmail.toLowerCase(),
      )
    ) {
      list.unshift({ email: currentUserEmail, role: "member" });
    }
    return list;
  }, [candidates, currentUserEmail, member]);

  const name = member ? member.name?.trim() || member.email : "";
  const validTransfer = options.some(
    (candidate) => candidate.email.toLowerCase() === transferTo.toLowerCase(),
  );

  return (
    <AlertDialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("agentChat.settingsOrg.members.removeTitle", { name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("agentChat.settingsOrg.members.removeDescription", {
              org: orgName,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5 text-sm">
          <span id="remove-member-transfer-label">{t("org.transferTo")}</span>
          <Select
            value={transferTo || undefined}
            onValueChange={setTransferTo}
            disabled={removeMember.isPending}
          >
            <SelectTrigger aria-labelledby="remove-member-transfer-label">
              <SelectValue placeholder={t("org.transferTo")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((candidate) => (
                <SelectItem key={candidate.email} value={candidate.email}>
                  {candidate.name?.trim() || candidate.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ErrorText error={removeMember.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>{t("org.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!validTransfer || removeMember.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (!member || !validTransfer) return;
              removeMember.mutate(
                { email: member.email, transferTo },
                { onSuccess: onClose },
              );
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("org.remove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MemberRoleControl({
  member,
  viewerRole,
  isCurrentUser,
  onRemove,
}: {
  member: MemberItem;
  viewerRole: OrgRole | null;
  isCurrentUser: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  const changeRole = useChangeMemberRole();
  const [pendingRole, setPendingRole] = useState<OrgRole | null>(null);
  const name = member.name?.trim() || member.email;
  const role = pendingRole ?? member.role;
  const staticRole = (
    <span className="text-sm text-muted-foreground">
      {orgRoleLabel(role, t)}
    </span>
  );

  if (isCurrentUser || member.role === "owner") return staticRole;

  if (viewerRole === "owner") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Select
          value={role}
          onValueChange={(value) => {
            if (value === REMOVE_VALUE) {
              onRemove();
              return;
            }
            const next: "admin" | "member" =
              value === "admin" ? "admin" : "member";
            if (next === member.role) return;
            setPendingRole(next);
            changeRole.mutate(
              { email: member.email, role: next },
              { onSettled: () => setPendingRole(null) },
            );
          }}
          disabled={changeRole.isPending}
        >
          <SelectTrigger
            className="h-9 w-32"
            aria-label={t("agentChat.settingsOrg.members.roleFor", { name })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="member">{t("org.member")}</SelectItem>
            <SelectItem value="admin">{t("org.admin")}</SelectItem>
            <SelectSeparator />
            <SelectItem value={REMOVE_VALUE} className="text-destructive">
              {t("org.removeMember")}
            </SelectItem>
          </SelectContent>
        </Select>
        <ErrorText error={changeRole.error} />
      </div>
    );
  }

  if (viewerRole === "admin" && member.role === "member") {
    return (
      <div className="flex items-center gap-1">
        {staticRole}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label={t("agentChat.settingsOrg.members.moreActions", {
                name,
              })}
            >
              <IconDots />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onRemove}
            >
              <IconUserMinus className="size-4" />
              {t("org.removeMember")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return staticRole;
}

function MemberRowItem({
  member,
  org,
  appRoles,
  appRoleAssignments,
  canManageAppRoles,
  onRemove,
}: {
  member: MemberItem;
  org: OrgInfo;
  appRoles?: AppRolesDescriptor;
  appRoleAssignments: string[];
  canManageAppRoles: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  const isCurrentUser =
    member.email.toLowerCase() === org.email.trim().toLowerCase();
  const displayName = member.name?.trim() || member.email;
  const avatarUrl = member.image?.trim() || null;

  return (
    <div className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar className="size-8 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
          <AvatarFallback className="border border-border bg-background text-xs font-medium text-muted-foreground">
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{displayName}</span>
            {isCurrentUser ? (
              <Badge variant="secondary">{t("org.you")}</Badge>
            ) : null}
          </div>
          {displayName !== member.email ? (
            <div className="truncate text-sm text-muted-foreground">
              {member.email}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {appRoles ? (
          <AppRoleControl
            email={member.email}
            appRoles={appRoles}
            assignedRoles={appRoleAssignments}
            canManage={canManageAppRoles}
          />
        ) : null}
        <MemberRoleControl
          member={member}
          viewerRole={org.role}
          isCurrentUser={isCurrentUser}
          onRemove={onRemove}
        />
      </div>
    </div>
  );
}

function MemberRowsSkeleton() {
  return (
    <div role="status" aria-busy="true">
      {["w-40", "w-52", "w-44"].map((width) => (
        <div
          key={width}
          className="flex items-center gap-3 px-5 py-3.5 sm:px-6"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className={`h-3.5 ${width}`} />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
      ))}
    </div>
  );
}

function InviteMembersAction({
  org,
  appRoles,
}: {
  org: OrgInfo;
  appRoles?: AppRolesDescriptor;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <IconUserPlus />
        {t("org.inviteMembers")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("org.inviteMembers")}</DialogTitle>
          </DialogHeader>
          <BulkInviteForm
            currentUserRole={org.role}
            appRoles={appRoles}
            onClose={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrgMembersContent({
  org,
  appRoles,
}: {
  org: OrgInfo;
  appRoles?: AppRolesDescriptor;
}) {
  const t = useT();
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<MemberItem | null>(null);
  const membersQuery = useOrgMembers(offset, search);
  const invitations = useOrgInvitations();
  const { data: appRoleData } = useAppRoles(appRoles?.appId);
  const canInvite = canInviteOrgMembers(org.role, org.emailConfigured);
  const canManageAppRoles = Boolean(appRoles && appRoleData?.canManage);

  useEffect(() => {
    const next = searchInput.trim().toLowerCase();
    if (next === search) return;
    const timer = window.setTimeout(
      () => {
        setSearch(next);
        setOffset(0);
      },
      next ? DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [search, searchInput]);

  const header = useMemo(
    () =>
      canInvite
        ? { action: <InviteMembersAction org={org} appRoles={appRoles} /> }
        : null,
    [appRoles, canInvite, org],
  );
  useSettingsPageHeader(header);

  const members = membersQuery.data?.members ?? [];
  const appRoleByEmail = new Map(
    (appRoleData?.assignments ?? []).map((assignment) => [
      assignment.email.toLowerCase(),
      assignment.roles,
    ]),
  );
  const pendingInvites = (invitations.data?.invitations ?? []).filter(
    (invite) => !search || invite.email.toLowerCase().includes(search),
  );
  const totalMembers = membersQuery.data?.totalCount;
  const isEmpty =
    membersQuery.data !== undefined &&
    members.length === 0 &&
    pendingInvites.length === 0;

  return (
    <div className="space-y-8">
      <section id="members" className="scroll-mt-16 space-y-3">
        <form
          role="search"
          className="relative w-full sm:w-72"
          onSubmit={(event) => event.preventDefault()}
        >
          <IconSearch
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("org.searchPeople")}
            aria-label={t("org.searchPeople")}
            aria-controls="organization-members-list"
            autoComplete="off"
            className="h-9 ps-8"
          />
        </form>
        <div
          id="organization-members-list"
          aria-busy={membersQuery.isFetching}
          className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card"
        >
          {membersQuery.error ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
            >
              <p className="text-sm text-destructive">
                {t("agentChat.share.loadPeopleFailed")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={membersQuery.isFetching}
                onClick={() => void membersQuery.refetch()}
              >
                {t("agentChat.common.retry")}
              </Button>
            </div>
          ) : membersQuery.data === undefined ? (
            <MemberRowsSkeleton />
          ) : isEmpty ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              {search ? t("org.noPeopleFound") : t("org.noMembers")}
            </p>
          ) : (
            <>
              {members.map((member) => (
                <MemberRowItem
                  key={member.email}
                  member={member}
                  org={org}
                  appRoles={appRoles}
                  appRoleAssignments={
                    appRoleByEmail.get(member.email.toLowerCase()) ?? []
                  }
                  canManageAppRoles={canManageAppRoles}
                  onRemove={() => setRemoving(member)}
                />
              ))}
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-3 px-5 py-3.5 sm:px-6"
                >
                  <Avatar className="size-8 shrink-0 opacity-70">
                    <AvatarFallback className="border border-border bg-background text-xs font-medium text-muted-foreground">
                      {initials(invite.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {invite.email}
                  </span>
                  <Badge variant="outline">{t("org.invited")}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {orgRoleLabel(invite.role, t)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
        {totalMembers !== undefined &&
        (offset > 0 || membersQuery.data?.hasMore) ? (
          <MemberPagination
            memberOffset={offset}
            totalMembers={totalMembers}
            hasNextPage={membersQuery.data?.hasMore === true}
            nextMemberOffset={membersQuery.data?.nextOffset ?? null}
            isFetchingMembers={membersQuery.isFetching}
            onMemberPageChange={setOffset}
          />
        ) : null}
      </section>
      {appRoles && Object.keys(appRoles.permissions ?? {}).length > 0 ? (
        <AppPermissionsPanel
          appRoles={appRoles}
          canManage={Boolean(appRoleData?.canManage)}
        />
      ) : null}
      <div id="groups" className="scroll-mt-16">
        <GroupsSection
          emptyMessage={t("agentChat.settingsOrg.members.groupsEmpty")}
        />
      </div>
      <RemoveMemberDialog
        key={removing?.email ?? ""}
        member={removing}
        orgName={org.orgName ?? ""}
        candidates={members}
        currentUserEmail={org.email}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

/**
 * Organization › Members: invite, search, roles, removal with a successor,
 * and groups. Templates with app roles register a replacement `members` page
 * that renders this with `appRoles`.
 */
export function OrgMembersPage({
  appRoles,
}: {
  /** Adds the app-role column, as `TeamPage`'s `appRoles` does. */
  appRoles?: AppRolesDescriptor;
}) {
  return (
    <OrgPageGate skeletonRows={3}>
      {(org) => (
        <OrgMembersContent key={org.orgId} org={org} appRoles={appRoles} />
      )}
    </OrgPageGate>
  );
}
