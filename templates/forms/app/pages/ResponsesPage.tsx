import { useMemo, useState } from "react";
import { useParams, Link } from "react-router";
import { format } from "date-fns";
import {
  IconArrowLeft,
  IconDownload,
  IconRefresh,
  IconSearch,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useForm } from "@/hooks/use-forms";
import { useFormResponses } from "@/hooks/use-responses";
import type { FormField } from "@shared/types";

type SortKey = "_submitted" | string; // string = field id
type SortDir = "asc" | "desc";

function valueAsString(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
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
  const { id } = useParams<{ id: string }>();
  const { data: form } = useForm(id!);
  const { data, isLoading, error, refetch } = useFormResponses(id!);

  const responses = data?.responses || [];
  const fields: FormField[] = data?.fields || form?.fields || [];
  const total = data?.total ?? 0;

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("_submitted");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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
      rows = rows.filter((r) => {
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
      } else {
        cmp = compareValues(a.data[sortKey], b.data[sortKey]);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [responses, fields, search, sortKey, sortDir]);

  function exportCsv() {
    if (!fields.length || !filteredSorted.length) return;
    const headers = ["Submitted At", ...fields.map((f) => f.label)];
    const rows = filteredSorted.map((r) => [
      r.submittedAt,
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

  if (error && !responses) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">
          Failed to load responses
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <IconRefresh className="h-3.5 w-3.5" />
          Retry
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
              <span className="hidden sm:inline">Back to Builder</span>
              <span className="sm:hidden">Back</span>
            </Link>
          </Button>
          <span className="text-sm font-medium truncate hidden sm:block">
            {form?.title}
          </span>
          <Badge variant="secondary" className="text-xs shrink-0">
            {search.trim() && filteredSorted.length !== total
              ? `${filteredSorted.length} of ${total}`
              : `${total} response${total !== 1 ? "s" : ""}`}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {responses.length > 0 ? (
            <div className="relative hidden sm:block">
              <IconSearch className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter responses..."
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
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">Export</span>
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
              placeholder="Filter responses..."
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
      ) : null}

      {/* Table */}
      {responses.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-20">
          <h3 className="font-medium mb-1">No responses yet</h3>
          <p className="text-sm text-muted-foreground">
            Share your form to start collecting responses
          </p>
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-20">
          <h3 className="font-medium mb-1">No matches</h3>
          <p className="text-sm text-muted-foreground">
            No responses contain "{search}"
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="min-w-max">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    #
                  </th>
                  <SortableHeader
                    label="Submitted"
                    active={sortKey === "_submitted"}
                    dir={sortDir}
                    onClick={() => toggleSort("_submitted")}
                  />
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
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(response.submittedAt), "MMM d, h:mm a")}
                    </td>
                    {fields.map((f) => {
                      const val = response.data[f.id];
                      const display =
                        val === undefined || val === null || val === ""
                          ? "-"
                          : valueAsString(val);
                      return (
                        <td
                          key={f.id}
                          className="px-4 py-2.5 text-xs max-w-[200px] truncate"
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
  const { label, active, dir, onClick } = props;
  const Icon = !active
    ? IconArrowsSort
    : dir === "asc"
      ? IconArrowUp
      : IconArrowDown;
  return (
    <th
      scope="col"
      className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 cursor-pointer hover:text-foreground",
          active && "text-foreground",
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className="h-3 w-3 opacity-60" />
      </button>
    </th>
  );
}
