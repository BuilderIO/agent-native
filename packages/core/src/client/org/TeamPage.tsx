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
  AlertDialogTrigger,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
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
import { Switch } from "@agent-native/toolkit/ui/switch";
import {
  IconUserPlus,
  IconTrash,
  IconCrown,
  IconShieldCheck,
  IconLoader2,
  IconCheck,
  IconPencil,
  IconAt,
  IconX,
  IconKey,
  IconCopy,
  IconRefresh,
  IconEye,
  IconEyeOff,
  IconCloudUpload,
  IconFileImport,
  IconPlus,
  IconAlertTriangle,
  IconUsersGroup,
  IconHelpCircle,
  IconExternalLink,
  IconSearch,
} from "@tabler/icons-react";
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

// Type-only: erased at build time, so declaring app roles pulls no server or
// database code into the browser bundle.
import type { AppRolesDescriptor } from "../../org/app-roles.js";
import type { DomainMatchOrg } from "../../org/types.js";
import { docsUrl } from "../../shared/docs-url.js";
import type { WorkspaceUserGroup } from "../../workspace-connections/groups.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { useShareOrgMemberSearch } from "../sharing/share-controller-helpers.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { cn } from "../utils.js";
import {
  useOrg,
  useOrgMembers,
  useOrgInvitations,
  useCreateOrg,
  useUpdateOrg,
  useBulkInviteMembers,
  useChangeMemberRole,
  useAcceptInvitation,
  useRemoveMember,
  useDeleteOrg,
  useSwitchOrg,
  useSetOrgDomain,
  useSetWorkspaceAppDefaultVisibility,
  useSetOrgWorkspaceUrl,
  useSetOrgAuthProvider,
  useRevealA2ASecret,
  useSetA2ASecret,
  useSyncA2ASecret,
  useJoinByDomain,
  useAppRoles,
  useSetAppMemberRole,
  ORG_MEMBER_PAGE_SIZE,
  type InviteRole,
  type SyncA2ASecretResult,
} from "./hooks.js";

const Button = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof ToolkitButton>
>(({ className, ...props }, ref) => (
  <ToolkitButton
    ref={ref}
    variant="ghost"
    className={cn(
      "h-auto p-0 hover:bg-transparent hover:text-inherit active:scale-100 [&_svg]:!size-auto",
      className,
    )}
    {...props}
  />
));
Button.displayName = "TeamPrimitiveButton";

export interface TeamPageProps {
  /**
   * Optional wrapper around the page contents. Templates pass their own Layout
   * component so the Team page renders inside the template's chrome.
   */
  layout?: (children: ReactNode) => ReactNode;
  /**
   * Title shown at the top of the page. Defaults to "Team".
   */
  title?: string;
  /**
   * Hide the page title when this is rendered inside another titled surface,
   * such as the Settings > Team tab.
   */
  showTitle?: boolean;
  /**
   * Description shown on the "Create an Organization" card. Defaults to
   * "Set up a team to collaborate with your colleagues."
   */
  createOrgDescription?: string;
  /**
   * Class applied to the outer max-width container. Templates can use this to
   * tweak page width.
   */
  className?: string;
  /**
   * Opt in to an app-role column on the members table, using the same
   * descriptor the app passes to `defineAppRoles`. Pass it explicitly rather
   * than letting the page discover registered apps: a workspace can host
   * several, and a members table that silently grows a column when some
   * unrelated module registers itself is a surprise, not a feature.
   *
   * Only org owners/admins can change assignments; everyone else sees the
   * column read-only.
   */
  appRoles?: AppRolesDescriptor;
}

function RoleIcon({ role }: { role: string }) {
  if (role === "owner")
    return <IconCrown className="h-3.5 w-3.5 text-primary" />;
  if (role === "admin")
    return <IconShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />;
  return null;
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="text-xs text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

function OrganizationHelpIcon({
  content,
  docsUrl,
}: {
  content: string;
  docsUrl?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-label="More information"
          className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:!size-3"
        >
          <IconHelpCircle className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-5">
        <p>{content}</p>
        {docsUrl ? (
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block underline underline-offset-2"
          >
            Learn more
          </a>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function OrganizationDescription({
  children,
  help,
  docsUrl,
}: {
  children: ReactNode;
  help?: string;
  docsUrl?: string;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span>{children}</span>
      {help ? <OrganizationHelpIcon content={help} docsUrl={docsUrl} /> : null}
    </span>
  );
}

function PendingInvitationsCard() {
  const t = useT();
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();

  if (!org?.pendingInvitations?.length) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.pendingInvitations")}</h3>
      {org.pendingInvitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded-md border border-border p-3"
        >
          <div>
            <div className="text-sm font-medium">{inv.orgName}</div>
            <div className="text-xs text-muted-foreground">
              {t("org.invitedByLabel", { name: inv.invitedBy })}
            </div>
          </div>
          <Button
            type="button"
            intent="primary"
            emphasis="solid"
            onClick={() => acceptInvitation.mutate(inv.id)}
            disabled={acceptInvitation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {acceptInvitation.isPending ? (
              <IconLoader2 size={14} className="animate-spin" />
            ) : (
              t("org.accept")
            )}
          </Button>
        </div>
      ))}
      <ErrorText error={acceptInvitation.error} />
    </section>
  );
}

function JoinByDomainCard({ matches }: { matches: DomainMatchOrg[] }) {
  const t = useT();
  const joinByDomain = useJoinByDomain();
  const [pendingId, setPendingId] = useState<string | null>(null);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.joinYourTeam")}</h3>
      <p className="text-sm text-muted-foreground">
        {matches.length === 1
          ? t("org.joinDomainOne")
          : t("org.joinDomainMany")}
      </p>
      <div className="space-y-2">
        {matches.map((m) => (
          <div
            key={m.orgId}
            className="flex items-center justify-between rounded-md border border-border p-3"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <IconUsersGroup className="h-4 w-4 text-primary" />
              </div>
              <div className="text-sm font-medium">{m.orgName}</div>
            </div>
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              disabled={joinByDomain.isPending && pendingId === m.orgId}
              onClick={() => {
                setPendingId(m.orgId);
                joinByDomain.mutate(m.orgId, {
                  onSettled: () => setPendingId(null),
                });
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {joinByDomain.isPending && pendingId === m.orgId ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                t("org.join")
              )}
            </Button>
          </div>
        ))}
      </div>
      <ErrorText error={joinByDomain.error} />
    </section>
  );
}

function CreateOrgCard({ description }: { description?: string }) {
  const t = useT();
  const createOrg = useCreateOrg();
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.createOrgCardTitle")}</h3>
      <p className="text-sm text-muted-foreground">
        {description || t("org.createOrgCardDescription")}
      </p>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <IconKey className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t("org.createOrgVaultNotice")}</span>
      </p>
      {!showForm ? (
        <Button
          type="button"
          intent="primary"
          emphasis="solid"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("org.createOrganization")}
        </Button>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Inc."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              disabled={!name.trim() || createOrg.isPending}
              onClick={() =>
                createOrg.mutate(name.trim(), {
                  onSuccess: () => {
                    setName("");
                    setShowForm(false);
                  },
                })
              }
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createOrg.isPending ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                t("org.create")
              )}
            </Button>
            <Button
              type="button"
              intent="neutral"
              emphasis="outline"
              onClick={() => {
                setShowForm(false);
                setName("");
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {t("org.cancel")}
            </Button>
          </div>
          <ErrorText error={createOrg.error} />
        </div>
      )}
    </section>
  );
}

