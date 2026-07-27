/**
 * Saved views: the index, and the table/board surface for one view.
 *
 * Unsaved filter, sort, grouping, and presentation changes live in the URL
 * search params and nowhere else — a reload reverts to the stored view, and a
 * shared view is never autosaved. Committing a change is an explicit three-way
 * fork: save it, fork it into a new view, or discard it.
 */

import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconBookmark,
  IconLayoutKanban,
  IconLock,
  IconPlus,
  IconTable,
  IconUsers,
} from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { CrmBoard, type CrmBoardTarget } from "@/components/crm/board/CrmBoard";
import {
  buildSaveFork,
  clearBoardDraft,
  draftIsDirty,
  effectiveView,
  groupSavedViews,
  readBoardDraft,
  writeBoardDraft,
  type BoardDraft,
  type SavedViewShape,
} from "@/components/crm/board/view-draft";
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

interface SavedViewsResponse {
  views: SavedViewShape[];
}

interface ListsResponse {
  lists: Array<{
    id: string;
    name: string;
    parentObjectType: string;
    defaultViewId: string | null;
    archived: boolean;
  }>;
}

const OBJECT_TYPE_BY_KIND: Record<string, string> = {
  account: "accounts",
  person: "people",
  opportunity: "opportunities",
};

function objectTypeFor(view: SavedViewShape): string {
  if (view.targetId) return view.targetId;
  return OBJECT_TYPE_BY_KIND[view.kind ?? ""] ?? "accounts";
}

function boardTargetFor(view: SavedViewShape): CrmBoardTarget {
  if (view.targetKind === "list" && view.targetId) {
    return { kind: "list", id: view.targetId };
  }
  return {
    kind: "object",
    id: objectTypeFor(view),
    recordKind: view.kind,
  };
}

