import { Skeleton } from "@agent-native/toolkit/design-system";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@agent-native/toolkit/ui/avatar";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@agent-native/toolkit/ui/command";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@agent-native/toolkit/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  IconUserPlus,
  IconTrash,
  IconCrown,
  IconShieldCheck,
  IconPencil,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

// Type-only: erased at build time, so declaring app roles pulls no server or
// database code into the browser bundle.
import type { AppRolesDescriptor } from "../../org/app-roles.js";
import { canInviteOrgMembers } from "../../org/permissions.js";
import type { OrgRole } from "../../org/types.js";
import type { WorkspaceUserGroup } from "../../workspace-connections/groups.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS } from "../sharing/share-controller-helpers.js";
import { useActionMutation } from "../use-action.js";
import { cn } from "../utils.js";
import { BulkInviteForm } from "./BulkInviteForm.js";
import {
  WorkspaceGroupEditor,
  useWorkspaceGroupEditor,
  useWorkspaceUserGroups,
  type WorkspaceGroupEditorController,
} from "./GroupsSection.js";
import {
  useOrg,
  useOrgMembers,
  useOrgInvitations,
  useChangeMemberRole,
  useRemoveMember,
  useAppRoles,
  useSetAppMemberRoles,
  ORG_MEMBER_PAGE_SIZE,
} from "./hooks.js";
import { AppRoleControl, AppPermissionsPanel } from "./MemberAppRoles.js";
import { Button, ErrorText, SectionTooltipProvider } from "./TeamPrimitives.js";

interface MemberListItem {
  email: string;
  role: OrgRole;
  name?: string | null;
  image?: string | null;
}

interface PendingInviteListItem {
  id: string;
  email: string;
  role: Exclude<OrgRole, "owner">;
}

function RoleIcon({ role }: { role: string }) {
  if (role === "owner")
    return <IconCrown className="h-3.5 w-3.5 text-primary" />;
  if (role === "admin")
    return <IconShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />;
  return null;
}

