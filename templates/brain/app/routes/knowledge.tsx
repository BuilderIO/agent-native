import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useActionQuery } from "@agent-native/core/client";
import { IconFilter, IconSearch, IconTable } from "@tabler/icons-react";
import {
  type KnowledgeResponse,
  formatPercent,
  sampleKnowledgeRows,
  statusLabel,
} from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyActionState,
  LoadingRows,
  PageHeader,
  StatusBadge,
} from "@/components/brain/Surface";

const statusOptions = [
  "all",
  "published",
  "approved",
  "needs_review",
  "draft",
  "stale",
  "redacted",
  "archived",
];
const typeOptions = [
  "all",
  "manual",
  "generic",
  "slack",
  "granola",
  "Docs",
  "Notion",
  "GitHub",
  "Drive",
];

export default function KnowledgeRoute() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const status = params.get("status") ?? "all";
  const type = params.get("type") ?? "all";

  const knowledgeQuery = useActionQuery<KnowledgeResponse>(
    "search-knowledge" as any,
    {
      query: query || undefined,
      status: status === "all" ? undefined : status,
      sourceType: type === "all" ? undefined : type,
    } as any,
  );

  const actionRows =
    knowledgeQuery.data?.rows ?? knowledgeQuery.data?.knowledge;
  const rows = actionRows?.length ? actionRows : sampleKnowledgeRows;

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesQuery = query
        ? `${row.title} ${row.summary ?? row.body ?? ""} ${row.sourceName ?? row.sourceId ?? ""} ${row.topic ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase())
        : true;
      const matchesStatus = status === "all" ? true : row.status === status;
      const matchesType = type === "all" ? true : row.sourceType === type;
      return matchesQuery && matchesStatus && matchesType;
    });
  }, [query, rows, status, type]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow="Knowledge"
        title="Cited company knowledge"
        description="Browse approved, stale, and review-bound memories with the source and confidence signal visible."
        actions={
          <Badge variant="outline" className="gap-2">
            <IconTable className="size-4" />
            {filteredRows.length} rows
          </Badge>
        }
      />

      <div className="grid gap-5 p-5 lg:p-7">
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => updateParam("q", event.target.value)}
                placeholder="Search memories, topics, source names..."
                className="pl-9"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={status}
                onValueChange={(value) => updateParam("status", value)}
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {statusLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={type}
                onValueChange={(value) => updateParam("type", value)}
              >
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Source type" />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "all" ? "All types" : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {knowledgeQuery.isLoading ? (
          <LoadingRows rows={5} />
        ) : filteredRows.length ? (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Memory</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead className="text-right">Cites</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-[320px]">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{row.title}</p>
                          {row.topic ? (
                            <Badge variant="secondary">{row.topic}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                          {row.summary ?? row.body ?? "No summary yet."}
                        </p>
                        {row.owner ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Owner: {row.owner}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {row.sourceName ?? row.sourceId ?? "Source"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.sourceType ?? "source"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {typeof row.confidence === "number"
                        ? formatPercent(row.confidence)
                        : "n/a"}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.citations ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ) : (
          <EmptyActionState
            title="No knowledge matches these filters"
            detail="Clear the search or filters to broaden the memory set."
          />
        )}

        {knowledgeQuery.isError ? (
          <EmptyActionState
            title="Waiting on search-knowledge"
            detail="The route is wired to the intended search-knowledge action and is using scaffold rows until it is available."
          />
        ) : null}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconFilter className="size-4" />
          View state is mirrored to application-state as query, status, and
          source type filters.
        </div>
      </div>
    </div>
  );
}
