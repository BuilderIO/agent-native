import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBuilding,
  IconRoute,
  IconSearch,
  IconUser,
} from "@tabler/icons-react";
import {
  useInfiniteQuery,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { CrmGrid } from "@/components/crm/grid/CrmGrid";
import {
  parseCellProvenance,
  type CrmCellValue,
  type CrmGridAttribute,
  type CrmGridRow,
} from "@/components/crm/grid/model";
import {
  listRecordsParams,
  normalizeGridColumns,
  patchRecordValues,
  type CrmGridColumn,
  type CrmGridSortEntry,
  type CrmRecordValuesPayload,
} from "@/components/crm/grid/query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CrmKind, CrmRecordSummary } from "@/lib/types";

/** The glyph the grid's icon column shows until a row is hovered, and the
 *  avatar shape that goes with it — round is a person, squircle is not. */
const KIND_ICONS: Record<
  CrmKind,
  React.ComponentType<{ className?: string }>
> = {
  account: IconBuilding,
  person: IconUser,
  opportunity: IconRoute,
};

/** One `list-crm-record-values` request per chunk; the action caps at 200. */
const VALUES_CHUNK = 100;
/** Column resize fires per mouse move; only the settled layout is persisted. */
const COLUMN_SAVE_DELAY_MS = 700;

function columnStorageKey(kind: string) {
  return `crm-grid-columns:${kind}`;
}

function readStoredColumns(kind: string): CrmGridColumn[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return normalizeGridColumns(
      JSON.parse(localStorage.getItem(columnStorageKey(kind)) ?? "[]"),
    );
  } catch {
    return [];
  }
}

interface RecordsPage {
  records: Array<{
    id: string;
    displayName: string;
    kind?: string;
    subtitle?: string;
    owner?: string;
    stage?: string;
    updatedAt?: string;
  }>;
  nextCursor?: string;
  complete?: boolean;
  appliedView?: { columns?: unknown; sort?: CrmGridSortEntry[] };
}

interface ValuesEntry {
  recordId: string;
  remoteRevision?: string | null;
  provider?: string;
  values: Record<string, CrmCellValue>;
  valuesSince?: Record<string, string>;
  provenance?: Record<
    string,
    { actorType: string; actorId: string | null; provenanceJson: string }
  >;
}