export function MembersTableCard({
  members,
  totalMembers,
  pendingInvites,
  isLoadingMembers,
  isFetchingMembers,
  membersError,
  onRetryMembers,
  currentUserEmail,
  currentUserRole,
  emailConfigured,
  appRoles,
  groups,
  canManageGroups,
  memberOffset,
  memberSearch,
  activeMemberSearch,
  hasNextPage,
  nextMemberOffset,
  onMemberPageChange,
  onMemberSearchChange,
  onCreateGroup,
}: {
  members: MemberListItem[];
  totalMembers: number | undefined;
  pendingInvites: PendingInviteListItem[];
  isLoadingMembers: boolean;
  isFetchingMembers: boolean;
  membersError: Error | null;
  onRetryMembers: () => void;
  currentUserEmail: string;
  currentUserRole: OrgRole | null;
  emailConfigured?: boolean;
  appRoles?: AppRolesDescriptor;
  groups: WorkspaceUserGroup[];
  canManageGroups: boolean;
  memberOffset: number;
  memberSearch: string;
  activeMemberSearch: string;
  hasNextPage: boolean;
  nextMemberOffset: number | null;
  onMemberPageChange: (offset: number) => void;
  onMemberSearchChange: (value: string) => void;
  onCreateGroup: (memberEmails: string[]) => void;
}) {
  const t = useT();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkActionKey, setBulkActionKey] = useState(0);
  const [bulkAppRoles, setBulkAppRoles] = useState<string[]>([]);
  const canInvite = canInviteOrgMembers(currentUserRole, emailConfigured);
  const updateGroupMembers = useActionMutation(
    "bulk-update-workspace-user-groups",
  );
  const { data: appRoleData } = useAppRoles(appRoles?.appId);
  const setAppMemberRoles = useSetAppMemberRoles();
  const canManageAppRoles = Boolean(appRoles && appRoleData?.canManage);
  const canBulkSelect = canManageGroups || canManageAppRoles;
  const appRoleByEmail = new Map(
    (appRoleData?.assignments ?? []).map((a) => [
      a.email.toLowerCase(),
      a.roles,
    ]),
  );
  const selectedCount = selectedEmails.size;
  const allMembersSelected =
    members.length > 0 &&
    members.every((member) => selectedEmails.has(member.email));
  const visiblePendingInvites = activeMemberSearch
    ? pendingInvites.filter((invite) =>
        invite.email.toLowerCase().includes(activeMemberSearch),
      )
    : pendingInvites;

  useEffect(() => {
    setSelectedEmails(new Set());
  }, [memberOffset, members]);

  function toggleSelected(email: string, checked: boolean) {
    setSelectedEmails((current) => {
      const next = new Set(current);
      if (checked) next.add(email);
      else next.delete(email);
      return next;
    });
  }

  function applyBulkAction(value: string) {
    const [operation, groupId] = value.split(":");
    if (
      (operation !== "add" && operation !== "remove") ||
      !groupId ||
      selectedEmails.size === 0
    ) {
      return;
    }
    updateGroupMembers.mutate(
      {
        groupId,
        memberEmails: Array.from(selectedEmails),
        operation,
      },
      {
        onSuccess: () => {
          setSelectedEmails(new Set());
          setBulkActionKey((key) => key + 1);
        },
      },
    );
  }

  async function applyBulkAppRoles() {
    if (!appRoles || !canManageAppRoles || selectedEmails.size === 0) return;
    try {
      for (const email of selectedEmails) {
        await setAppMemberRoles.mutateAsync({
          appId: appRoles.appId,
          email,
          roles: bulkAppRoles,
        });
      }
      setSelectedEmails(new Set());
      // The mutation error remains available on the shared mutation object so
      // the administrator can correct the selection and retry.
      // coercion-ok: the mutation object carries the typed failure to the UI.
    } catch {
      // The mutation exposes the failed request through its shared error UI;
      // keep the selection so the administrator can correct and retry.
    }
  }

  return (
    <section className="overflow-hidden rounded-xl bg-muted/20 p-1 text-card-foreground">
      <div className="flex flex-col gap-3 rounded-lg bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">{t("org.members")}</h3>
          {totalMembers !== undefined && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t("org.memberCount", { count: totalMembers })}
            </p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <form
            role="search"
            className="relative w-full sm:w-56"
            onSubmit={(event) => event.preventDefault()}
          >
            <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={memberSearch}
              onChange={(event) => onMemberSearchChange(event.target.value)}
              placeholder={t("org.searchPeople", {
                defaultValue: "Search people",
              })}
              aria-label={t("org.searchPeople", {
                defaultValue: "Search people",
              })}
              aria-controls="organization-member-list"
              autoComplete="off"
              className="h-8 w-full ps-8 text-xs"
            />
          </form>
          {canInvite && !showInviteForm && (
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              onClick={() => setShowInviteForm(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <IconUserPlus size={14} />
              {t("org.inviteMembers")}
            </Button>
          )}
        </div>
      </div>
      {canInvite && showInviteForm && (
        <div className="rounded-lg bg-card p-4">
          <BulkInviteForm
            currentUserRole={currentUserRole}
            appRoles={appRoles}
            onClose={() => setShowInviteForm(false)}
          />
        </div>
      )}
      {appRoles && (
        <div className="hidden grid-cols-[minmax(0,1fr)_auto_minmax(9rem,auto)_auto] items-center gap-x-3 px-5 pt-2 text-[11px] text-muted-foreground sm:grid">
          <span className="col-start-2 text-end">{t("org.role")}</span>
          <span className="min-w-36 text-start">
            {appRoles.label ?? t("org.appRolesOptional")}
          </span>
        </div>
      )}
      {canBulkSelect && members.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={allMembersSelected}
              onCheckedChange={(value) => {
                if (value === true) {
                  setSelectedEmails(
                    new Set(members.map((member) => member.email)),
                  );
                } else {
                  setSelectedEmails(new Set());
                }
              }}
              aria-label={t("org.selectPage", { defaultValue: "Select page" })}
            />
            <span className="text-xs text-muted-foreground">
              {selectedCount > 0
                ? t("org.selectedMembers", {
                    defaultValue: "{{count}} selected",
                    count: selectedCount,
                  })
                : t("org.selectMembers")}
            </span>
          </div>
          {selectedCount > 0 && canManageAppRoles ? (
            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    className="h-8 min-w-36 border-0 bg-background px-2 text-xs"
                  >
                    {bulkAppRoles.length
                      ? bulkAppRoles
                          .map((role) => appRoles?.roleLabels?.[role] ?? role)
                          .join(", ")
                      : t("org.notAssigned")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-0">
                  <Command>
                    <CommandList>
                      <CommandGroup>
                        {appRoles?.roles.map((role) => {
                          const checked = bulkAppRoles.includes(role);
                          return (
                            <CommandItem
                              key={role}
                              value={role}
                              className="gap-2"
                              onSelect={() =>
                                setBulkAppRoles(
                                  checked
                                    ? bulkAppRoles.filter(
                                        (item) => item !== role,
                                      )
                                    : [...bulkAppRoles, role],
                                )
                              }
                            >
                              <Checkbox checked={checked} />
                              <span>
                                {appRoles?.roleLabels?.[role] ?? role}
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                intent="primary"
                emphasis="solid"
                disabled={setAppMemberRoles.isPending}
                onClick={() => void applyBulkAppRoles()}
                className="h-8 px-2 text-xs"
              >
                {t("org.save")}
              </Button>
            </div>
          ) : null}
          {selectedCount > 0 && canManageGroups && groups.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                key={`add-${bulkActionKey}`}
                onValueChange={applyBulkAction}
                disabled={updateGroupMembers.isPending}
              >
                <SelectTrigger className="h-8 w-auto min-w-36 border-0 bg-background text-xs">
                  <SelectValue
                    placeholder={t("org.addToGroup", {
                      defaultValue: "Add to group",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={`add:${group.id}`}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                key={`remove-${bulkActionKey}`}
                onValueChange={applyBulkAction}
                disabled={updateGroupMembers.isPending}
              >
                <SelectTrigger className="h-8 w-auto min-w-36 border-0 bg-background text-xs">
                  <SelectValue
                    placeholder={t("org.removeFromGroup", {
                      defaultValue: "Remove from group",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={`remove:${group.id}`}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                onClick={() => setSelectedEmails(new Set())}
                className="text-xs text-muted-foreground"
              >
                {t("org.clearSelection", { defaultValue: "Clear" })}
              </Button>
            </div>
          ) : null}
          {selectedCount > 0 && canManageGroups && groups.length === 0 ? (
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              onClick={() => onCreateGroup(Array.from(selectedEmails))}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <IconPlus size={14} />
              {t("org.newGroup", { defaultValue: "New group" })}
            </Button>
          ) : null}
          <ErrorText error={updateGroupMembers.error} />
          <ErrorText error={setAppMemberRoles.error} />
        </div>
      ) : null}
      <div
        id="organization-member-list"
        className="space-y-1 pt-1"
        aria-busy={isFetchingMembers}
      >
        {membersError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card px-5 py-4"
          >
            <p className="text-sm text-destructive">
              {t("agentChat.share.loadPeopleFailed")}
            </p>
            <Button
              type="button"
              intent="neutral"
              emphasis="outline"
              disabled={isFetchingMembers}
              onClick={onRetryMembers}
              className="rounded-md border border-border px-3 py-1.5 text-xs"
            >
              {t("agentChat.common.retry")}
            </Button>
          </div>
        )}
        {isLoadingMembers && members.length === 0 ? (
          <div role="status" aria-busy="true" aria-label="Loading members">
            {["w-44", "w-56", "w-64"].map((nameWidth) => (
              <div
                key={nameWidth}
                className="flex items-center gap-3 px-5 py-4"
              >
                <Skeleton className="size-8 rounded-full bg-muted" />
                <div className="space-y-2">
                  <Skeleton className={cn("h-3.5 bg-muted", nameWidth)} />
                  <Skeleton className="h-3 w-20 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : members.length === 0 && visiblePendingInvites.length === 0 ? (
          !membersError && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {activeMemberSearch
                ? t("org.noPeopleFound", { defaultValue: "No people found" })
                : t("org.noMembers")}
            </div>
          )
        ) : (
          <>
            {members.map((m) => (
              <MemberRow
                key={m.email}
                email={m.email}
                role={m.role}
                name={m.name}
                image={m.image}
                isCurrentUser={m.email === currentUserEmail}
                currentUserRole={currentUserRole}
                currentUserEmail={currentUserEmail}
                appRoles={appRoles}
                appRole={appRoleByEmail.get(m.email.toLowerCase()) ?? []}
                canManageAppRoles={Boolean(appRoleData?.canManage)}
                transferCandidates={members}
                canSelect={canBulkSelect}
                selected={selectedEmails.has(m.email)}
                onSelect={(checked) => toggleSelected(m.email, checked)}
              />
            ))}
            {visiblePendingInvites.map((inv) => (
              <PendingInviteRow key={inv.id} invite={inv} />
            ))}
          </>
        )}
      </div>
      {appRoles && Object.keys(appRoles.permissions ?? {}).length > 0 && (
        <AppPermissionsPanel
          appRoles={appRoles}
          canManage={Boolean(appRoleData?.canManage)}
        />
      )}
      {totalMembers !== undefined && (memberOffset > 0 || hasNextPage) && (
        <MemberPagination
          memberOffset={memberOffset}
          totalMembers={totalMembers}
          hasNextPage={hasNextPage}
          nextMemberOffset={nextMemberOffset}
          isFetchingMembers={isFetchingMembers}
          onMemberPageChange={onMemberPageChange}
        />
      )}
    </section>
  );
}

export function MemberPagination({
  memberOffset,
  totalMembers,
  hasNextPage,
  nextMemberOffset,
  isFetchingMembers,
  onMemberPageChange,
}: {
  memberOffset: number;
  totalMembers: number;
  hasNextPage: boolean;
  nextMemberOffset: number | null;
  isFetchingMembers: boolean;
  onMemberPageChange: (offset: number) => void;
}) {
  const t = useT();
  const currentPage = Math.floor(memberOffset / ORG_MEMBER_PAGE_SIZE) + 1;
  const totalPages = Math.max(
    1,
    Math.ceil(totalMembers / ORG_MEMBER_PAGE_SIZE),
  );
  const canGoPrevious = memberOffset > 0 && !isFetchingMembers;
  const canGoNext =
    hasNextPage && nextMemberOffset !== null && !isFetchingMembers;

  return (
    <div className="mt-1 flex flex-col gap-3 rounded-lg bg-card px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t("org.memberPageStatus", {
          page: currentPage,
          totalPages,
        })}
      </p>
      <Pagination
        aria-label={t("org.memberPagination")}
        className="mx-0 w-auto justify-start sm:justify-end"
      >
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              size="sm"
              aria-label={t("org.previousMemberPage")}
              aria-disabled={!canGoPrevious}
              tabIndex={canGoPrevious ? undefined : -1}
              className={cn(!canGoPrevious && "pointer-events-none opacity-50")}
              onClick={(event) => {
                event.preventDefault();
                if (canGoPrevious) {
                  onMemberPageChange(
                    Math.max(0, memberOffset - ORG_MEMBER_PAGE_SIZE),
                  );
                }
              }}
            />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              href="#"
              size="sm"
              aria-label={t("org.nextMemberPage")}
              aria-disabled={!canGoNext}
              tabIndex={canGoNext ? undefined : -1}
              className={cn(!canGoNext && "pointer-events-none opacity-50")}
              onClick={(event) => {
                event.preventDefault();
                if (canGoNext && nextMemberOffset !== null) {
                  onMemberPageChange(nextMemberOffset);
                }
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

function roleLabel(role: string, t: ReturnType<typeof useT>) {
  if (role === "owner") return t("org.owner");
  if (role === "admin") return t("org.admin");
  return t("org.member");
}

function RoleBadge({ role }: { role: string }) {
  const t = useT();
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground">
      <RoleIcon role={role} />
      {roleLabel(role, t)}
    </span>
  );
}

function memberInitials(email: string): string {
  const localPart = email.split("@", 1)[0] ?? email;
  const initials = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "?";
}

function PendingInviteRow({ invite }: { invite: PendingInviteListItem }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 px-5 py-3.5 opacity-70 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-medium text-muted-foreground">
          {memberInitials(invite.email)}
        </div>
        <span className="min-w-0 truncate text-sm">{invite.email}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <RoleBadge role={invite.role} />
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t("org.invited")}
        </span>
      </div>
    </div>
  );
}

export function MemberRow({
  email,
  role,
  name,
  image,
  isCurrentUser,
  currentUserRole,
  currentUserEmail,
  appRoles,
  appRole,
  canManageAppRoles,
  transferCandidates = [],
  canSelect = false,
  selected = false,
  onSelect,
}: {
  email: string;
  role: OrgRole;
  name?: string | null;
  image?: string | null;
  isCurrentUser: boolean;
  currentUserRole: OrgRole | null;
  currentUserEmail?: string;
  appRoles?: AppRolesDescriptor;
  appRole?: string[];
  canManageAppRoles?: boolean;
  transferCandidates?: MemberListItem[];
  canSelect?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
}) {
  const t = useT();
  const removeMember = useRemoveMember();
  const changeRole = useChangeMemberRole();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [transferTo, setTransferTo] = useState(currentUserEmail ?? "");
  const transferOptions = useMemo(() => {
    const options = transferCandidates.filter(
      (candidate) => candidate.email.toLowerCase() !== email.toLowerCase(),
    );
    if (
      currentUserEmail &&
      !options.some(
        (candidate) =>
          candidate.email.toLowerCase() === currentUserEmail.toLowerCase(),
      )
    ) {
      options.unshift({ email: currentUserEmail, role: "member" });
    }
    return options;
  }, [currentUserEmail, email, transferCandidates]);
  const avatarUrl = image?.trim() || null;
  const displayName = name?.trim() || email;

  const canManage =
    role !== "owner" &&
    !isCurrentUser &&
    (currentUserRole === "owner" ||
      (currentUserRole === "admin" && role === "member"));
  const canChangeRole = canManage && currentUserRole === "owner";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg bg-card px-5 py-3.5 sm:items-center",
        appRoles
          ? "sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(9rem,auto)_auto] sm:gap-x-3"
          : "sm:flex-row",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {canSelect ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelect?.(value === true)}
            aria-label={`Select ${email}`}
          />
        ) : null}
        <Avatar className="size-8 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
          <AvatarFallback className="border border-border bg-background text-xs font-medium text-muted-foreground">
            {memberInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-sm">{displayName}</div>
          {displayName !== email ? (
            <div className="truncate text-xs text-muted-foreground">
              {email}
            </div>
          ) : null}
          {isCurrentUser && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("org.you")}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:contents">
        <div className="flex items-center gap-2 sm:justify-self-end">
          <RoleBadge role={role} />
        </div>
        {appRoles ? (
          <div className="flex min-w-36 items-center gap-1">
            <AppRoleControl
              email={email}
              appRoles={appRoles}
              assignedRoles={appRole ?? []}
              canManage={Boolean(canManageAppRoles)}
            />
          </div>
        ) : null}
        {canManage && (
          <div className="flex flex-wrap items-center justify-end gap-1 sm:justify-self-end">
            {canChangeRole && editing ? (
              <Select
                defaultOpen
                value={role}
                onOpenChange={(open) => {
                  if (!open) setEditing(false);
                }}
                onValueChange={(value) => {
                  const next = value === "admin" ? "admin" : "member";
                  if (next !== role) {
                    changeRole.mutate(
                      { email, role: next },
                      { onSuccess: () => setEditing(false) },
                    );
                  } else {
                    setEditing(false);
                  }
                }}
                disabled={changeRole.isPending}
              >
                <SelectTrigger
                  autoFocus
                  className="h-auto w-auto rounded-md border border-border bg-background px-2 py-1 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t("org.member")}</SelectItem>
                  <SelectItem value="admin">{t("org.admin")}</SelectItem>
                </SelectContent>
              </Select>
            ) : canChangeRole ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    aria-label={t("org.changeRole")}
                    onClick={() => setEditing(true)}
                    className="inline-flex size-8 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    <IconPencil size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("org.changeRole")}</TooltipContent>
              </Tooltip>
            ) : null}
            {confirmingRemove ? (
              <div className="flex flex-col items-end gap-1">
                <Select
                  value={transferTo || undefined}
                  onValueChange={setTransferTo}
                  disabled={
                    removeMember.isPending || transferOptions.length === 0
                  }
                >
                  <SelectTrigger
                    className="h-7 w-52 text-xs"
                    aria-label={t("org.transferTo")}
                  >
                    <SelectValue placeholder={t("org.transferTo")} />
                  </SelectTrigger>
                  <SelectContent>
                    {transferOptions.map((candidate) => (
                      <SelectItem key={candidate.email} value={candidate.email}>
                        {candidate.name?.trim() || candidate.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    intent="neutral"
                    emphasis="ghost"
                    onClick={() => setConfirmingRemove(false)}
                    className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {t("org.cancel")}
                  </Button>
                  <Button
                    type="button"
                    intent="danger"
                    emphasis="solid"
                    disabled={
                      removeMember.isPending ||
                      !transferOptions.some(
                        (candidate) =>
                          candidate.email.toLowerCase() ===
                          transferTo.trim().toLowerCase(),
                      ) ||
                      transferTo.trim().toLowerCase() === email.toLowerCase()
                    }
                    onClick={() =>
                      removeMember.mutate(
                        { email, transferTo: transferTo.trim() },
                        { onSettled: () => setConfirmingRemove(false) },
                      )
                    }
                    className="rounded bg-destructive px-1.5 py-0.5 text-[11px] text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {t("org.remove")}
                  </Button>
                </div>
                <ErrorText error={removeMember.error} />
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    intent="danger"
                    emphasis="ghost"
                    aria-label={t("org.removeMember")}
                    disabled={removeMember.isPending}
                    onClick={() => {
                      setTransferTo(currentUserEmail ?? "");
                      setConfirmingRemove(true);
                    }}
                    className="inline-flex size-8 items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <IconTrash size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("org.removeMember")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The members table for the active organization: search, invite, member rows,
 * pending invitations, pagination, and app-role controls.
 */
export function MembersSection({
  appRoles,
  groupEditor,
}: {
  appRoles?: AppRolesDescriptor;
  /**
   * Share one group editor with a `GroupsSection` on the same page. Without
   * it, this section opens its own.
   */
  groupEditor?: WorkspaceGroupEditorController;
}) {
  const { data: org } = useOrg();
  const [memberOffset, setMemberOffset] = useState(0);
  const [memberSearchInput, setMemberSearchInput] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const {
    data: membersData,
    isLoading: isLoadingMembers,
    isFetching: isFetchingMembers,
    isPlaceholderData: isPlaceholderMembers,
    error: membersError,
    refetch: refetchMembers,
  } = useOrgMembers(memberOffset, memberSearch);
  const { data: invitationsData } = useOrgInvitations();
  const isOwnerOrAdmin = org?.role === "owner" || org?.role === "admin";
  const groupsQuery = useWorkspaceUserGroups(isOwnerOrAdmin);
  const ownGroupEditor = useWorkspaceGroupEditor();
  const editor = groupEditor ?? ownGroupEditor;

  useEffect(() => {
    const nextSearch = memberSearchInput.trim().toLowerCase();
    if (nextSearch === memberSearch) return;

    const timer = window.setTimeout(
      () => {
        setMemberSearch(nextSearch);
        setMemberOffset(0);
      },
      nextSearch ? DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [memberSearch, memberSearchInput]);

  useEffect(() => {
    if (
      memberOffset > 0 &&
      membersData &&
      !isLoadingMembers &&
      !isFetchingMembers &&
      !isPlaceholderMembers &&
      !membersError &&
      membersData.members.length === 0
    ) {
      setMemberOffset((currentOffset) =>
        Math.max(0, currentOffset - ORG_MEMBER_PAGE_SIZE),
      );
    }
  }, [
    isFetchingMembers,
    isLoadingMembers,
    isPlaceholderMembers,
    memberOffset,
    membersData,
    membersError,
  ]);

  if (!org?.orgId) return null;

  return (
    <SectionTooltipProvider>
      <MembersTableCard
        members={membersData?.members ?? []}
        totalMembers={membersData?.totalCount}
        pendingInvites={invitationsData?.invitations ?? []}
        isLoadingMembers={isLoadingMembers}
        isFetchingMembers={isFetchingMembers}
        membersError={membersError}
        onRetryMembers={() => void refetchMembers()}
        currentUserEmail={org.email}
        currentUserRole={org.role ?? null}
        emailConfigured={org.emailConfigured}
        appRoles={appRoles}
        groups={groupsQuery.data ?? []}
        canManageGroups={isOwnerOrAdmin}
        memberOffset={memberOffset}
        memberSearch={memberSearchInput}
        activeMemberSearch={memberSearch}
        hasNextPage={membersData?.hasMore === true}
        nextMemberOffset={membersData?.nextOffset ?? null}
        onMemberPageChange={setMemberOffset}
        onMemberSearchChange={setMemberSearchInput}
        onCreateGroup={(memberEmails) =>
          editor.openGroupEditor(null, memberEmails)
        }
      />
      {!groupEditor && isOwnerOrAdmin ? (
        <WorkspaceGroupEditor {...editor.dialogProps} />
      ) : null}
    </SectionTooltipProvider>
  );
}
