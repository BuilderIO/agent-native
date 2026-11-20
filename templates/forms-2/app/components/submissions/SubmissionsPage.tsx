import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { SubmissionRow } from "@shared/form-contract";
import { IconDownload } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { ConfirmDeleteDialog } from "@/components/form-menu/ConfirmDeleteDialog";
import { useFormOutlet } from "@/components/forms/form-data";
import { ErrorPanel } from "@/components/forms/NotFoundPanel";
import { parseFilter, type Filter } from "@/components/forms/submission-format";
import { paths } from "@/components/shell/paths";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Translate } from "@/lib/translate";
import { cn } from "@/lib/utils";

import { SubmissionModal } from "./SubmissionModal";
import { SubmissionsTable } from "./SubmissionsTable";

const PAGE_SIZE = 50;

const FILTERS: Filter[] = ["all", "completed", "partial"];

function filterLabel(t: Translate, filter: Filter): string {
  switch (filter) {
    case "all":
      return t("forms.submissions.filter.all");
    case "completed":
      return t("forms.submissions.filter.completed");
    case "partial":
      return t("forms.submissions.filter.partial");
  }
}

function TableSkeleton() {
  const t = useT();
  return (
    <div
      className="flex flex-col gap-5 px-8 pt-6"
      role="status"
      aria-label={t("forms.submissions.loading")}
    >
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  );
}

function EmptyState({ filter, formId }: { filter: Filter; formId: string }) {
  const t = useT();
  const partial = filter === "partial";
  return (
    <div className="flex flex-col items-center gap-3 pt-20 text-center">
      <p className="text-base font-semibold">
        {partial
          ? t("forms.submissions.emptyPartialTitle")
          : t("forms.submissions.emptyTitle")}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {partial
          ? t("forms.submissions.emptyPartialBody")
          : t("forms.submissions.emptyBody")}
      </p>
      {filter === "all" ? (
        <Button variant="ghost" asChild>
          <Link to={paths.formTab(formId, "share")}>
            {t("forms.submissions.share")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

export function SubmissionsPage() {
  const t = useT();
  const form = useFormOutlet();
  const [params] = useSearchParams();
  const filter = parseFilter(params.get("filter"));
  const [page, setPage] = useState(0);
  const { data, error, isLoading, refetch } = useActionQuery(
    "list-submissions",
    { formId: form.id, filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [open, setOpen] = useState<SubmissionRow | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const remove = useActionMutation("delete-submissions");
  const linkedId = params.get("submission");
  const linkOpened = useRef(false);
  useEffect(() => {
    const linked = data?.submissions.find((row) => row.id === linkedId);
    if (!linked || linkOpened.current) return;
    linkOpened.current = true;
    setOpen(linked);
  }, [data, linkedId]);

  const rows = (data?.submissions ?? []).filter(
    (row) => !removed.includes(row.id),
  );
  const questions = data?.questions ?? [];

  function changeFilterPage() {
    setPage(0);
    setSelected([]);
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  function deleteRows(ids: string[]) {
    setRemoved((current) => [...current, ...ids]);
    setSelected((current) => current.filter((id) => !ids.includes(id)));
    remove.mutate(
      { formId: form.id, ids },
      {
        onError: () =>
          setRemoved((current) => current.filter((id) => !ids.includes(id))),
        onSettled: () => setRemoved([]),
      },
    );
  }

  async function downloadCsv() {
    const file = await callAction(
      "export-submissions-csv",
      { formId: form.id, filter },
      { method: "GET" },
    );
    const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="pt-5 pb-16">
      <div className="relative">
        <div className="overflow-x-auto overflow-y-hidden">
          <div
            role="navigation"
            aria-label={t("forms.submissions.filters")}
            className="flex px-8"
          >
            <div className="flex">
              {FILTERS.map((key) => (
                <Link
                  key={key}
                  to={`${paths.formTab(form.id, "submissions")}${key === "all" ? "" : `?filter=${key}`}`}
                  onClick={changeFilterPage}
                  className="mr-3 text-base leading-[18.4px] font-normal text-[color:var(--forms-link)]"
                >
                  <div
                    className={cn(
                      "-mb-px flex items-center border-b-2 py-3 text-sm leading-[14px] font-semibold",
                      filter === key
                        ? "border-b-foreground text-foreground"
                        : "border-b-transparent text-muted-foreground",
                    )}
                  >
                    {filterLabel(t, key)}
                    {data ? (
                      <div className="relative -my-[5px] ml-1.5">
                        <span className="inline-flex h-5 items-center gap-1 rounded-[10px] text-center bg-[hsl(var(--forms-badge))] px-[7px] text-xs leading-3 font-medium text-center text-[hsl(var(--forms-badge-foreground))]">
                          {data.counts[key]}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
        {rows.length > 0 ? (
          <div className="absolute top-[6px] right-6">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-7 gap-[8.4px] rounded-[7px] px-[9.8px] text-center text-sm leading-[14px] font-normal text-muted-foreground"
            >
              <a
                href="#download"
                onClick={(event) => {
                  event.preventDefault();
                  void downloadCsv();
                }}
              >
                <i className="flex">
                  <IconDownload className="size-4" />
                </i>
                <span className="font-semibold">
                  {t("forms.submissions.downloadCsv")}
                </span>
              </a>
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="px-8 pt-5">
          <ErrorPanel onRetry={() => void refetch()} />
        </div>
      ) : isLoading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState filter={filter} formId={form.id} />
      ) : (
        <SubmissionsTable
          rows={rows}
          questions={questions}
          selected={selected}
          onToggle={toggle}
          onToggleAll={() =>
            setSelected(
              selected.length === rows.length ? [] : rows.map((row) => row.id),
            )
          }
          onOpen={setOpen}
          onDelete={setConfirm}
        />
      )}

      {data?.hasMore || page > 0 ? (
        <div className="flex items-center justify-end gap-2 px-8 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            {t("forms.submissions.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!data?.hasMore}
            onClick={() => setPage(page + 1)}
          >
            {t("forms.submissions.next")}
          </Button>
        </div>
      ) : null}

      <SubmissionModal
        submission={open}
        questions={questions}
        onClose={() => setOpen(null)}
      />
      <ConfirmDeleteDialog
        open={confirm !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={
          confirm && confirm.length > 1
            ? t("forms.submissions.confirmDeleteMany")
            : t("forms.submissions.confirmDeleteOne")
        }
        description={t("forms.submissions.confirmDeleteBody")}
        onConfirm={() => confirm && deleteRows(confirm)}
      />
    </div>
  );
}