interface ValuesPayload extends CrmRecordValuesPayload {
  attributes?: CrmGridAttribute[];
  records: ValuesEntry[];
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

export interface RecordGridProps {
  kind: CrmKind;
  emptyTitle: string;
  /**
   * Accepted for source compatibility with the routes that render this grid.
   * The grid owns its own paged, server-filtered query — a page handed in as a
   * prop cannot be filtered or sorted without narrowing it on the client, which
   * is the bug this grid exists to remove.
   */
  records?: CrmRecordSummary[];
  isLoading?: boolean;
}

export function RecordGrid({ kind, emptyTitle }: RecordGridProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const viewId = params.get("view") ?? undefined;
  const search = params.get("q") ?? "";
  const [sort, setSort] = useState<CrmGridSortEntry[]>([]);
  const [columnOverride, setColumnOverride] = useState<CrmGridColumn[] | null>(
    null,
  );
  const [addToListIds, setAddToListIds] = useState<string[] | null>(null);

  const queryState = useMemo(
    () => ({
      kind,
      ...(viewId ? { viewId } : {}),
      ...(search ? { search } : {}),
      ...(sort.length ? { sort } : {}),
    }),
    [kind, viewId, search, sort],
  );

  const list = useInfiniteQuery<RecordsPage>({
    queryKey: ["action", "list-crm-records", listRecordsParams(queryState)],
    queryFn: ({ pageParam }) =>
      callAction<RecordsPage>(
        "list-crm-records" as never,
        listRecordsParams(queryState, pageParam as string | undefined) as never,
        { method: "GET" },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });

  const fetchNextPage = list.fetchNextPage;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  const summaries = useMemo(
    () => list.data?.pages.flatMap((page) => page.records) ?? [],
    [list.data],
  );
  const idChunks = useMemo(
    () =>
      chunk(
        summaries.map((record) => record.id),
        VALUES_CHUNK,
      ),
    [summaries],
  );

  const valueQueries = useQueries({
    queries: idChunks.map((recordIds) => ({
      queryKey: ["action", "list-crm-record-values", { recordIds }],
      queryFn: () =>
        callAction<ValuesPayload>(
          "list-crm-record-values" as never,
          {
            recordIds,
          } as never,
        ),
      staleTime: 15_000,
    })),
  });

  const attributes = useMemo<CrmGridAttribute[]>(() => {
    const bySlug = new Map<string, CrmGridAttribute>();
    for (const query of valueQueries) {
      for (const attribute of query.data?.attributes ?? []) {
        if (!bySlug.has(attribute.apiSlug))
          bySlug.set(attribute.apiSlug, attribute);
      }
    }
    return [...bySlug.values()];
  }, [valueQueries]);

  const valuesById = useMemo(() => {
    const map = new Map<string, ValuesEntry>();
    for (const query of valueQueries) {
      for (const entry of query.data?.records ?? [])
        map.set(entry.recordId, entry);
    }
    return map;
  }, [valueQueries]);

  const rows = useMemo<CrmGridRow[]>(
    () =>
      summaries.map((summary) => {
        const entry = valuesById.get(summary.id);
        const provenance = Object.fromEntries(
          Object.entries(entry?.provenance ?? {}).map(([slug, raw]) => [
            slug,
            parseCellProvenance({
              actorType: raw.actorType,
              actorId: raw.actorId,
              provenanceJson: raw.provenanceJson,
              fieldName: slug,
            }),
          ]),
        );
        return {
          id: summary.id,
          displayName: summary.displayName,
          ...(entry?.remoteRevision
            ? { remoteRevision: entry.remoteRevision }
            : {}),
          values: entry?.values ?? {},
          ...(entry?.valuesSince ? { valuesSince: entry.valuesSince } : {}),
          provenance,
        };
      }),
    [summaries, valuesById],
  );

  const savedViews = useActionQuery<{
    views?: Array<{ id: string; name: string; updatedAt?: string }>;
  }>(
    "list-crm-saved-views" as never,
    {} as never,
    {
      enabled: Boolean(viewId),
    } as never,
  );
  const activeView = savedViews.data?.views?.find((view) => view.id === viewId);

  const savedColumns = useMemo(
    () =>
      viewId
        ? normalizeGridColumns(list.data?.pages[0]?.appliedView?.columns)
        : readStoredColumns(kind),
    [viewId, kind, list.data],
  );
  const columns = columnOverride ?? savedColumns;

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  function persistColumns(next: CrmGridColumn[]) {
    setColumnOverride(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!viewId) {
        try {
          localStorage.setItem(columnStorageKey(kind), JSON.stringify(next));
        } catch {
          // A full or blocked localStorage is not worth interrupting an edit
          // session for; the layout stays correct for this session either way.
        }
        return;
      }
      if (!activeView) return;
      void callAction(
        "save-crm-saved-view" as never,
        {
          id: viewId,
          name: activeView.name,
          columns: next,
          ...(activeView.updatedAt
            ? { expectedUpdatedAt: activeView.updatedAt }
            : {}),
        } as never,
      )
        .then(() => void savedViews.refetch())
        .catch((error: unknown) =>
          toast.error(
            error instanceof Error ? error.message : t("grid.columnSaveFailed"),
          ),
        );
    }, COLUMN_SAVE_DELAY_MS);
  }

  async function commitCell(commit: {
    row: CrmGridRow;
    attribute: CrmGridAttribute;
    value: CrmCellValue;
  }) {
    const keys = idChunks.map((recordIds) => [
      "action",
      "list-crm-record-values",
      { recordIds },
    ]);
    const snapshots = keys.map(
      (key) => [key, queryClient.getQueryData(key)] as const,
    );
    for (const key of keys) {
      queryClient.setQueryData(key, (old: CrmRecordValuesPayload | undefined) =>
        patchRecordValues(
          old,
          commit.row.id,
          commit.attribute.apiSlug,
          commit.value,
        ),
      );
    }
    // Authority decides the write target: `update-crm-record` rejects a local
    // write to a provider-owned field and vice versa.
    const target =
      commit.attribute.storagePolicy === "local-authoritative"
        ? ("local" as const)
        : ("provider" as const);
    try {
      await callAction(
        "update-crm-record" as never,
        {
          recordId: commit.row.id,
          target,
          fields: { [commit.attribute.apiSlug]: commit.value },
          ...(commit.row.remoteRevision
            ? { expectedRemoteRevision: commit.row.remoteRevision }
            : {}),
        } as never,
      );
      if (target === "provider") {
        // A provider write is a proposal, never an upstream change. Saying
        // "saved" here would be a lie about the connected CRM.
        toast.message(t("grid.providerProposalRecorded"));
      }
    } catch (error) {
      for (const [key, snapshot] of snapshots) {
        queryClient.setQueryData(key, snapshot);
      }
      toast.error(
        error instanceof Error ? error.message : t("grid.saveFailed"),
      );
    }
  }