function OrgNameDisplay({ name, canEdit }: { name: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const updateOrg = useUpdateOrg();

  if (!canEdit) return <div className="text-sm font-medium">{name}</div>;

  if (!editing) {
    return (
      <Button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        className="group flex items-center gap-1.5 text-sm font-medium hover:text-foreground/80"
      >
        {name}
        <IconPencil
          size={12}
          className="text-muted-foreground opacity-0 group-hover:opacity-100"
        />
      </Button>
    );
  }

  function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    updateOrg.mutate(trimmed, { onSuccess: () => setEditing(false) });
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={save}
        className="rounded border border-border bg-background px-1.5 py-0.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-foreground"
        autoFocus
      />
      <ErrorText error={updateOrg.error} />
    </div>
  );
}

interface MemberListItem {
  email: string;
  role: string;
}

interface PendingInviteListItem {
  id: string;
  email: string;
  role: string;
}

function WorkspaceGroupEditor({
  open,
  group,
  onClose,
}: {
  open: boolean;
  group: WorkspaceUserGroup | null;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const memberSearch = useShareOrgMemberSearch(search, open, { limit: 100 });
  const saveGroup = useActionMutation("upsert-workspace-user-group");
  const selected = useMemo(
    () => new Set(members.map((email) => email.toLowerCase())),
    [members],
  );

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setMembers(group?.memberEmails ?? []);
    setSearch("");
  }, [group, open]);

  const searchMembers = memberSearch.members.map((member) => ({
    email: member.email.toLowerCase(),
    name: member.name,
  }));
  const selectedMembersNotInSearch = members
    .map((email) => email.toLowerCase())
    .filter((email) => !searchMembers.some((member) => member.email === email))
    .map((email) => ({ email, name: undefined }));
  const visibleMembers = [...selectedMembersNotInSearch, ...searchMembers];

  function toggleMember(email: string, checked: boolean) {
    const normalized = email.trim().toLowerCase();
    setMembers((current) =>
      checked
        ? Array.from(new Set([...current, normalized]))
        : current.filter((value) => value !== normalized),
    );
  }

  function save() {
    const trimmedName = name.trim();
    if (!trimmedName || saveGroup.isPending) return;
    saveGroup.mutate(
      {
        ...(group?.id ? { id: group.id } : {}),
        name: trimmedName,
        memberEmails: members,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saveGroup.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {group
              ? t("org.editGroup", { defaultValue: "Edit group" })
              : t("org.createGroup", { defaultValue: "Create group" })}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label
              htmlFor="workspace-group-name"
              className="text-xs font-medium"
            >
              {t("org.groupName", { defaultValue: "Group name" })}
            </label>
            <Input
              id="workspace-group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Rev Ops"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium">
                {t("org.groupMembers", { defaultValue: "People" })}
              </span>
              <span className="text-xs text-muted-foreground">
                {members.length}
              </span>
            </div>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("org.searchPeople", {
                  defaultValue: "Search people",
                })}
                aria-label={t("org.searchPeople", {
                  defaultValue: "Search people",
                })}
                className="ps-9"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md bg-muted/30 p-1">
              {memberSearch.isLoading ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {t("org.loadingPeople", { defaultValue: "Loading people…" })}
                </div>
              ) : visibleMembers.length > 0 ? (
                visibleMembers.map((member) => (
                  <label
                    key={member.email}
                    htmlFor={`workspace-group-member-${member.email}`}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 hover:bg-background"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {member.name || member.email}
                    </span>
                    <Checkbox
                      id={`workspace-group-member-${member.email}`}
                      checked={selected.has(member.email)}
                      onCheckedChange={(value) =>
                        toggleMember(member.email, value === true)
                      }
                      aria-label={member.email}
                    />
                  </label>
                ))
              ) : (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {t("org.noPeopleFound", { defaultValue: "No people found" })}
                </div>
              )}
            </div>
            {memberSearch.hasMore ? (
              <Button
                type="button"
                onClick={memberSearch.loadMore}
                disabled={memberSearch.isLoadingMore}
                className="w-fit text-xs text-muted-foreground"
              >
                {t("org.loadMorePeople", { defaultValue: "Load more" })}
              </Button>
            ) : null}
          </div>
          <ErrorText
            error={
              memberSearch.error ? new Error("Could not load people.") : null
            }
          />
          <ErrorText error={saveGroup.error} />
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={onClose}
            className="text-muted-foreground"
          >
            {t("org.cancel")}
          </Button>
          <Button
            type="button"
            intent="primary"
            emphasis="solid"
            disabled={!name.trim() || saveGroup.isPending}
            onClick={save}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saveGroup.isPending ? (
              <IconLoader2 size={14} className="animate-spin" />
            ) : (
              t("org.saveGroup", { defaultValue: "Save group" })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceGroupsCard({ groups }: { groups: WorkspaceUserGroup[] }) {
  const t = useT();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<WorkspaceUserGroup | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const deleteGroup = useActionMutation("delete-workspace-user-group");

  function openEditor(group: WorkspaceUserGroup | null) {
    setEditingGroup(group);
    setEditorOpen(true);
  }

  return (
    <section className="overflow-hidden rounded-xl bg-card text-card-foreground">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <h3 className="text-sm font-medium">
          {t("org.groups", { defaultValue: "Groups" })}
        </h3>
        <Button
          type="button"
          intent="primary"
          emphasis="solid"
          onClick={() => openEditor(null)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <IconPlus size={14} />
          {t("org.newGroup", { defaultValue: "New group" })}
        </Button>
      </div>
      <div className="grid gap-1 px-3 pb-3">
        {groups.length > 0 ? (
          groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-3 rounded-lg bg-muted/35 px-3 py-2.5"
            >
              <IconUsersGroup className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {group.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {group.memberEmails.length}
              </span>
              <Button
                type="button"
                onClick={() => openEditor(group)}
                aria-label={t("org.editGroupAria", {
                  defaultValue: "Edit group {{name}}",
                  name: group.name,
                })}
                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <IconPencil size={14} />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    intent="danger"
                    emphasis="ghost"
                    aria-label={t("org.deleteGroupAria", {
                      defaultValue: "Delete group {{name}}",
                      name: group.name,
                    })}
                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                  >
                    <IconTrash size={14} />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("org.deleteGroup", { defaultValue: "Delete group?" })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("org.deleteGroupConfirm", {
                        defaultValue:
                          "People will keep their workspace access, but this group can no longer be used for connection access.",
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <ErrorText error={deleteError} />
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("org.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={deleteGroup.isPending}
                      onClick={() => {
                        setDeleteError(null);
                        deleteGroup.mutate(
                          { id: group.id },
                          {
                            onError: setDeleteError,
                          },
                        );
                      }}
                    >
                      {deleteGroup.isPending
                        ? t("org.deleting", { defaultValue: "Deleting…" })
                        : t("org.delete", { defaultValue: "Delete" })}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))
        ) : (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {t("org.noGroups", { defaultValue: "No groups yet" })}
          </p>
        )}
        <ErrorText error={deleteError} />
      </div>
      <WorkspaceGroupEditor
        open={editorOpen}
        group={editingGroup}
        onClose={() => {
          setEditorOpen(false);
          setEditingGroup(null);
        }}
      />
    </section>
  );
}

function MembersCard({ appRoles }: { appRoles?: AppRolesDescriptor }) {
  const t = useT();
  const { data: org } = useOrg();
  const [memberOffset, setMemberOffset] = useState(0);
  const {
    data: membersData,
    isLoading: isLoadingMembers,
    isFetching: isFetchingMembers,
    isPlaceholderData: isPlaceholderMembers,
  } = useOrgMembers(memberOffset);
  const { data: invitationsData } = useOrgInvitations();
  const switchOrg = useSwitchOrg();
  const isOwnerOrAdmin = org?.role === "owner" || org?.role === "admin";
  const groupsQuery = useActionQuery<WorkspaceUserGroup[]>(
    "list-workspace-user-groups",
    {},
    { enabled: isOwnerOrAdmin },
  );

  useEffect(() => {
    setMemberOffset(0);
  }, [org?.orgId]);

  useEffect(() => {
    if (
      memberOffset > 0 &&
      membersData &&
      !isLoadingMembers &&
      !isFetchingMembers &&
      !isPlaceholderMembers &&
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
  ]);

  if (!org?.orgId) return null;

  const isOwner = org.role === "owner";
  const members = membersData?.members ?? [];
  const totalMembers = membersData?.totalCount ?? 0;
  const pendingInvites = invitationsData?.invitations ?? [];
  const hasMultipleOrgs = (org.orgs?.length ?? 0) > 1;

  return (
    <div className="space-y-6">
      <SettingsGroup title="Organization">
        <SettingsRow
          id="organization"
          label={
            <span className="flex items-center gap-2">
              <IconUsersGroup className="size-4 text-muted-foreground" />
              <OrgNameDisplay
                name={org.orgName ?? ""}
                canEdit={isOwnerOrAdmin}
              />
            </span>
          }
          description={`${t("org.memberCount", { count: totalMembers })} · ${t("org.youAreRole", { role: org.role })}`}
          control={
            hasMultipleOrgs ? (
              <Select
                value={org.orgId ?? ""}
                onValueChange={(value) => switchOrg.mutate(value || null)}
                disabled={switchOrg.isPending}
              >
                <SelectTrigger className="h-auto w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs sm:w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {org.orgs.map((o) => (
                    <SelectItem key={o.orgId} value={o.orgId}>
                      {o.orgName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : undefined
          }
        />

        {isOwnerOrAdmin && (
          <>
            <DomainSettingsSection
              domain={org.allowedDomain}
              ownerEmail={org.email}
            />
            <WorkspaceAppPrivacySettingsSection
              visibility={org.workspaceAppDefaultVisibility ?? "org"}
            />
            <WorkspaceUrlSettingsSection workspaceUrl={org.workspaceUrl} />
            <AuthProviderSettingsSection
              requiredAuthProvider={org.requiredAuthProvider}
            />
            {isOwner && <A2ASecretSection isSet={Boolean(org.a2aSecretSet)} />}
          </>
        )}

        {switchOrg.error && (
          <div className="px-5 pb-4">
            <ErrorText error={switchOrg.error} />
          </div>
        )}
      </SettingsGroup>

      <MembersTableCard
        members={members}
        totalMembers={totalMembers}
        pendingInvites={pendingInvites}
        isLoadingMembers={isLoadingMembers}
        isFetchingMembers={isFetchingMembers}
        currentUserEmail={org.email}
        currentUserRole={org.role ?? null}
        appRoles={appRoles}
        groups={groupsQuery.data ?? []}
        canManageGroups={isOwnerOrAdmin}
        memberOffset={memberOffset}
        hasNextPage={membersData?.hasMore === true}
        nextMemberOffset={membersData?.nextOffset ?? null}
        onMemberPageChange={setMemberOffset}
      />

      {isOwnerOrAdmin && (
        <WorkspaceGroupsCard groups={groupsQuery.data ?? []} />
      )}

      {isOwner && <DangerZoneCard orgName={org.orgName ?? ""} />}
    </div>
  );
}

function WorkspaceAppPrivacySettingsSection({
  visibility,
}: {
  visibility: "private" | "org";
}) {
  const t = useT();
  const setDefault = useSetWorkspaceAppDefaultVisibility();
  return (
    <SettingsRow
      id="workspace-app-default-visibility"
      label="New app privacy"
      description="Choose whether new workspace apps start private to their creator or visible to the organization."
      control={
        <Select
          value={visibility}
          onValueChange={(value) =>
            setDefault.mutate(value === "private" ? "private" : "org")
          }
          disabled={setDefault.isPending}
        >
          <SelectTrigger className="h-auto w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs sm:w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="org">
              {t("org.workspaceAppsOrganization", {
                defaultValue: "Organization",
              })}
            </SelectItem>
            <SelectItem value="private">
              {t("org.workspaceAppsCreatorOnly", {
                defaultValue: "Creator only",
              })}
            </SelectItem>
          </SelectContent>
        </Select>
      }
    />
  );
}

function MembersTableCard({
  members,
  totalMembers,
  pendingInvites,
  isLoadingMembers,
  isFetchingMembers,
  currentUserEmail,
  currentUserRole,
  appRoles,
  groups,
  canManageGroups,
  memberOffset,
  hasNextPage,
  nextMemberOffset,
  onMemberPageChange,
}: {
  members: MemberListItem[];
  totalMembers: number;
  pendingInvites: PendingInviteListItem[];
  isLoadingMembers: boolean;
  isFetchingMembers: boolean;
  currentUserEmail: string;
  currentUserRole: string | null;
  appRoles?: AppRolesDescriptor;
  groups: WorkspaceUserGroup[];
  canManageGroups: boolean;
  memberOffset: number;
  hasNextPage: boolean;
  nextMemberOffset: number | null;
  onMemberPageChange: (offset: number) => void;
}) {
  const t = useT();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkActionKey, setBulkActionKey] = useState(0);
  const canInvite = currentUserRole === "owner" || currentUserRole === "admin";
  const updateGroupMembers = useActionMutation(
    "bulk-update-workspace-user-groups",
  );
  const { data: appRoleData } = useAppRoles(appRoles?.appId);
  const appRoleByEmail = new Map(
    (appRoleData?.assignments ?? []).map((a) => [
      a.email.toLowerCase(),
      a.role,
    ]),
  );
  const selectedCount = selectedEmails.size;
  const allMembersSelected =
    members.length > 0 &&
    members.every((member) => selectedEmails.has(member.email));

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

  return (
    <section className="overflow-hidden rounded-xl bg-muted/20 p-1 text-card-foreground">
      <div className="flex flex-col gap-3 rounded-lg bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">{t("org.members")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("org.memberCount", { count: totalMembers })}
            {appRoles
              ? ` · ${appRoles.label ?? appRoles.appId} can be assigned here`
              : ""}
          </p>
        </div>
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
      {canInvite && showInviteForm && (
        <div className="rounded-lg bg-card p-4">
          <BulkInviteForm
            currentUserRole={currentUserRole}
            onClose={() => setShowInviteForm(false)}
          />
        </div>
      )}
      {canManageGroups && members.length > 0 ? (
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
                : t("org.selectMembers", {
                    defaultValue: "Select people to edit groups",
                  })}
            </span>
          </div>
          {selectedCount > 0 && groups.length > 0 ? (
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
          {selectedCount > 0 && groups.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {t("org.createGroupForBulk", {
                defaultValue: "Create a group below first",
              })}
            </span>
          ) : null}
          <ErrorText error={updateGroupMembers.error} />
        </div>
      ) : null}
      <div className="space-y-1 pt-1">
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
        ) : members.length === 0 && pendingInvites.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            {t("org.noMembers")}
          </div>
        ) : (
          <>
            {members.map((m) => (
              <MemberRow
                key={m.email}
                email={m.email}
                role={m.role}
                isCurrentUser={m.email === currentUserEmail}
                currentUserRole={currentUserRole}
                appRoles={appRoles}
                appRole={appRoleByEmail.get(m.email.toLowerCase()) ?? null}
                canManageAppRoles={Boolean(appRoleData?.canManage)}
                canSelect={canManageGroups}
                selected={selectedEmails.has(m.email)}
                onSelect={(checked) => toggleSelected(m.email, checked)}
              />
            ))}
            {pendingInvites.map((inv) => (
              <PendingInviteRow key={inv.id} invite={inv} />
            ))}
          </>
        )}
      </div>
      {(memberOffset > 0 || hasNextPage) && (
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

function MemberPagination({
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
              aria-label={t("org.previousMemberPage")}
              aria-disabled={!canGoPrevious}
              tabIndex={canGoPrevious ? undefined : -1}
              className={cn(
                "text-xs",
                !canGoPrevious && "pointer-events-none opacity-50",
              )}
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
              aria-label={t("org.nextMemberPage")}
              aria-disabled={!canGoNext}
              tabIndex={canGoNext ? undefined : -1}
              className={cn(
                "text-xs",
                !canGoNext && "pointer-events-none opacity-50",
              )}
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

function DangerZoneCard({ orgName }: { orgName: string }) {
  const t = useT();
  const deleteOrg = useDeleteOrg();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const canConfirm =
    confirmText.trim().toLowerCase() === orgName.trim().toLowerCase();

  function handleConfirm(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!canConfirm || deleteOrg.isPending) return;
    deleteOrg.mutate(orgName, { onSuccess: () => setOpen(false) });
  }

  return (
    <section className="rounded-lg border border-destructive/40 bg-card p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-destructive">
              {t("org.dangerZone")}
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              <OrganizationDescription help={t("org.deleteOrgDescription")}>
                Delete this organization and all of its members.
              </OrganizationDescription>
            </p>
          </div>
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setConfirmText("");
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                intent="danger"
                emphasis="outline"
                className="cursor-pointer rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                {t("org.deleteOrg")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("org.deleteOrg")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("org.deleteOrgConfirmPrompt", { name: orgName })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={t("org.deleteOrgConfirmPlaceholder")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-destructive"
                autoFocus
              />
              <ErrorText error={deleteOrg.error} />
              <AlertDialogFooter>
                <AlertDialogCancel className="cursor-pointer">
                  {t("org.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={!canConfirm || deleteOrg.isPending}
                  onClick={handleConfirm}
                  className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleteOrg.isPending ? (
                    <span className="inline-flex items-center gap-1.5">
                      <IconLoader2 size={14} className="animate-spin" />
                      {t("org.deleteOrgPending")}
                    </span>
                  ) : (
                    t("org.deleteOrgConfirmCta")
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </section>
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
    <span className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground">
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

/** Sentinel for "clear the assignment" — Select cannot carry an empty value. */
const UNASSIGNED = "__unassigned__";

function AppRoleControl({
  email,
  appRoles,
  appRole,
  canManage,
}: {
  email: string;
  appRoles: AppRolesDescriptor;
  appRole: string | null;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const setAppRole = useSetAppMemberRole(appRoles.appId);
  const labelFor = (r: string) => appRoles.roleLabels?.[r] ?? r;

  if (editing) {
    return (
      <Select
        defaultOpen
        value={appRole ?? UNASSIGNED}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
        onValueChange={(value) => {
          const next = value === UNASSIGNED ? null : value;
          if (next === appRole) {
            setEditing(false);
            return;
          }
          setAppRole.mutate(
            { email, role: next },
            { onSuccess: () => setEditing(false) },
          );
        }}
        disabled={setAppRole.isPending}
      >
        <SelectTrigger
          autoFocus
          className="h-auto w-auto rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>
            {appRoles.defaultRole
              ? labelFor(appRoles.defaultRole)
              : "Not assigned"}
          </SelectItem>
          {appRoles.roles.map((r) => (
            <SelectItem key={r} value={r}>
              {labelFor(r)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // An unassigned member shows the app's default only as a hint. The default
  // never satisfies a server guard, so it must not read as a granted role.
  const display = appRole ? (
    <span className="inline-flex items-center rounded border border-border px-2 py-1 text-xs text-muted-foreground">
      {labelFor(appRole)}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground/70">
      {appRoles.defaultRole ? labelFor(appRoles.defaultRole) : "Not assigned"}
    </span>
  );

  return canManage ? (
    <Button
      type="button"
      onClick={() => setEditing(true)}
      className="cursor-pointer rounded hover:opacity-80"
    >
      {display}
    </Button>
  ) : (
    display
  );
}

function MemberRow({
  email,
  role,
  isCurrentUser,
  currentUserRole,
  appRoles,
  appRole,
  canManageAppRoles,
  canSelect = false,
  selected = false,
  onSelect,
}: {
  email: string;
  role: string;
  isCurrentUser: boolean;
  currentUserRole: string | null;
  appRoles?: AppRolesDescriptor;
  appRole?: string | null;
  canManageAppRoles?: boolean;
  canSelect?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
}) {
  const t = useT();
  const removeMember = useRemoveMember();
  const changeRole = useChangeMemberRole();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Owners can manage admins + members. Admins can only manage members.
  // Owners themselves are immutable through this UI; current user can't
  // edit their own role here.
  const canManage =
    role !== "owner" &&
    !isCurrentUser &&
    (currentUserRole === "owner" ||
      (currentUserRole === "admin" && role === "member"));

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-card px-5 py-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {canSelect ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelect?.(value === true)}
            aria-label={`Select ${email}`}
          />
        ) : null}
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-medium text-muted-foreground">
          {memberInitials(email)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm">{email}</div>
          {isCurrentUser && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("org.you")}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <RoleBadge role={role} />
        {appRoles && (
          <AppRoleControl
            email={email}
            appRoles={appRoles}
            appRole={appRole ?? null}
            canManage={Boolean(canManageAppRoles)}
          />
        )}
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            {editing ? (
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
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <IconPencil size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("org.changeRole")}</TooltipContent>
              </Tooltip>
            )}
            {confirmingRemove ? (
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
                  disabled={removeMember.isPending}
                  onClick={() =>
                    removeMember.mutate(email, {
                      onSettled: () => setConfirmingRemove(false),
                    })
                  }
                  className="rounded bg-destructive px-1.5 py-0.5 text-[11px] text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  {t("org.remove")}
                </Button>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    intent="danger"
                    emphasis="ghost"
                    disabled={removeMember.isPending}
                    onClick={() => setConfirmingRemove(true)}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
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

interface DraftInvite {
  email: string;
  role: InviteRole;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function parseCsvEmails(text: string): string[] {
  // Tolerant CSV parse — split on lines, then on commas, take any cell
  // that looks like an email. Handles "name,email,role" rows or just
  // "email" per line. A robust full CSV parser would be overkill here.
  const cells: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const cell of line.split(",")) {
      const trimmed = cell.trim().replace(/^"|"$/g, "");
      if (trimmed) cells.push(trimmed);
    }
  }
  return Array.from(
    new Set(cells.filter((c) => EMAIL_RE.test(c)).map((c) => c.toLowerCase())),
  );
}

function BulkInviteForm({
  currentUserRole,
  onClose,
}: {
  currentUserRole: string | null;
  onClose: () => void;
}) {
  const bulkInvite = useBulkInviteMembers();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<DraftInvite[]>([
    { email: "", role: "member" },
  ]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteRole, setPasteRole] = useState<InviteRole>("member");
  const [resultBanner, setResultBanner] = useState<{
    succeeded: number;
    failed: { email: string; error: string }[];
  } | null>(null);

  const canSetAdmin = currentUserRole === "owner";

  const validDrafts = useMemo(
    () =>
      drafts
        .map((d) => ({ ...d, email: d.email.trim().toLowerCase() }))
        .filter((d) => EMAIL_RE.test(d.email)),
    [drafts],
  );

  function setDraft(index: number, patch: Partial<DraftInvite>) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }

  function appendEmails(emails: string[], role: InviteRole) {
    if (!emails.length) return;
    setDrafts((prev) => {
      const existing = new Set(
        prev.map((d) => d.email.trim().toLowerCase()).filter(Boolean),
      );
      const fresh: DraftInvite[] = [];
      for (const e of emails) {
        if (!existing.has(e)) {
          fresh.push({ email: e, role });
          existing.add(e);
        }
      }
      // If the only existing row is an empty placeholder, drop it.
      const cleaned = prev.filter(
        (d, i) => !(i === 0 && !d.email.trim() && prev.length === 1),
      );
      return [...cleaned, ...fresh];
    });
  }

  function handleFile(file: File) {
    file.text().then((text) => {
      const emails = parseCsvEmails(text);
      if (emails.length) {
        appendEmails(emails, "member");
      } else {
        setResultBanner({
          succeeded: 0,
          failed: [{ email: file.name, error: "No valid emails found in CSV" }],
        });
      }
    });
  }

  async function submit() {
    setResultBanner(null);
    const dedup = new Map<string, DraftInvite>();
    for (const d of validDrafts) {
      // canSetAdmin guard mirrors server-side enforcement so an admin-only
      // user editing the form can't even attempt to grant admin (they'd
      // get a 403 anyway).
      const role = canSetAdmin ? d.role : "member";
      dedup.set(d.email, { ...d, role });
    }
    const invites = Array.from(dedup.values());
    if (invites.length === 0) return;

    const result = await bulkInvite.mutateAsync(invites);
    setResultBanner({
      succeeded: result.succeeded.length,
      failed: result.failed,
    });

    // Wipe drafts that succeeded; leave failed ones so the user can fix
    // and retry. If everything succeeded, reset to a single blank row.
    const failedEmails = new Set(result.failed.map((f) => f.email));
    setDrafts((prev) => {
      const remaining = prev.filter((d) =>
        failedEmails.has(d.email.trim().toLowerCase()),
      );
      return remaining.length > 0 ? remaining : [{ email: "", role: "member" }];
    });

    // Auto-close on full success.
    if (result.failed.length === 0 && result.succeeded.length > 0) {
      setTimeout(() => onClose(), 1200);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {drafts.map((draft, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="email"
              value={draft.email}
              onChange={(e) => setDraft(i, { email: e.target.value })}
              placeholder="colleague@company.com"
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              autoFocus={i === drafts.length - 1}
            />
            <Select
              value={draft.role}
              onValueChange={(value) =>
                setDraft(i, {
                  role: value === "admin" ? "admin" : "member",
                })
              }
              disabled={!canSetAdmin}
            >
              <SelectTrigger
                title={
                  canSetAdmin
                    ? undefined
                    : "Only the organization owner can invite admins"
                }
                className="h-auto w-auto rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            {drafts.length > 1 && (
              <Button
                type="button"
                onClick={() =>
                  setDrafts((prev) => prev.filter((_, j) => j !== i))
                }
                className="text-muted-foreground hover:text-destructive"
              >
                <IconX size={14} />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          intent="neutral"
          emphasis="outline"
          onClick={() =>
            setDrafts((prev) => [...prev, { email: "", role: "member" }])
          }
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconPlus size={14} />
          Add another
        </Button>
        <Button
          type="button"
          intent="neutral"
          emphasis="outline"
          onClick={() => setPasteOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconUserPlus size={14} />
          Paste many
        </Button>
        <Button
          type="button"
          intent="neutral"
          emphasis="outline"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
        >
          <IconFileImport size={14} />
          Import CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // reset so re-uploading the same file re-fires onChange
            e.target.value = "";
          }}
        />
      </div>

      {pasteOpen && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Paste emails (comma, space, or newline separated)
          </div>
          <textarea
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            rows={4}
            placeholder="alice@acme.com, bob@acme.com&#10;charlie@acme.com"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
          />
          <div className="flex items-center gap-2">
            <Select
              value={pasteRole}
              onValueChange={(value) =>
                setPasteRole(value === "admin" ? "admin" : "member")
              }
              disabled={!canSetAdmin}
            >
              <SelectTrigger className="h-auto w-auto rounded-md border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Add as members</SelectItem>
                <SelectItem value="admin">Add as admins</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              onClick={() => {
                appendEmails(parseEmailList(pasteValue), pasteRole);
                setPasteValue("");
                setPasteOpen(false);
              }}
              disabled={parseEmailList(pasteValue).length === 0}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Add
            </Button>
            <Button
              type="button"
              intent="neutral"
              emphasis="outline"
              onClick={() => {
                setPasteValue("");
                setPasteOpen(false);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          intent="primary"
          emphasis="solid"
          disabled={validDrafts.length === 0 || bulkInvite.isPending}
          onClick={submit}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {bulkInvite.isPending ? (
            <IconLoader2 size={14} className="animate-spin" />
          ) : (
            <span className="inline-flex items-center gap-1">
              <IconCheck size={14} />
              Send {validDrafts.length || ""}{" "}
              {validDrafts.length === 1 ? "invite" : "invites"}
            </span>
          )}
        </Button>
        <Button
          type="button"
          intent="neutral"
          emphasis="outline"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Close
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Each invitee signs in with this exact email to accept.
        {canSetAdmin
          ? " Admins can manage members and workspace settings."
          : " Only the organization owner can grant admin access."}
      </p>

      {resultBanner && (
        <div className="space-y-1 rounded-md border border-border bg-accent/30 p-2.5">
          {resultBanner.succeeded > 0 && (
            <p className="text-[11px] text-primary">
              <IconCheck className="inline h-3 w-3 -mt-0.5" /> Sent{" "}
              {resultBanner.succeeded}{" "}
              {resultBanner.succeeded === 1 ? "invite" : "invites"}.
            </p>
          )}
          {resultBanner.failed.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-destructive">
              {resultBanner.failed.map((f) => (
                <li key={f.email}>
                  <IconAlertTriangle className="inline h-3 w-3 -mt-0.5 me-1" />
                  {f.email}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ErrorText error={bulkInvite.error} />
    </div>
  );
}

function DomainSettingsSection({
  domain,
  ownerEmail,
}: {
  domain: string | null;
  ownerEmail: string;
}) {
  const setOrgDomain = useSetOrgDomain();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(domain ?? "");

  const ownDomain = ownerEmail.split("@")[1]?.toLowerCase() ?? "";

  function save() {
    const trimmed = draft.trim().toLowerCase();
    if (trimmed === (domain ?? "")) {
      setEditing(false);
      return;
    }
    setOrgDomain.mutate(trimmed || null, {
      onSuccess: () => setEditing(false),
    });
  }

  return (
    <SettingsRow
      id="email-domain"
      label="Email domain auto-join"
      description={
        <OrganizationDescription
          help={`Anyone who signs up with an email at this domain joins the organization automatically. Only your own email domain (${ownDomain || "—"}) can be used; free email providers are not allowed.`}
          docsUrl={docsUrl("organizations-teams-permissions", {
            campaign: "organization_settings",
            content: "domain_auto_join",
          })}
        >
          Automatically add members with your work email.
        </OrganizationDescription>
      }
      control={
        !editing ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {domain ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                  <IconAt className="h-3.5 w-3.5 text-muted-foreground" />
                  {domain}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      onClick={() => {
                        setDraft(domain);
                        setEditing(true);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <IconPencil size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit domain</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      intent="danger"
                      emphasis="ghost"
                      disabled={setOrgDomain.isPending}
                      onClick={() => setOrgDomain.mutate(null)}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <IconX size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove domain</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Button
                type="button"
                intent="neutral"
                emphasis="outline"
                onClick={() => {
                  setDraft(ownDomain);
                  setEditing(true);
                }}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
              >
                <IconAt size={14} />
                Set domain
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder={ownDomain || "example.com"}
              className="w-44 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              autoFocus
            />
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              disabled={setOrgDomain.isPending}
              onClick={save}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {setOrgDomain.isPending ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              type="button"
              intent="neutral"
              emphasis="outline"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        )
      }
    >
      {setOrgDomain.error ? <ErrorText error={setOrgDomain.error} /> : null}
    </SettingsRow>
  );
}

function WorkspaceUrlSettingsSection({
  workspaceUrl,
}: {
  workspaceUrl: string | null;
}) {
  const setWorkspaceUrl = useSetOrgWorkspaceUrl();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workspaceUrl ?? "");

  function save() {
    const trimmed = draft.trim();
    if (trimmed === (workspaceUrl ?? "")) {
      setEditing(false);
      return;
    }
    setWorkspaceUrl.mutate(trimmed || null, {
      onSuccess: () => setEditing(false),
    });
  }

  return (
    <SettingsRow
      id="workspace-url"
      label="Workspace URL"
      description={
        <OrganizationDescription
          help="Members who land on another deployment can be sent to this workspace URL instead of an empty app."
          docsUrl={docsUrl("deployment", {
            campaign: "organization_settings",
            content: "workspace_url",
          })}
        >
          Send members to this workspace from another deployment.
        </OrganizationDescription>
      }
      control={
        !editing ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {workspaceUrl ? (
              <>
                <span className="inline-flex max-w-72 items-center gap-1.5 truncate rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                  <IconExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{workspaceUrl}</span>
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      onClick={() => {
                        setDraft(workspaceUrl);
                        setEditing(true);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <IconPencil size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit workspace URL</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      intent="danger"
                      emphasis="ghost"
                      disabled={setWorkspaceUrl.isPending}
                      onClick={() => setWorkspaceUrl.mutate(null)}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <IconX size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove workspace URL</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Button
                type="button"
                intent="neutral"
                emphasis="outline"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
              >
                Set URL
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="workspace.example.com"
              className="w-56 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              autoFocus
            />
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              disabled={setWorkspaceUrl.isPending}
              onClick={save}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {setWorkspaceUrl.isPending ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              type="button"
              intent="neutral"
              emphasis="outline"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        )
      }
    >
      {setWorkspaceUrl.error ? (
        <ErrorText error={setWorkspaceUrl.error} />
      ) : null}
    </SettingsRow>
  );
}

function AuthProviderSettingsSection({
  requiredAuthProvider,
}: {
  requiredAuthProvider: "google" | null | undefined;
}) {
  const setAuthProvider = useSetOrgAuthProvider();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const enabled = requiredAuthProvider === "google";

  function changeProvider(nextEnabled: boolean) {
    if (nextEnabled) {
      setConfirmOpen(true);
      return;
    }
    setAuthProvider.mutate(null);
  }

  return (
    <>
      <SettingsRow
        id="organization-sign-in"
        label="Organization sign-in"
        description={
          <OrganizationDescription
            help="Require Google sign-in for every member. Enabling this revokes current sessions and rejects future password or non-Google sign-ins."
            docsUrl={docsUrl("authentication", {
              campaign: "organization_settings",
              content: "organization_sign_in",
              hash: "social-providers",
            })}
          >
            Choose how members sign in.
          </OrganizationDescription>
        }
        control={
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {enabled ? "Google required" : "Google optional"}
            </span>
            <Switch
              checked={enabled}
              disabled={setAuthProvider.isPending}
              onCheckedChange={changeProvider}
              aria-label="Require Google sign-in"
            />
          </div>
        }
      >
        {setAuthProvider.error ? (
          <ErrorText error={setAuthProvider.error} />
        ) : null}
      </SettingsRow>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Require Google sign-in?</AlertDialogTitle>
            <AlertDialogDescription>
              Every current session in this organization will be revoked.
              Members must use their Google Workspace account the next time they
              sign in. Continue only after Google sign-in is configured for this
              app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setAuthProvider.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={setAuthProvider.isPending}
              onClick={() => {
                setAuthProvider.mutate("google", {
                  onSuccess: () => setConfirmOpen(false),
                });
              }}
            >
              {setAuthProvider.isPending
                ? "Enabling…"
                : "Require Google sign-in"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function A2ASecretSection({ isSet }: { isSet: boolean }) {
  const revealA2ASecret = useRevealA2ASecret();
  const setA2ASecret = useSetA2ASecret();
  const syncA2ASecret = useSyncA2ASecret();
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [syncResult, setSyncResult] = useState<SyncA2ASecretResult | null>(
    null,
  );

  function writeClipboard(value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function toggleReveal() {
    if (secret) {
      setSecret(null);
      return;
    }
    revealA2ASecret.mutate(undefined, {
      onSuccess: (result) => setSecret(result.a2aSecret),
    });
  }

  function copyToClipboard() {
    if (secret) {
      writeClipboard(secret);
      return;
    }
    revealA2ASecret.mutate(undefined, {
      onSuccess: (result) => {
        if (result.a2aSecret) writeClipboard(result.a2aSecret);
      },
    });
  }

  // Push the current secret to all connected apps. Optionally pass the
  // PREVIOUS secret as `signSecret` so the receiving apps (which still
  // hold the previous value) can verify the JWT.
  function syncToApps(signSecret?: string) {
    setSyncResult(null);
    syncA2ASecret.mutate(signSecret ? { signSecret } : undefined, {
      onSuccess: (result) => {
        setSyncResult(result);
      },
    });
  }

  function regenerate() {
    setA2ASecret.mutate(undefined, {
      onSuccess: (result) => {
        setSecret(null);
        // Auto-sync the new secret to all connected apps. Sign with the
        // PREVIOUS secret (which peers still hold) so verification on
        // their side succeeds and they accept the new value.
        syncToApps(result.previousSecret ?? undefined);
      },
    });
  }

  function saveSecret() {
    const trimmed = pasteValue.trim();
    if (!trimmed) return;
    setA2ASecret.mutate(trimmed, {
      onSuccess: (result) => {
        setPasteMode(false);
        setPasteValue("");
        // Same auto-sync flow as regenerate: peers verify with the
        // previous secret, then update to the new pasted value.
        syncToApps(result.previousSecret ?? undefined);
      },
    });
  }

  const masked = isSet ? "••••••••••••" : "Not set";

  return (
    <SettingsRow
      id="cross-app-authentication"
      label="Cross-app authentication"
      description={
        <OrganizationDescription help="This secret authenticates cross-app delegation. Every app in the organization must share it.">
          Share one secret across connected apps.
        </OrganizationDescription>
      }
      control={
        <Popover>
          <PopoverTrigger asChild>
            <ToolkitButton
              type="button"
              variant="ghost"
              intent="neutral"
              emphasis="outline"
              className="inline-flex h-9 min-h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium leading-none text-foreground hover:bg-accent/40 active:scale-100"
            >
              Manage
            </ToolkitButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[min(420px,calc(100vw-2rem))] space-y-4 p-4"
          >
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">
                Cross-app authentication
              </h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Use one shared secret across connected apps. Regenerating or
                replacing it automatically syncs the new value to those apps.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    Shared secret
                  </p>
                  <p className="mt-1 truncate font-mono text-sm text-foreground">
                    {secret ?? masked}
                  </p>
                </div>
                {isSet && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          onClick={toggleReveal}
                          disabled={revealA2ASecret.isPending}
                          aria-label={secret ? "Hide secret" : "Reveal secret"}
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          {secret ? (
                            <IconEyeOff size={14} />
                          ) : (
                            <IconEye size={14} />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {secret ? "Hide secret" : "Reveal secret"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          onClick={copyToClipboard}
                          disabled={revealA2ASecret.isPending}
                          aria-label="Copy secret"
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          {copied ? (
                            <IconCheck size={14} className="text-primary" />
                          ) : (
                            <IconCopy size={14} />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy secret</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                intent="danger"
                emphasis="outline"
                onClick={regenerate}
                disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
              >
                {setA2ASecret.isPending ? (
                  <IconLoader2 size={14} className="animate-spin" />
                ) : (
                  <IconRefresh size={14} />
                )}
                Regenerate
              </Button>
              {isSet ? (
                <Button
                  type="button"
                  intent="neutral"
                  emphasis="outline"
                  onClick={() => syncToApps()}
                  disabled={setA2ASecret.isPending || syncA2ASecret.isPending}
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
                >
                  {syncA2ASecret.isPending ? (
                    <IconLoader2 size={14} className="animate-spin" />
                  ) : (
                    <IconCloudUpload size={14} />
                  )}
                  Sync to apps
                </Button>
              ) : null}
            </div>

            {!pasteMode ? (
              <Button
                type="button"
                intent="neutral"
                emphasis="outline"
                onClick={() => setPasteMode(true)}
                className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent/50"
              >
                <IconKey size={14} />
                Paste secret
              </Button>
            ) : (
              <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                <label
                  htmlFor="cross-app-secret"
                  className="text-xs font-medium text-foreground"
                >
                  Paste a shared secret
                </label>
                <input
                  id="cross-app-secret"
                  type="text"
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveSecret();
                    if (e.key === "Escape") {
                      setPasteMode(false);
                      setPasteValue("");
                    }
                  }}
                  placeholder="Paste A2A secret"
                  className="min-w-0 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    intent="neutral"
                    emphasis="outline"
                    onClick={() => {
                      setPasteMode(false);
                      setPasteValue("");
                    }}
                    className="h-8 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    intent="primary"
                    emphasis="solid"
                    disabled={!pasteValue.trim() || setA2ASecret.isPending}
                    onClick={saveSecret}
                    className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {setA2ASecret.isPending ? (
                      <IconLoader2 size={14} className="animate-spin" />
                    ) : null}
                    Save
                  </Button>
                </div>
              </div>
            )}

            {syncA2ASecret.isPending && (
              <p className="text-xs text-muted-foreground">
                Syncing to connected apps…
              </p>
            )}
            {syncResult && !syncA2ASecret.isPending && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Synced to {syncResult.succeeded}/{syncResult.total} app
                  {syncResult.total === 1 ? "" : "s"}
                  {syncResult.failed > 0
                    ? ` (${syncResult.failed} failed)`
                    : ""}
                  .
                </p>
                {syncResult.failed > 0 && (
                  <ul className="list-disc space-y-0.5 ps-5 text-xs text-destructive">
                    {syncResult.results
                      .filter((r) => !r.ok)
                      .map((r) => (
                        <li key={r.id}>
                          {r.name}: {r.error || `HTTP ${r.status ?? "?"}`}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
            <ErrorText error={revealA2ASecret.error} />
            <ErrorText error={setA2ASecret.error} />
            <ErrorText error={syncA2ASecret.error} />
          </PopoverContent>
        </Popover>
      }
    />
  );
}

/**
 * Default Team management page. Templates can route directly to this component
 * or wrap it with their own Layout via the `layout` prop.
 */
export function TeamPage({
  layout,
  title,
  showTitle = true,
  createOrgDescription,
  className,
  appRoles,
}: TeamPageProps) {
  const t = useT();
  const { data: org, isLoading } = useOrg();

  const content = (
    <div className={`w-full space-y-6 ${className ?? ""}`}>
      {showTitle ? (
        <h2 className="text-2xl font-bold tracking-tight">
          {title ?? t("org.team")}
        </h2>
      ) : null}

      {isLoading && (
        <section className="rounded-lg border border-border bg-card p-6">
          <SettingsSkeleton lines={3} />
        </section>
      )}

      {!isLoading && (
        <>
          <PendingInvitationsCard />
          {/* Sitting in a personal workspace still counts as having an org, so
              gating this on `!org?.orgId` hid the only in-page way to reach the
              company workspace from the people who most needed it. */}
          {org?.domainMatches && org.domainMatches.length > 0 && (
            <JoinByDomainCard matches={org.domainMatches} />
          )}
          {!org?.orgId ? (
            <CreateOrgCard description={createOrgDescription} />
          ) : (
            <MembersCard appRoles={appRoles} />
          )}
        </>
      )}
    </div>
  );

  const wrapped = (
    <TooltipProvider delayDuration={200}>{content}</TooltipProvider>
  );

  return layout ? <>{layout(wrapped)}</> : wrapped;
}
