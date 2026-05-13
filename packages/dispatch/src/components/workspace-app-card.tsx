import { useEffect, useState, type FormEvent } from "react";
import { useActionMutation } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconClockHour4,
  IconDots,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconWorld,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { AppKeysPopover } from "@/components/app-keys-popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  isPendingBuilderHref,
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "@/lib/workspace-apps";

export function WorkspaceAppCard({
  app,
  className,
}: {
  app: WorkspaceAppSummary;
  className?: string;
}) {
  const href = workspaceAppHref(app);
  const openInNewTab = isPendingBuilderHref(app);
  const isPending = app.status === "pending";
  const isArchived = !!app.archived;
  const audience = app.audience ?? "internal";
  const [editOpen, setEditOpen] = useState(false);
  const [draftName, setDraftName] = useState(app.name);
  const [draftDescription, setDraftDescription] = useState(
    app.description || "",
  );

  useEffect(() => {
    if (editOpen) return;
    setDraftName(app.name);
    setDraftDescription(app.description || "");
  }, [app.description, app.name, editOpen]);

  const archive = useActionMutation("archive-workspace-app", {
    onError: (err) =>
      toast.error(`Could not hide ${app.name}: ${stringifyError(err)}`),
  });
  const unarchive = useActionMutation("unarchive-workspace-app", {
    onError: (err) =>
      toast.error(`Could not restore ${app.name}: ${stringifyError(err)}`),
  });
  const removePending = useActionMutation("remove-pending-workspace-app", {
    onError: (err) =>
      toast.error(`Could not remove ${app.name}: ${stringifyError(err)}`),
  });
  const updateMetadata = useActionMutation("update-workspace-app-metadata", {
    onSuccess: () => {
      toast.success(`Updated ${draftName.trim() || app.name}`);
      setEditOpen(false);
    },
    onError: (err) =>
      toast.error(`Could not update ${app.name}: ${stringifyError(err)}`),
  });

  const handleArchive = () => {
    archive.mutate({ appId: app.id });
    toast.success(`Hid ${app.name} from the Apps list`);
  };
  const handleUnarchive = () => {
    unarchive.mutate({ appId: app.id });
    toast.success(`Restored ${app.name} to the Apps list`);
  };
  const handleRemovePending = () => {
    removePending.mutate({ appId: app.id });
    toast.success(`Removed pending ${app.name}`);
  };
  const handleMetadataSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) {
      toast.error("App name is required.");
      return;
    }
    updateMetadata.mutate({
      appId: app.id,
      name,
      description: draftDescription.trim(),
    });
  };

  return (
    <div
      aria-disabled={!href}
      className={cn(
        "group relative rounded-lg border bg-card p-4 transition hover:border-foreground/30 aria-disabled:opacity-60",
        isArchived && "opacity-70",
        className,
      )}
    >
      {href ? (
        <a
          href={href}
          target={openInNewTab ? "_blank" : undefined}
          rel={openInNewTab ? "noreferrer" : undefined}
          aria-label={`Open ${app.name}`}
          className="absolute inset-0 z-0 rounded-lg"
        />
      ) : null}

      <div className="pointer-events-none relative z-10 flex h-full items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {app.name}
            </h3>
            {isPending ? (
              <Badge
                variant="outline"
                className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <IconClockHour4 size={12} />
                Building
              </Badge>
            ) : null}
            {isArchived ? (
              <Badge variant="outline" className="shrink-0 gap-1">
                <IconEyeOff size={12} />
                Hidden
              </Badge>
            ) : null}
            {audience === "public" ? (
              <Badge variant="outline" className="shrink-0 gap-1">
                <IconWorld size={12} />
                Public
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {app.path}
          </p>
          {isPending && app.branchName ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Branch: {app.branchName}
            </p>
          ) : null}
          {app.description ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {app.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isPending && !isArchived ? (
            <div className="pointer-events-auto">
              <AppKeysPopover appId={app.id} appName={app.name} />
            </div>
          ) : null}
          <div className="pointer-events-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`More actions for ${app.name}`}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconDots size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setEditOpen(true);
                  }}
                >
                  <IconEdit size={14} className="mr-2" />
                  Edit details
                </DropdownMenuItem>
                {isPending ? (
                  <DropdownMenuItem
                    onSelect={handleRemovePending}
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                  >
                    <IconTrash size={14} className="mr-2" />
                    Remove from list
                  </DropdownMenuItem>
                ) : isArchived ? (
                  <DropdownMenuItem onSelect={handleUnarchive}>
                    <IconEye size={14} className="mr-2" />
                    Restore to list
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={handleArchive}>
                    <IconEyeOff size={14} className="mr-2" />
                    Hide from list
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {href && !isArchived ? (
            <IconArrowUpRight
              size={16}
              className="text-muted-foreground transition group-hover:text-foreground"
            />
          ) : null}
        </div>
      </div>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit app details</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleMetadataSubmit}>
            <div className="space-y-2">
              <Label htmlFor={`app-name-${app.id}`}>Name</Label>
              <Input
                id={`app-name-${app.id}`}
                value={draftName}
                maxLength={120}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`app-description-${app.id}`}>Description</Label>
              <Textarea
                id={`app-description-${app.id}`}
                value={draftDescription}
                maxLength={500}
                rows={4}
                onChange={(event) => setDraftDescription(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMetadata.isPending}>
                {updateMetadata.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