export default function SavedViewsRoute() {
  const [params] = useSearchParams();
  const viewsQuery = useActionQuery<SavedViewsResponse>(
    "list-crm-saved-views" as never,
    { limit: 100 } as never,
  );
  const listsQuery = useActionQuery<ListsResponse>(
    "list-crm-lists" as never,
    { limit: 100 } as never,
  );

  const viewId = params.get("view");
  const listId = params.get("list");
  const views = viewsQuery.data?.views ?? [];
  const lists = listsQuery.data?.lists ?? [];

  if (viewsQuery.isLoading || listsQuery.isLoading)
    return <LoadingRows rows={6} />;

  if (viewId) {
    const view = views.find((entry) => entry.id === viewId);
    return view ? (
      <SavedViewSurface view={view} onSaved={() => void viewsQuery.refetch()} />
    ) : (
      <MissingSurface kind="view" />
    );
  }
  if (listId) {
    const list = lists.find((entry) => entry.id === listId);
    if (!list) return <MissingSurface kind="list" />;
    const defaultView = list.defaultViewId
      ? views.find((entry) => entry.id === list.defaultViewId)
      : undefined;
    return defaultView ? (
      <SavedViewSurface
        view={defaultView}
        onSaved={() => void viewsQuery.refetch()}
      />
    ) : (
      <AdHocListSurface listId={list.id} name={list.name} />
    );
  }
  return <ViewsIndex views={views} lists={lists} />;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

function ViewsIndex({
  views,
  lists,
}: {
  views: SavedViewShape[];
  lists: ListsResponse["lists"];
}) {
  const t = useT();
  const groups = groupSavedViews(views);
  const listNames = new Map(lists.map((list) => [list.id, list.name]));

  return (
    <>
      <PageHeader
        eyebrow={t("views.eyebrow")}
        title={t("views.title")}
        description={t("views.description")}
        actions={<CreateSavedViewDialog />}
      />
      {groups.length ? (
        <div className="grid gap-6 p-5 sm:p-7">
          {groups.map((group) => (
            <section key={`${group.targetKind}:${group.targetId}`}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {group.targetKind === "list"
                  ? (listNames.get(group.targetId) ??
                    t("views.groupList", { target: group.targetId }))
                  : t("views.groupObject", { target: group.targetId })}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {group.views.map((view) => (
                  <Link
                    key={view.id}
                    to={`/views?view=${encodeURIComponent(view.id)}`}
                    className="group rounded-lg border border-border/70 bg-card p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start gap-3">
                      {view.viewKind === "board" ? (
                        <IconLayoutKanban className="mt-0.5 size-4 text-muted-foreground" />
                      ) : (
                        <IconTable className="mt-0.5 size-4 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {view.name}
                        </p>
                        {view.description ? (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {view.description}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <AudienceBadge audience={view.audience} />
                          {view.dataProgramId ? (
                            <Badge variant="outline" className="font-normal">
                              {t("views.dataProgram")}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <SetupEmptyState
          title={t("views.emptyTitle")}
          description={t("views.emptyDescription")}
        />
      )}
    </>
  );
}

function AudienceBadge({ audience }: { audience: "personal" | "shared" }) {
  const t = useT();
  return (
    <Badge variant="secondary" className="gap-1 font-normal">
      {audience === "shared" ? (
        <IconUsers className="size-3.5" />
      ) : (
        <IconLock className="size-3.5" />
      )}
      {t(`views.audience.${audience}`)}
    </Badge>
  );
}

function MissingSurface({ kind }: { kind: "view" | "list" }) {
  const t = useT();
  return (
    <>
      <PageHeader
        eyebrow={t("views.eyebrow")}
        title={t(`views.missing.${kind}Title`)}
        description={t(`views.missing.${kind}Description`)}
        actions={<BackToViews />}
      />
    </>
  );
}

function BackToViews() {
  const t = useT();
  return (
    <Button asChild variant="outline" size="sm" className="gap-1.5">
      <Link to="/views">
        <IconArrowLeft className="size-4" />
        {t("views.backToViews")}
      </Link>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// One saved view
// ---------------------------------------------------------------------------

function SavedViewSurface({
  view,
  onSaved,
}: {
  view: SavedViewShape;
  onSaved: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [resolvedGroupId, setResolvedGroupId] = useState<string | null>(null);
  const [statusAttributes, setStatusAttributes] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const save = useActionMutation<{ id: string }, Record<string, unknown>>(
    "save-crm-saved-view" as never,
  );

  const onGrouping = useCallback(
    (state: {
      statusAttributes: Array<{ id: string; label: string }>;
      groupAttributeId: string | null;
    }) => {
      setStatusAttributes(state.statusAttributes);
      setResolvedGroupId(state.groupAttributeId);
    },
    [],
  );

  let draft: BoardDraft;
  try {
    draft = readBoardDraft(params);
  } catch (error) {
    return (
      <>
        <PageHeader
          eyebrow={t("views.eyebrow")}
          title={view.name}
          description={
            error instanceof Error ? error.message : t("views.draftUnreadable")
          }
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setParams(clearBoardDraft(params), { replace: true })
              }
            >
              {t("views.resetToSaved")}
            </Button>
          }
        />
      </>
    );
  }

  const effective = effectiveView(view, draft);
  const dirty = draftIsDirty(view, draft);
  // A board view must persist an explicit grouping, so a mode switch carries
  // whatever the board actually grouped by.
  const saveDraft: BoardDraft = {
    ...draft,
    ...(effective.viewKind === "board"
      ? {
          groupByAttributeId:
            draft.groupByAttributeId ??
            view.groupByAttributeId ??
            resolvedGroupId ??
            undefined,
        }
      : {}),
  };

  function updateDraft(next: BoardDraft) {
    setParams(writeBoardDraft(params, { ...draft, ...next }), {
      replace: true,
    });
  }

  async function commitFork(branch: "update" | "new", name?: string) {
    const mutation = buildSaveFork(branch, {
      view,
      draft: saveDraft,
      ...(name === undefined ? {} : { name }),
    });
    if (!mutation) return;
    try {
      const saved = await save.mutateAsync(mutation.input);
      onSaved();
      toast.success(t("views.savedToast"));
      if (branch === "new") {
        navigate(`/views?view=${encodeURIComponent(saved.id)}`);
      } else {
        setParams(clearBoardDraft(params), { replace: true });
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("views.saveFailedToast"),
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={t("views.eyebrow")}
        title={view.name}
        {...(view.description ? { description: view.description } : {})}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AudienceBadge audience={view.audience} />
            <ModeToggle
              mode={effective.viewKind}
              onChange={(mode) => updateDraft({ mode })}
            />
            <BackToViews />
          </div>
        }
      />
      {effective.viewKind === "board" && statusAttributes.length > 1 ? (
        <div className="flex items-center gap-2 border-b border-border/70 px-5 py-2 sm:px-7">
          <span className="text-xs text-muted-foreground">
            {t("views.groupBy")}
          </span>
          <Select
            value={saveDraft.groupByAttributeId ?? ""}
            onValueChange={(next) => updateDraft({ groupByAttributeId: next })}
          >
            <SelectTrigger className="h-8 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusAttributes.map((attribute) => (
                <SelectItem key={attribute.id} value={attribute.id}>
                  {attribute.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {dirty ? (
        <SaveFork
          audience={view.audience}
          isSaving={save.isPending}
          onUpdate={() => void commitFork("update")}
          onSaveAsNew={(name) => void commitFork("new", name)}
          onDiscard={() =>
            setParams(clearBoardDraft(params), { replace: true })
          }
        />
      ) : null}
      <CrmBoard
        target={boardTargetFor(view)}
        {...(effective.groupByAttributeId
          ? { groupByAttributeId: effective.groupByAttributeId }
          : {})}
        filter={effective.filter}
        mode={effective.viewKind}
        columnAttributeIds={(view.columns ?? []).flatMap((column) =>
          typeof column === "string"
            ? [column]
            : typeof (column as { attributeId?: unknown }).attributeId ===
                "string"
              ? [(column as { attributeId: string }).attributeId]
              : [],
        )}
        onGrouping={onGrouping}
      />
    </>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "table" | "board";
  onChange: (mode: "table" | "board") => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1 rounded-md border border-border/70 p-0.5">
      <Button
        size="sm"
        variant={mode === "table" ? "secondary" : "ghost"}
        className="h-7 gap-1.5"
        onClick={() => onChange("table")}
      >
        <IconTable className="size-4" />
        {t("views.table")}
      </Button>
      <Button
        size="sm"
        variant={mode === "board" ? "secondary" : "ghost"}
        className="h-7 gap-1.5"
        onClick={() => onChange("board")}
      >
        <IconLayoutKanban className="size-4" />
        {t("views.board")}
      </Button>
    </div>
  );
}

function SaveFork({
  audience,
  isSaving,
  onUpdate,
  onSaveAsNew,
  onDiscard,
}: {
  audience: "personal" | "shared";
  isSaving: boolean;
  onUpdate: () => void;
  onSaveAsNew: (name: string) => void;
  onDiscard: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/40 px-5 py-2.5 sm:px-7">
      <span className="mr-auto text-sm text-muted-foreground">
        {t("views.unsavedChanges")}
      </span>
      <Button size="sm" disabled={isSaving} onClick={onUpdate}>
        {audience === "shared" ? t("views.saveForEveryone") : t("views.save")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <IconPlus className="size-4" />
            {t("views.saveAsNew")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("views.saveAsNewTitle")}</DialogTitle>
            <DialogDescription>
              {t("views.saveAsNewDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="new-view-name">{t("views.nameLabel")}</Label>
            <Input
              id="new-view-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!name.trim() || isSaving}
              onClick={() => {
                setOpen(false);
                onSaveAsNew(name.trim());
              }}
            >
              {t("views.createView")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button size="sm" variant="ghost" onClick={onDiscard}>
        {t("views.discard")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A list with no default view yet
// ---------------------------------------------------------------------------

function AdHocListSurface({ listId, name }: { listId: string; name: string }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "table" ? "table" : "board";

  return (
    <>
      <PageHeader
        eyebrow={t("views.eyebrow")}
        title={name}
        description={t("views.listNoDefaultView")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ModeToggle
              mode={mode}
              onChange={(next) => {
                const updated = new URLSearchParams(params);
                updated.set("mode", next);
                setParams(updated, { replace: true });
              }}
            />
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/lists">
                <IconBookmark className="size-4" />
                {t("views.allLists")}
              </Link>
            </Button>
          </div>
        }
      />
      <CrmBoard target={{ kind: "list", id: listId }} mode={mode} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreateSavedViewDialog() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("account");
  const save = useActionMutation<{ id: string }, Record<string, unknown>>(
    "save-crm-saved-view" as never,
  );

  async function createView() {
    try {
      const saved = await save.mutateAsync({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        kind,
        viewKind: "table",
        targetKind: "object",
        targetId: OBJECT_TYPE_BY_KIND[kind] ?? "accounts",
        audience: "personal",
      });
      setOpen(false);
      navigate(`/views?view=${encodeURIComponent(saved.id)}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("views.saveFailedToast"),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <IconPlus className="size-4" />
          {t("views.newView")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("views.createTitle")}</DialogTitle>
          <DialogDescription>{t("views.createDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="view-name">{t("views.nameLabel")}</Label>
            <Input
              id="view-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="view-description">
              {t("views.descriptionLabel")}
            </Label>
            <Input
              id="view-description"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="view-kind">{t("views.recordTypeLabel")}</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="view-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="account">
                  {t("navigation.accounts")}
                </SelectItem>
                <SelectItem value="person">{t("navigation.people")}</SelectItem>
                <SelectItem value="opportunity">
                  {t("navigation.opportunities")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || save.isPending}
            onClick={() => void createView()}
          >
            {t("views.createView")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
