import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconArchive,
  IconListDetails,
  IconPlus,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface CrmListRow {
  id: string;
  connectionId: string;
  name: string;
  apiSlug: string;
  parentObjectType: string;
  description: string | null;
  archived: boolean;
  entryCount?: number;
}

interface CrmConnectionSummary {
  id: string;
  label: string;
  objectTypes: string[];
}

const LISTS_PARAMS = { limit: 100 } as const;
const LISTS_KEY = ["action", "list-crm-lists", LISTS_PARAMS];

export function ListsSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const listsQuery = useActionQuery<{ lists: CrmListRow[] }>(
    "list-crm-lists" as never,
    LISTS_PARAMS as never,
  );
  const connectionsQuery = useActionQuery<{
    connections: CrmConnectionSummary[];
  }>("list-crm-connections" as never, {} as never);
  const archive = useActionMutation<
    unknown,
    { listId: string; archived: boolean }
  >("update-crm-list" as never);
  const lists = listsQuery.data?.lists ?? [];

  async function archiveList(list: CrmListRow) {
    void queryClient.cancelQueries({ queryKey: LISTS_KEY });
    const previous = queryClient.getQueryData<{ lists: CrmListRow[] }>(
      LISTS_KEY,
    );
    queryClient.setQueryData(LISTS_KEY, {
      ...previous,
      lists: (previous?.lists ?? []).filter((row) => row.id !== list.id),
    });
    try {
      await archive.mutateAsync({ listId: list.id, archived: true });
    } catch (error) {
      queryClient.setQueryData(LISTS_KEY, previous);
      toast.error(
        error instanceof Error ? error.message : t("lists.archiveFailed"),
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {t("lists.title")}
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            {t("lists.description")}
          </p>
        </div>
        <CreateListDialog
          connections={connectionsQuery.data?.connections ?? []}
          onCreated={() =>
            void queryClient.invalidateQueries({
              queryKey: ["action", "list-crm-lists"],
            })
          }
        />
      </div>

      {listsQuery.isError ? (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
          <p className="flex-1 text-sm">
            {listsQuery.error instanceof Error
              ? listsQuery.error.message
              : t("lists.loadFailed")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void listsQuery.refetch()}
          >
            {t("lists.retry")}
          </Button>
        </div>
      ) : lists.length ? (
        <div className="mt-6 divide-y divide-border/70 rounded-lg border border-border/70 bg-card">
          {lists.map((list) => (
            <section
              key={list.id}
              className="flex flex-wrap items-center gap-4 px-4 py-3.5"
            >
              <IconListDetails className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/lists/${encodeURIComponent(list.id)}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {list.name}
                  </Link>
                  <Badge variant="outline" className="font-normal">
                    {list.parentObjectType}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("lists.entryCount", { entries: list.entryCount ?? 0 })}
                  {" · "}
                  <code>{list.apiSlug}</code>
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("lists.archiveAria", { name: list.name })}
                  >
                    <IconArchive className="size-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("lists.archiveTitle", { name: list.name })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("lists.archiveDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("lists.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void archiveList(list)}>
                      {t("lists.archive")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          ))}
        </div>
      ) : listsQuery.isLoading ? (
        <div
          className="mt-6 space-y-2"
          role="status"
          aria-busy="true"
          aria-label={t("lists.loading")}
        >
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="flex items-center gap-4 rounded-lg border border-border/70 bg-card px-4 py-3.5"
            >
              <Skeleton className="size-4" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="size-8 rounded-md" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm font-medium">{t("lists.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("lists.emptyDescription")}
          </p>
        </div>
      )}
    </div>
  );
}

function CreateListDialog({
  connections,
  onCreated,
}: {
  connections: CrmConnectionSummary[];
  onCreated: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentObjectType, setParentObjectType] = useState("");
  const create = useActionMutation<
    unknown,
    {
      name: string;
      parentObjectType: string;
      description?: string;
      connectionId?: string;
    }
  >("create-crm-list" as never);

  const objectTypes = connections.flatMap((connection) =>
    connection.objectTypes.map((objectType) => ({
      connectionId: connection.id,
      objectType,
      label: `${connection.label} · ${objectType}`,
      key: `${connection.id}:${objectType}`,
    })),
  );
  const selected = objectTypes.find((entry) => entry.key === parentObjectType);

  function openChange(next: boolean) {
    if (!next) {
      setName("");
      setDescription("");
      setParentObjectType("");
    }
    setOpen(next);
  }

  async function submit() {
    if (!selected) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        parentObjectType: selected.objectType,
        connectionId: selected.connectionId,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      openChange(false);
      onCreated();
      toast.success(t("lists.created"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("lists.createFailed"),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <IconPlus className="size-4" /> {t("lists.newList")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("lists.createTitle")}</DialogTitle>
          <DialogDescription>{t("lists.createDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="new-list-name">{t("lists.name")}</Label>
            <Input
              id="new-list-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-list-object">{t("lists.parentObject")}</Label>
            <Select
              value={parentObjectType}
              onValueChange={setParentObjectType}
              disabled={!objectTypes.length}
            >
              <SelectTrigger id="new-list-object">
                <SelectValue placeholder={t("lists.parentObjectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {objectTypes.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-list-description">
              {t("lists.listDescription")}
            </Label>
            <Textarea
              id="new-list-description"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("lists.stageSeedNote")}
          </p>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || !selected || create.isPending}
            onClick={() => void submit()}
          >
            {t("lists.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
