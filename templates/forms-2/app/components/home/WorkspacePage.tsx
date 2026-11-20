import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconDots, IconFolderPlus, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { FolderMenu } from "@/components/home/FolderMenu";
import { FolderRow } from "@/components/home/FolderRow";
import { FormRowsSkeleton } from "@/components/home/FormRow";
import { NewFolderDialog } from "@/components/home/NewFolderDialog";
import { SortableForms } from "@/components/home/SortableForms";
import { PageColumn } from "@/components/shell/PageColumn";
import { paths } from "@/components/shell/paths";
import { TopBar } from "@/components/shell/TopBar";
import { useNewForm } from "@/components/shell/useNewForm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { sonnerToast } from "@/components/ui/sonner";

const PAGE_SIZE = 200;

function RenameDialog({
  workspaceId,
  currentName,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [name, setName] = useState(currentName);
  const update = useActionMutation("update-workspace");
  const trimmed = name.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("forms.home.renameWorkspace")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("forms.home.renameWorkspaceDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            update.mutate(
              { id: workspaceId, name: trimmed },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
        >
          <Input
            autoFocus
            aria-label={t("forms.home.workspaceName")}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          {update.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("forms.home.renameWorkspaceFailed")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("forms.common.cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || update.isPending}>
              {t("forms.common.rename")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspacePage() {
  const t = useT();
  const { id = "", folderId } = useParams();
  const navigate = useNavigate();
  const workspaces = useActionQuery("list-workspaces", { formLimit: 0 });
  const forms = useActionQuery("list-forms", {
    workspaceId: id,
    folderId: folderId ?? "root",
    limit: PAGE_SIZE,
  });
  const remove = useActionMutation("delete-workspace");
  const move = useActionMutation("move-form");
  // A form dropped on a folder makes the same move the row menu's dialog does.
  const dropIntoFolder = (folderId: string) => (formId: string) => {
    if (!formId) return;
    move.mutate(
      { id: formId, workspaceId: id, folderId },
      {
        onSuccess: () => sonnerToast.success(t("forms.home.movedToFolder")),
        onError: () => sonnerToast.error(t("forms.home.moveFailed")),
      },
    );
  };
  const { createForm, isPending, isError } = useNewForm();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const workspace = workspaces.data?.workspaces.find((item) => item.id === id);
  const folder = folderId
    ? workspace?.folders.find((item) => item.id === folderId)
    : undefined;
  const name = folder?.name ?? workspace?.name ?? "";

  const notFound =
    workspaces.data && (!workspace || (folderId !== undefined && !folder));

  return (
    <>
      <TopBar
        crumbs={
          folderId
            ? [
                {
                  label: workspace?.name || t("forms.home.workspaceFallback"),
                  to: paths.workspace(id),
                },
                { label: name },
              ]
            : [{ label: name || t("forms.home.workspaceFallback") }]
        }
      >
        {folderId ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 font-semibold text-muted-foreground"
            disabled={!workspace}
            onClick={() => setNewFolderOpen(true)}
          >
            <IconFolderPlus className="size-[17px]" />
            {t("forms.organize.newFolder")}
          </Button>
        )}
        <Button
          size="sm"
          className="gap-2 font-semibold"
          disabled={isPending || !workspace}
          onClick={() => createForm(id, undefined, folderId)}
        >
          <IconPlus className="size-[17px]" />
          {t("forms.common.newForm")}
        </Button>
      </TopBar>
      <PageColumn className="pt-[47px] pb-16">
        {notFound ? (
          <p className="text-sm text-muted-foreground">
            {t("forms.home.workspaceNotFound")}
          </p>
        ) : (
          <section aria-label={name || t("forms.home.workspaceFallback")}>
            <div className="flex h-[30px] items-center gap-2">
              {workspace ? (
                <h2 className="truncate text-lg font-bold">{name}</h2>
              ) : (
                <Skeleton className="h-[26px] w-40" />
              )}
              {workspace ? (
                <span className="text-[13px] font-semibold text-muted-foreground">
                  {folder ? folder.formCount : workspace.formCount}
                </span>
              ) : null}
              {folder ? (
                <FolderMenu
                  folder={folder}
                  label={t("forms.organize.folderActions", {
                    name: folder.name,
                  })}
                  triggerClassName="text-muted-foreground"
                  onDeleted={() => void navigate(paths.workspace(id))}
                />
              ) : workspace ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      aria-label={t("forms.common.moreActions")}
                    >
                      <IconDots className="size-[17px]" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                      {t("forms.common.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => setDeleteOpen(true)}
                    >
                      {t("forms.home.deleteWorkspace")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            {isError ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {t("forms.common.createFormFailed")}
              </p>
            ) : null}
            <div className="mt-[11px] flex flex-col gap-[5px]">
              {folderId
                ? null
                : workspace?.folders.map((item) => (
                    <FolderRow
                      key={item.id}
                      workspaceId={id}
                      folder={item}
                      onDropForm={dropIntoFolder(item.id)}
                    />
                  ))}
              {forms.isPending ? (
                <FormRowsSkeleton />
              ) : forms.isError ? (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  {t("forms.home.formsLoadFailed")}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void forms.refetch()}
                  >
                    {t("forms.common.retry")}
                  </Button>
                </div>
              ) : forms.data.forms.length === 0 &&
                (folderId || !workspace?.folders.length) ? (
                <div className="flex h-11 items-center rounded-[7px] border border-border px-4 text-[13px] text-muted-foreground">
                  {t("forms.common.noFormsYet")}
                </div>
              ) : (
                <SortableForms
                  forms={forms.data.forms}
                  workspaceId={id}
                  folderId={folderId}
                />
              )}
            </div>
          </section>
        )}
      </PageColumn>
      {workspace ? (
        <NewFolderDialog
          workspaceId={id}
          open={newFolderOpen}
          onOpenChange={setNewFolderOpen}
        />
      ) : null}
      {workspace ? (
        <RenameDialog
          key={`${workspace.id}:${workspace.name}`}
          workspaceId={id}
          currentName={workspace.name}
          open={renameOpen}
          onOpenChange={setRenameOpen}
        />
      ) : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("forms.home.deleteWorkspaceTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("forms.home.deleteWorkspaceDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("forms.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                remove.mutate(
                  { id },
                  { onSuccess: () => void navigate(paths.home) },
                )
              }
            >
              {t("forms.common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