  function updateSearch(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next, { replace: true });
  }

  const valuesError = valueQueries.find((query) => query.error)?.error;

  return (
    // ponytail: a fixed viewport-relative height rather than a flex chain — the
    // shell's <main> is a scroll container, not a flex column, so `flex-1` here
    // would collapse. Switch to flex-1 if <main> ever becomes display:flex.
    <div className="flex h-[calc(100vh-9.5rem)] min-h-[320px] flex-col">
      {/* No bottom rule here: the grid header carries its own top border, and
          two adjacent lines read as a heavy divider. */}
      <div className="flex items-center gap-2 px-5 py-2.5">
        <div className="flex w-full max-w-sm items-center gap-2 rounded-md border border-input bg-background px-3">
          <IconSearch className="size-4 shrink-0 text-muted-foreground" />
          <Input
            defaultValue={search}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder={t("grid.searchPlaceholder")}
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>
      </div>
      <CrmGrid
        attributes={attributes}
        rows={rows}
        columns={columns}
        onColumnsChange={persistColumns}
        sort={sort}
        onSortChange={setSort}
        isLoading={list.isLoading}
        isFetchingNextPage={list.isFetchingNextPage}
        hasNextPage={list.hasNextPage}
        onLoadMore={loadMore}
        error={list.error ?? valuesError}
        onRetry={() => void list.refetch()}
        emptyTitle={emptyTitle}
        nameLabel={t(`grid.name.${kind}`)}
        objectIcon={KIND_ICONS[kind]}
        avatarShape={kind === "person" ? "person" : "company"}
        rowHref={(row) => `/records/${encodeURIComponent(row.id)}`}
        onCommitCell={commitCell}
        onAddToList={setAddToListIds}
      />
      <AddToListDialog
        recordIds={addToListIds}
        onClose={() => setAddToListIds(null)}
      />
    </div>
  );
}

function AddToListDialog({
  recordIds,
  onClose,
}: {
  recordIds: string[] | null;
  onClose: () => void;
}) {
  const t = useT();
  const [listId, setListId] = useState("");
  const [pending, setPending] = useState(false);
  const lists = useActionQuery<{ lists?: Array<{ id: string; name: string }> }>(
    "list-crm-lists" as never,
    {} as never,
    { enabled: Boolean(recordIds) } as never,
  );
  const options = lists.data?.lists ?? [];

  async function submit() {
    if (!recordIds || !listId) return;
    setPending(true);
    let added = 0;
    const failures: string[] = [];
    for (const recordId of recordIds) {
      try {
        await callAction(
          "add-crm-record-to-list" as never,
          {
            listId,
            recordId,
          } as never,
        );
        added += 1;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : recordId);
      }
    }
    setPending(false);
    onClose();
    if (added) toast.success(t("grid.addedToList", { count: added }));
    // A partial add is neither a success nor a silent no-op: say how many the
    // list did not take and why.
    if (failures.length) {
      toast.error(
        t("grid.addToListFailed", {
          count: failures.length,
          reason: failures[0] ?? "",
        }),
      );
    }
  }

  return (
    <Dialog
      open={Boolean(recordIds)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("grid.addToListTitle")}</DialogTitle>
          <DialogDescription>
            {t("grid.addToListDescription", { count: recordIds?.length ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        {lists.isError ? (
          <p className="text-sm text-destructive">{t("grid.listsFailed")}</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {lists.isLoading ? t("grid.loadingLists") : t("grid.noLists")}
          </p>
        ) : (
          <select
            value={listId}
            onChange={(event) => setListId(event.target.value)}
            aria-label={t("grid.chooseList")}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{t("grid.chooseList")}</option>
            {options.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        )}
        <DialogFooter>
          <Button disabled={!listId || pending} onClick={() => void submit()}>
            {t("grid.addToListConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
