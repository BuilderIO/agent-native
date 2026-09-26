import { Skeleton } from "@agent-native/toolkit/design-system";
import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@agent-native/toolkit/ui/empty";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@agent-native/toolkit/ui/input-group";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  IconTrash,
  IconPencil,
  IconPlus,
  IconUsersGroup,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import type { WorkspaceUserGroup } from "../../workspace-connections/groups.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useT } from "../i18n.js";
import { SettingsRow } from "../settings/SettingsRow.js";
import { useShareOrgMemberSearch } from "../sharing/share-controller-helpers.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { useOrg } from "./hooks.js";
import {
  DialogErrorAlert,
  PendingLabel,
  SectionTooltipProvider,
} from "./TeamPrimitives.js";

export function WorkspaceGroupEditor({
  open,
  group,
  initialMemberEmails = [],
  onClose,
}: {
  open: boolean;
  group: WorkspaceUserGroup | null;
  initialMemberEmails?: string[];
  onClose: () => void;
}) {
  const t = useT();
  const nameId = useId();
  const peopleId = useId();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const memberSearch = useShareOrgMemberSearch(search, open, { limit: 100 });
  const saveGroup = useActionMutation("upsert-workspace-user-group");
  const [saveError, setSaveError] = useState<unknown>(null);
  const selected = useMemo(
    () => new Set(members.map((email) => email.toLowerCase())),
    [members],
  );

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setMembers(group?.memberEmails ?? initialMemberEmails);
    setSearch("");
    setSaveError(null);
  }, [group, initialMemberEmails, open]);

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

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || saveGroup.isPending) return;
    setSaveError(null);
    saveGroup.mutate(
      {
        ...(group?.id ? { id: group.id } : {}),
        name: trimmedName,
        memberEmails: members,
      },
      { onSuccess: onClose, onError: setSaveError },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <form className="grid gap-4" onSubmit={save}>
          <DialogHeader>
            <DialogTitle>
              {group
                ? t("org.editGroup", { defaultValue: "Edit group" })
                : t("org.createGroup", { defaultValue: "Create group" })}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={nameId}>
              {t("org.groupName", { defaultValue: "Group name" })}
            </Label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Rev Ops"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={peopleId}>
                {t("org.groupMembers", { defaultValue: "People" })}
              </Label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {members.length}
              </span>
            </div>
            <InputGroup>
              <InputGroupInput
                id={peopleId}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("org.searchPeople", {
                  defaultValue: "Search people",
                })}
                autoComplete="off"
              />
              <InputGroupAddon>
                <IconSearch aria-hidden="true" />
              </InputGroupAddon>
            </InputGroup>
            <div
              className="h-64 overflow-y-auto rounded-md border border-border p-1"
              aria-busy={memberSearch.isLoading}
            >
              {memberSearch.isLoading ? (
                <div className="grid gap-1">
                  {["w-40", "w-52", "w-36", "w-48"].map((width) => (
                    <div
                      key={width}
                      className="flex h-9 items-center justify-between gap-3 px-3"
                    >
                      <Skeleton className={`h-3.5 ${width}`} />
                      <Skeleton className="size-4 rounded-sm" />
                    </div>
                  ))}
                </div>
              ) : visibleMembers.length > 0 ? (
                visibleMembers.map((member) => (
                  <label
                    key={member.email}
                    htmlFor={`workspace-group-member-${member.email}`}
                    className="flex h-9 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 hover:bg-accent"
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
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {t("org.noPeopleFound", { defaultValue: "No people found" })}
                </p>
              )}
            </div>
            {memberSearch.hasMore ? (
              <ToolkitButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={memberSearch.loadMore}
                disabled={memberSearch.isLoadingMore}
                className="justify-self-start"
              >
                {t("org.loadMorePeople", { defaultValue: "Load more" })}
              </ToolkitButton>
            ) : null}
            {memberSearch.error ? (
              <p className="text-sm text-destructive">
                {t("agentChat.share.loadPeopleFailed")}
              </p>
            ) : null}
          </div>
          <DialogErrorAlert error={saveError} />
          <DialogFooter>
            <ToolkitButton type="button" variant="secondary" onClick={onClose}>
              {t("org.cancel")}
            </ToolkitButton>
            <ToolkitButton
              type="submit"
              disabled={!name.trim() || saveGroup.isPending}
            >
              <PendingLabel
                pending={saveGroup.isPending}
                label={t("org.saveGroup", { defaultValue: "Save group" })}
                pendingLabel={t("agentChat.common.saving")}
              />
            </ToolkitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteGroupDialog({
  group,
  onOpenChange,
}: {
  group: WorkspaceUserGroup | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const deleteGroup = useActionMutation("delete-workspace-user-group");
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const canConfirm = group !== null && confirmText.trim() === group.name.trim();

  const groupId = group?.id;
  useEffect(() => {
    setConfirmText("");
    setDeleteError(null);
  }, [groupId]);

  return (
    <Dialog open={group !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!group || !canConfirm || deleteGroup.isPending) return;
            setDeleteError(null);
            deleteGroup.mutate(
              { id: group.id },
              { onSuccess: () => onOpenChange(false), onError: setDeleteError },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("org.deleteGroup", { defaultValue: "Delete group?" })}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`workspace-delete-group-name-${groupId}`}>
              {t("org.deleteGroupConfirm", { name: group?.name ?? "" })}
            </Label>
            <Input
              id={`workspace-delete-group-name-${groupId}`}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={t("org.groupName", { defaultValue: "Group name" })}
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogErrorAlert error={deleteError} />
          <DialogFooter>
            <ToolkitButton
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              {t("org.cancel")}
            </ToolkitButton>
            <ToolkitButton
              type="submit"
              variant="destructive"
              disabled={!canConfirm || deleteGroup.isPending}
            >
              <PendingLabel
                pending={deleteGroup.isPending}
                label={t("org.delete", { defaultValue: "Delete" })}
                pendingLabel={t("org.deleting", { defaultValue: "Deleting…" })}
              />
            </ToolkitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceGroupsCard({
  groups,
  onNewGroup,
  onEditGroup,
  emptyMessage,
}: {
  groups: WorkspaceUserGroup[];
  onNewGroup: () => void;
  onEditGroup: (group: WorkspaceUserGroup) => void;
  /** The empty state's description when there are no groups. */
  emptyMessage?: string;
}) {
  const t = useT();
  const [deleting, setDeleting] = useState<WorkspaceUserGroup | null>(null);
  const newGroupLabel = t("org.newGroup", { defaultValue: "New group" });

  return (
    <section className="scroll-mt-16">
      <header className="mb-2.5 flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("org.groups", { defaultValue: "Groups" })}
        </h2>
        {groups.length > 0 ? (
          <ToolkitButton
            type="button"
            variant="outline"
            size="xs"
            onClick={onNewGroup}
          >
            <IconPlus />
            {newGroupLabel}
          </ToolkitButton>
        ) : null}
      </header>
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground">
        {groups.length > 0 ? (
          groups.map((group) => (
            <SettingsRow
              key={group.id}
              icon={<IconUsersGroup />}
              label={group.name}
              description={t("org.memberCount", {
                count: group.memberEmails.length,
              })}
              control={
                <div className="flex items-center gap-1">
                  <ToolkitButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onEditGroup(group)}
                    aria-label={t("org.editGroupAria", {
                      defaultValue: "Edit group {{name}}",
                      name: group.name,
                    })}
                  >
                    <IconPencil />
                  </ToolkitButton>
                  <ToolkitButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleting(group)}
                    aria-label={t("org.deleteGroupAria", {
                      defaultValue: "Delete group {{name}}",
                      name: group.name,
                    })}
                  >
                    <IconTrash />
                  </ToolkitButton>
                </div>
              }
            />
          ))
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconUsersGroup />
              </EmptyMedia>
              <EmptyTitle>
                {t("org.noGroups", { defaultValue: "No groups yet" })}
              </EmptyTitle>
              {emptyMessage ? (
                <EmptyDescription>{emptyMessage}</EmptyDescription>
              ) : null}
            </EmptyHeader>
            <EmptyContent>
              <ToolkitButton type="button" size="sm" onClick={onNewGroup}>
                <IconPlus />
                {newGroupLabel}
              </ToolkitButton>
            </EmptyContent>
          </Empty>
        )}
      </div>
      <DeleteGroupDialog
        group={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </section>
  );
}

export function useWorkspaceUserGroups(enabled: boolean) {
  return useActionQuery<WorkspaceUserGroup[]>(
    "list-workspace-user-groups",
    {},
    { enabled },
  );
}

export interface WorkspaceGroupEditorController {
  openGroupEditor: (
    group: WorkspaceUserGroup | null,
    memberEmails?: string[],
  ) => void;
  dialogProps: {
    open: boolean;
    group: WorkspaceUserGroup | null;
    initialMemberEmails: string[];
    onClose: () => void;
  };
}

/**
 * Owns the group editor dialog that the members table ("create group from
 * selection") and the groups list share. When both sections render on one
 * page, pass them the same controller so they open a single dialog.
 */
export function useWorkspaceGroupEditor(): WorkspaceGroupEditorController {
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<WorkspaceUserGroup | null>(
    null,
  );
  const [initialGroupMembers, setInitialGroupMembers] = useState<string[]>([]);

  function openGroupEditor(
    group: WorkspaceUserGroup | null,
    memberEmails: string[] = [],
  ) {
    setEditingGroup(group);
    setInitialGroupMembers(memberEmails);
    setGroupEditorOpen(true);
  }

  function closeGroupEditor() {
    setGroupEditorOpen(false);
    setEditingGroup(null);
    setInitialGroupMembers([]);
  }

  return {
    openGroupEditor,
    dialogProps: {
      open: groupEditorOpen,
      group: editingGroup,
      initialMemberEmails: initialGroupMembers,
      onClose: closeGroupEditor,
    },
  };
}

/** Workspace user groups. Owners and admins only; renders nothing otherwise. */
export function GroupsSection({
  groupEditor,
  emptyMessage,
}: {
  groupEditor?: WorkspaceGroupEditorController;
  /** Replaces "No groups yet" when there are no groups. */
  emptyMessage?: string;
}) {
  const { data: org } = useOrg();
  const isOwnerOrAdmin = org?.role === "owner" || org?.role === "admin";
  const groupsQuery = useWorkspaceUserGroups(isOwnerOrAdmin);
  const ownGroupEditor = useWorkspaceGroupEditor();
  const editor = groupEditor ?? ownGroupEditor;

  if (!org?.orgId || !isOwnerOrAdmin) return null;

  return (
    <SectionTooltipProvider>
      <WorkspaceGroupsCard
        groups={groupsQuery.data ?? []}
        onNewGroup={() => editor.openGroupEditor(null)}
        onEditGroup={(group) => editor.openGroupEditor(group)}
        emptyMessage={emptyMessage}
      />
      <WorkspaceGroupEditor {...editor.dialogProps} />
    </SectionTooltipProvider>
  );
}
