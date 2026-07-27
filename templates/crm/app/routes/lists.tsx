/**
 * Lists index. A list is the workflow overlay over one object type: its entries
 * and their attribute values are local on every backend, so a pipeline works
 * over a HubSpot or Salesforce mirror without a provider write.
 */

import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconList, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  LoadingRows,
  PageHeader,
  SetupEmptyState,
} from "@/components/crm/Surface";
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

interface ListsResponse {
  lists: Array<{
    id: string;
    name: string;
    description: string | null;
    parentObjectType: string;
    entryCount: number;
    defaultViewId: string | null;
    archived: boolean;
  }>;
}

const OBJECT_TYPES = ["accounts", "people", "opportunities"] as const;

/** Opens the list's default view, or an ad-hoc board when it has none. */
export function listHref(listId: string): string {
  return `/views?list=${encodeURIComponent(listId)}`;
}

export default function ListsRoute() {
  const t = useT();
  const query = useActionQuery<ListsResponse>(
    "list-crm-lists" as never,
    { limit: 100 } as never,
  );
  const lists = query.data?.lists ?? [];

  return (
    <>
      <PageHeader
        eyebrow={t("lists.eyebrow")}
        title={t("lists.title")}
        description={t("lists.description")}
        actions={<CreateListDialog onCreated={() => void query.refetch()} />}
      />
      {query.isLoading ? (
        <LoadingRows rows={5} />
      ) : query.error ? (
        <div className="m-5 rounded-lg border border-border/70 bg-card p-4 sm:m-7">
          <p className="text-sm text-muted-foreground">
            {query.error instanceof Error
              ? query.error.message
              : t("lists.loadFailed")}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void query.refetch()}
          >
            {t("lists.retry")}
          </Button>
        </div>
      ) : lists.length ? (
        <div className="grid gap-2 p-5 sm:grid-cols-2 sm:p-7 xl:grid-cols-3">
          {lists.map((list) => (
            <Link
              key={list.id}
              to={listHref(list.id)}
              className="group rounded-lg border border-border/70 bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start gap-3">
                <IconList className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{list.name}</p>
                  {list.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {list.description}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary" className="font-normal">
                      {t("lists.entryCount", { count: list.entryCount })}
                    </Badge>
                    <Badge variant="outline" className="font-normal">
                      {list.parentObjectType}
                    </Badge>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <SetupEmptyState
          title={t("lists.emptyTitle")}
          description={t("lists.emptyDescription")}
        />
      )}
    </>
  );
}

function CreateListDialog({ onCreated }: { onCreated: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentObjectType, setParentObjectType] = useState<string>("accounts");
  const create = useActionMutation<{ id: string }, Record<string, unknown>>(
    "create-crm-list" as never,
  );

  async function createList() {
    try {
      const list = await create.mutateAsync({
        name: name.trim(),
        parentObjectType,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setOpen(false);
      onCreated();
      navigate(listHref(list.id));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("lists.createFailed"),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <IconPlus className="size-4" />
          {t("lists.newList")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("lists.createTitle")}</DialogTitle>
          <DialogDescription>{t("lists.createDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="list-name">{t("lists.nameLabel")}</Label>
            <Input
              id="list-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="list-object">{t("lists.objectTypeLabel")}</Label>
            <Select
              value={parentObjectType}
              onValueChange={setParentObjectType}
            >
              <SelectTrigger id="list-object">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OBJECT_TYPES.map((objectType) => (
                  <SelectItem key={objectType} value={objectType}>
                    {t(`lists.objectType.${objectType}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="list-description">
              {t("lists.descriptionLabel")}
            </Label>
            <Input
              id="list-description"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() => void createList()}
          >
            {t("lists.createList")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
