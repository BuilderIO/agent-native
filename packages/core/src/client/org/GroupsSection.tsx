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
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  IconTrash,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconUsersGroup,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import type { WorkspaceUserGroup } from "../../workspace-connections/groups.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useT } from "../i18n.js";
import { useShareOrgMemberSearch } from "../sharing/share-controller-helpers.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { useOrg } from "./hooks.js";
import { Button, ErrorText, SectionTooltipProvider } from "./TeamPrimitives.js";

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
    setMembers(group?.memberEmails ?? initialMemberEmails);
    setSearch("");
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

export function WorkspaceGroupsCard({
  groups,
  onNewGroup,
  onEditGroup,
  emptyMessage,
}: {
  groups: WorkspaceUserGroup[];
  onNewGroup: () => void;
  onEditGroup: (group: WorkspaceUserGroup) => void;
  /** Replaces "No groups yet" when there are no groups. */
  emptyMessage?: string;
}) {
  const t = useT();
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteDialogGroupId, setDeleteDialogGroupId] = useState<string | null>(
    null,
  );
  const deleteGroup = useActionMutation("delete-workspace-user-group");

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
          onClick={onNewGroup}
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
                onClick={() => onEditGroup(group)}
                aria-label={t("org.editGroupAria", {
                  defaultValue: "Edit group {{name}}",
                  name: group.name,
                })}
                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <IconPencil size={14} />
              </Button>
              <AlertDialog
                open={deleteDialogGroupId === group.id}
                onOpenChange={(open) => {
                  if (open) {
                    setDeleteDialogGroupId(group.id);
                    setDeleteConfirmText("");
                    setDeleteError(null);
                  } else if (!deleteGroup.isPending) {
                    setDeleteDialogGroupId(null);
                    setDeleteConfirmText("");
                    setDeleteError(null);
                  }
                }}
              >
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
                      {t("org.deleteOrgConfirmPrompt", {
                        name: group.name,
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <label
                    htmlFor={`workspace-delete-group-name-${group.id}`}
                    className="sr-only"
                  >
                    {t("org.groupName", { defaultValue: "Group name" })}
                  </label>
                  <Input
                    id={`workspace-delete-group-name-${group.id}`}
                    value={deleteConfirmText}
                    onChange={(event) =>
                      setDeleteConfirmText(event.target.value)
                    }
                    placeholder={t("org.groupName", {
                      defaultValue: "Group name",
                    })}
                    autoFocus
                  />
                  <ErrorText error={deleteError} />
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("org.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={
                        deleteGroup.isPending ||
                        deleteConfirmText.trim() !== group.name.trim()
                      }
                      onClick={(event) => {
                        if (deleteConfirmText.trim() !== group.name.trim())
                          return;
                        event.preventDefault();
                        setDeleteError(null);
                        deleteGroup.mutate(
                          { id: group.id },
                          {
                            onSuccess: () => {
                              setDeleteDialogGroupId(null);
                              setDeleteConfirmText("");
                              setDeleteError(null);
                            },
                            onError: (error) => {
                              setDeleteError(error);
                              setDeleteDialogGroupId(group.id);
                            },
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
            {emptyMessage ??
              t("org.noGroups", { defaultValue: "No groups yet" })}
          </p>
        )}
      </div>
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
