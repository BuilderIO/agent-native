import { useFormatters, useT } from "@agent-native/core/client";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import type { FormField } from "@shared/types";
import {
  IconArrowLeft,
  IconDownload,
  IconRefresh,
  IconSearch,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
} from "@tabler/icons-react";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { useParams, Link } from "react-router";

import { useForm } from "@/hooks/use-forms";
import { useFormResponses } from "@/hooks/use-responses";
import { normalizeFields } from "@/lib/normalize-fields";
import { cn } from "@/lib/utils";

type SortKey = "_submitted" | string; // string = field id
type SortDir = "asc" | "desc";

function valueAsString(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
}

/** Drop the protocol for a cleaner table cell; the full URL stays the link href. */
function formatPageUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/**
 * Only http(s) URLs are safe to use as an anchor href. Page URLs arrive from
 * client `_meta` and could be spoofed by a direct POST, so reject other schemes
 * (e.g. `javascript:`) to avoid a self-XSS when the owner clicks the cell.
 */
function safeHttpUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Friendly label for the client-surface token forwarded by feedback embeds. */
function formatClientSurface(surface: string): string {
  switch (surface) {
    case "electron":
      return "Desktop (Electron)";
    case "tauri":
      return "Desktop (Tauri)";
    case "web":
      return "Web";
    default:
      return surface;
  }
}

