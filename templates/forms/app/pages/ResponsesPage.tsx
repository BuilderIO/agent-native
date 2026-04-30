import { useParams, Link } from "react-router";
import { format } from "date-fns";
import { IconArrowLeft, IconDownload, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "@/hooks/use-forms";
import { useFormResponses } from "@/hooks/use-responses";
import type { FormField } from "@shared/types";

export function ResponsesPage() {
  const { id } = useParams<{ id: string }>();
  const { data: form } = useForm(id!);
  const { data, isLoading, error, refetch } = useFormResponses(id!);

  const responses = data?.responses || [];
  const fields: FormField[] = data?.fields || form?.fields || [];
  const total = data?.total ?? 0;

  function exportCsv() {
    if (!fields.length || !responses.length) return;
    const headers = ["Submitted At", ...fields.map((f) => f.label)];
    const rows = responses.map((r) => [
      r.submittedAt,
      ...fields.map((f) => {
        const val = r.data[f.id];
        if (Array.isArray(val)) return val.join(", ");
        return String(val ?? "");
      }),
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
            {total} response{total !== 1 ? "s" : ""}
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs shrink-0"
          onClick={exportCsv}
          disabled={responses.length === 0}
        >
          <IconDownload className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Export CSV</span>
          <span className="sm:hidden">Export</span>
        </Button>
      </div>

      {/* Table */}
      {responses.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-20">
          <h3 className="font-medium mb-1">No responses yet</h3>
          <p className="text-sm text-muted-foreground">
            Share your form to start collecting responses
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="min-w-max">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    Submitted
                  </th>
                  {fields.map((f) => (
                    <th
                      key={f.id}
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responses.map((response, idx) => (
                  <tr
                    key={response.id}
                    className="border-b border-border hover:bg-muted/20"
                  >
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {total - idx}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(response.submittedAt), "MMM d, h:mm a")}
                    </td>
                    {fields.map((f) => {
                      const val = response.data[f.id];
                      let display: string;
                      if (val === undefined || val === null) {
                        display = "-";
                      } else if (Array.isArray(val)) {
                        display = val.join(", ");
                      } else {
                        display = String(val);
                      }
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
        </ScrollArea>
      )}
    </div>
  );
}