function compareValues(a: unknown, b: unknown): number {
  // Empty values sort last regardless of direction.
  const aEmpty = a === undefined || a === null || a === "";
  const bEmpty = b === undefined || b === null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const aNum = typeof a === "number" ? a : Number(a);
  const bNum = typeof b === "number" ? b : Number(b);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && a !== "" && b !== "") {
    return aNum - bNum;
  }
  return valueAsString(a).localeCompare(valueAsString(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function ResponsesPage() {
  const t = useT();
  const { formatDate, formatNumber } = useFormatters();
  const { id } = useParams<{ id: string }>();
  const { data: form } = useForm(id!);
  const { data, isLoading, error, refetch } = useFormResponses(id!);

  const responses = data?.responses || [];
  const fields: FormField[] = useMemo(
    () => normalizeFields(data?.fields || form?.fields),
    [data?.fields, form?.fields],
  );
  const total = data?.total ?? 0;

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("_submitted");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const hasSubmitterEmail = useMemo(
    () => responses.some((r: any) => valueAsString(r.submitterEmail).trim()),
    [responses],
  );
  const hasPageUrl = useMemo(
    () => responses.some((r: any) => valueAsString(r.pageUrl).trim()),
    [responses],
  );
  const hasClientSurface = useMemo(
    () => responses.some((r: any) => valueAsString(r.clientSurface).trim()),
    [responses],
  );
  const responseTableMinWidth =
    64 +
    160 +
    (hasSubmitterEmail ? 224 : 0) +
    (hasPageUrl ? 256 : 0) +
    (hasClientSurface ? 160 : 0) +
    Math.max(fields.length, 1) * 320;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "_submitted" ? "desc" : "asc");
    }
  }

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = responses;
    if (q) {
      rows = rows.filter((r: any) => {
        if (valueAsString(r.submitterEmail).toLowerCase().includes(q)) {
          return true;
        }
        if (valueAsString(r.pageUrl).toLowerCase().includes(q)) {
          return true;
        }
        if (
          formatClientSurface(valueAsString(r.clientSurface))
            .toLowerCase()
            .includes(q)
        ) {
          return true;
        }
        for (const f of fields) {
          if (valueAsString(r.data[f.id]).toLowerCase().includes(q))
            return true;
        }
        return false;
      });
    }
    const sorted = [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === "_submitted") {
        cmp =
          new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
      } else if (sortKey === "_email") {
        cmp = compareValues(a.submitterEmail, b.submitterEmail);
      } else if (sortKey === "_page") {
        cmp = compareValues(a.pageUrl, b.pageUrl);
      } else if (sortKey === "_source") {
        cmp = compareValues(a.clientSurface, b.clientSurface);
      } else {
        cmp = compareValues(a.data[sortKey], b.data[sortKey]);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [responses, fields, search, sortKey, sortDir]);

  function exportCsv() {
    if (!fields.length || !filteredSorted.length) return;
    const headers = [
      "Submitted At",
      ...(hasSubmitterEmail ? ["Submitter Email"] : []),
      ...(hasPageUrl ? ["Page URL"] : []),
      ...(hasClientSurface ? ["Source"] : []),
      ...fields.map((f) => f.label),
    ];
    const rows = filteredSorted.map((r) => [
      r.submittedAt,
      ...(hasSubmitterEmail ? [valueAsString(r.submitterEmail)] : []),
      ...(hasPageUrl ? [valueAsString(r.pageUrl)] : []),
      ...(hasClientSurface
        ? [
            valueAsString(r.clientSurface)
              ? formatClientSurface(valueAsString(r.clientSurface))
              : "",
          ]
        : []),
      ...fields.map((f) => valueAsString(r.data[f.id])),
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form?.title || "responses"}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between border-b border-border pl-12 pr-2 sm:px-4 md:pl-4 h-14 shrink-0 gap-2 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-4 w-40 hidden sm:block" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md shrink-0" />
        </div>
        <div className="flex-1 overflow-auto">
          <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex gap-6">
            <Skeleton className="h-3 w-6" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-24" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-border px-4 py-2.5 flex gap-6 items-center"
            >
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !responses.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">
          {t("responses.failedLoad")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <IconRefresh className="h-3.5 w-3.5" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pl-12 pr-2 sm:px-4 md:pl-4 h-14 shrink-0 gap-2 min-w-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="gap-1.5 shrink-0"
          >
            <Link to={`/forms/${id}`}>
              <IconArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {t("responses.backToBuilder")}
              </span>
              <span className="sm:hidden">{t("common.back")}</span>
            </Link>
          </Button>
          <span className="text-sm font-medium truncate hidden sm:block">
            {form?.title}
          </span>
          <Badge variant="secondary" className="text-xs shrink-0">
            {search.trim() && filteredSorted.length !== total
              ? t("responses.filteredCount", {
                  count: formatNumber(filteredSorted.length),
                  total: formatNumber(total),
                })
              : t("responses.totalCount", {
                  count: total,
                  formattedCount: formatNumber(total),
                })}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {responses.length > 0 ? (
            <div className="relative hidden sm:block">
              <IconSearch className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("responses.filterPlaceholder")}
                className="h-8 pl-7 w-48 text-xs"
              />
            </div>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs shrink-0"
            onClick={exportCsv}
            disabled={filteredSorted.length === 0}
          >
            <IconDownload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("responses.exportCsv")}</span>
            <span className="sm:hidden">{t("responses.export")}</span>
          </Button>
        </div>
      </div>

      {/* Mobile filter row */}
      {responses.length > 0 ? (
        <div className="border-b border-border px-3 py-2 sm:hidden">
          <div className="relative">
            <IconSearch className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("responses.filterPlaceholder")}
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
      ) : null}

      {/* Table */}
      {responses.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-20">
          <h3 className="font-medium mb-1">{t("responses.emptyTitle")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("responses.emptyDescription")}
          </p>
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-20">
          <h3 className="font-medium mb-1">{t("responses.noMatchesTitle")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("responses.noMatchesDescription", { search })}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-w-0 overflow-auto overscroll-x-contain">
          <div className="min-w-full">
            <table
              className="min-w-full table-fixed text-sm"
              style={{ minWidth: responseTableMinWidth }}
            >
              <colgroup>
                <col className="w-16" />
                <col className="w-40" />
                {hasSubmitterEmail ? <col className="w-56" /> : null}
                {hasPageUrl ? <col className="w-64" /> : null}
                {hasClientSurface ? <col className="w-40" /> : null}
                {fields.map((f) => (
                  <col key={f.id} className="w-80" />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th
                    scope="col"
                    className="min-w-16 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    #
                  </th>
                  <SortableHeader
                    label={t("responses.submitted")}
                    active={sortKey === "_submitted"}
                    dir={sortDir}
                    onClick={() => toggleSort("_submitted")}
                  />
                  {hasSubmitterEmail ? (
                    <SortableHeader
                      label={t("responses.email")}
                      active={sortKey === "_email"}
                      dir={sortDir}
                      onClick={() => toggleSort("_email")}
                    />
                  ) : null}
                  {hasPageUrl ? (
                    <SortableHeader
                      label={t("responses.page")}
                      active={sortKey === "_page"}
                      dir={sortDir}
                      onClick={() => toggleSort("_page")}
                    />
                  ) : null}
                  {hasClientSurface ? (
                    <SortableHeader
                      label={t("responses.source")}
                      active={sortKey === "_source"}
                      dir={sortDir}
                      onClick={() => toggleSort("_source")}
                    />
                  ) : null}
                  {fields.map((f) => (
                    <SortableHeader
                      key={f.id}
                      label={f.label}
                      active={sortKey === f.id}
                      dir={sortDir}
                      onClick={() => toggleSort(f.id)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((response, idx) => (
                  <tr
                    key={response.id}
                    className="border-b border-border hover:bg-muted/20"
                  >
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {filteredSorted.length - idx}
                    </td>
                    <td className="min-w-36 px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(response.submittedAt, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    {hasSubmitterEmail ? (
                      <td className="w-56 px-4 py-3 align-top text-xs text-muted-foreground whitespace-normal break-words">
                        {valueAsString(response.submitterEmail) || "-"}
                      </td>
                    ) : null}
                    {hasPageUrl ? (
                      <td className="w-64 px-4 py-3 align-top text-xs whitespace-normal break-words">
                        {(() => {
                          const raw = valueAsString(response.pageUrl);
                          if (!raw)
                            return (
                              <span className="text-muted-foreground">-</span>
                            );
                          const safe = safeHttpUrl(raw);
                          return safe ? (
                            <a
                              href={safe}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              title={raw}
                              className="text-primary hover:underline"
                            >
                              {formatPageUrl(raw)}
                            </a>
                          ) : (
                            <span title={raw} className="text-muted-foreground">
                              {formatPageUrl(raw)}
                            </span>
                          );
                        })()}
                      </td>
                    ) : null}
                    {hasClientSurface ? (
                      <td className="w-40 px-4 py-3 align-top text-xs whitespace-nowrap">
                        {(() => {
                          const surface = valueAsString(response.clientSurface);
                          if (!surface)
                            return (
                              <span className="text-muted-foreground">-</span>
                            );
                          const label = formatClientSurface(surface);
                          // Make desktop submissions pop; web stays muted text.
                          return surface === "web" ? (
                            <span className="text-muted-foreground">
                              {label}
                            </span>
                          ) : (
                            <Badge variant="secondary" className="font-normal">
                              {label}
                            </Badge>
                          );
                        })()}
                      </td>
                    ) : null}
                    {fields.map((f) => {
                      const val = response.data[f.id];
                      const display =
                        val === undefined || val === null || val === ""
                          ? "-"
                          : valueAsString(val);
                      return (
                        <td
                          key={f.id}
                          className="min-w-48 px-4 py-3 align-top text-xs leading-5 whitespace-pre-wrap break-words"
                          title={display}
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableHeader(props: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  const t = useT();
  const { label, active, dir, onClick } = props;
  const Icon = !active
    ? IconArrowsSort
    : dir === "asc"
      ? IconArrowUp
      : IconArrowDown;
  return (
    <th
      scope="col"
      className="min-w-40 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 cursor-pointer hover:text-foreground",
          active && "text-foreground",
        )}
        aria-label={t("responses.sortBy", { label })}
      >
        {label}
        <Icon className="h-3 w-3 opacity-60" />
      </button>
    </th>
  );
}
