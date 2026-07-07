import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  IconBook,
  IconCheck,
  IconFilter,
  IconSearch,
  IconTable,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import {
  type CanonicalPreviewData,
  CanonicalPreviewSheet,
} from "@/components/brain/CanonicalPreviewSheet";
import {
  EmptyActionState,
  LoadingRows,
  PageHeader,
  StatusBadge,
} from "@/components/brain/Surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  type KnowledgeResponse,
  type KnowledgeRow,
  formatPercent,
  statusLabel,
} from "@/lib/brain";

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
  const t = useT();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const status = params.get("status") ?? "all";
  const type = params.get("type") ?? "all";
  const [previewOpen, setPreviewOpen] = useState(false);
  const [canonicalPreview, setCanonicalPreview] =
    useState<CanonicalPreviewData | null>(null);
  const [previewRow, setPreviewRow] = useState<KnowledgeRow | null>(null);
  const [previewOperation, setPreviewOperation] = useState<
    "publish" | "unpublish"
  >("publish");

  const knowledgeQuery = useActionQuery<KnowledgeResponse>(
    "search-knowledge" as any,
    {
      query: query || undefined,
      status: status === "all" ? undefined : status,
      sourceType: type === "all" ? undefined : type,
    } as any,
  );
  const setCanonical = useActionMutation<
    unknown,
    { knowledgeId: string; published: boolean }
  >("set-knowledge-canonical" as any);
  const previewCanonical = useActionMutation<
    { preview: CanonicalPreviewData },
    { knowledgeId: string; operation: "publish" | "unpublish" }
  >("preview-canonical-resource" as any);

  const actionRows =
    knowledgeQuery.data?.rows ?? knowledgeQuery.data?.knowledge;
  const rows = actionRows ?? [];
  const hasActiveFilters = Boolean(query) || status !== "all" || type !== "all";

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

  async function openCanonicalPreview(row: KnowledgeRow) {
    const operation = row.publishedResourcePath ? "unpublish" : "publish";
    const result = await previewCanonical.mutateAsync({
      knowledgeId: row.id,
      operation,
    });
    setCanonicalPreview(result.preview);
    setPreviewRow(row);
    setPreviewOperation(operation);
    setPreviewOpen(true);
  }

  async function confirmCanonicalChange() {
    if (!previewRow) return;
    await setCanonical.mutateAsync({
      knowledgeId: previewRow.id,
      published: previewOperation === "publish",
    });
    setPreviewOpen(false);
    setCanonicalPreview(null);
    setPreviewRow(null);
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow={t("navigation.knowledge")}
        title={t("knowledge.title")}
        description={t("knowledge.description")}
        actions={
          <Badge variant="outline" className="gap-2">
            <IconTable className="size-4" />
            {t("knowledge.rows", {
              count: filteredRows.length.toLocaleString(),
            })}
          </Badge>
        }
      />

      <div className="grid gap-5 p-5 lg:p-7">
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => updateParam("q", event.target.value)}
                placeholder={t("knowledge.searchPlaceholder")}
                className="ps-9"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={status}
                onValueChange={(value) => updateParam("status", value)}
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder={t("searchPage.status")} />
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
                  <SelectValue placeholder={t("sources.sourceType")} />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "all" ? t("searchPage.allTypes") : option}
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
                  <TableHead>{t("navigation.knowledge")}</TableHead>
                  <TableHead>{t("searchPage.source")}</TableHead>
                  <TableHead>{t("searchPage.status")}</TableHead>
                  <TableHead>{t("knowledge.companyContext")}</TableHead>
                  <TableHead className="text-end">
                    {t("searchPage.confidence")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("knowledge.cites")}
                  </TableHead>
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
                          {row.summary ?? row.body ?? t("knowledge.noSummary")}
                        </p>
                        {row.owner ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {t("knowledge.owner", { owner: row.owner })}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {row.sourceName ??
                          row.sourceId ??
                          t("searchPage.source")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.sourceType ?? t("knowledge.source")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <CanonicalControl
                        row={row}
                        pending={
                          setCanonical.isPending || previewCanonical.isPending
                        }
                        onPreview={() => void openCanonicalPreview(row)}
                      />
                    </TableCell>
                    <TableCell className="text-end">
                      {typeof row.confidence === "number"
                        ? formatPercent(row.confidence)
                        : t("knowledge.notApplicable")}
                    </TableCell>
                    <TableCell className="text-end">
                      {row.citations ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ) : (
          <EmptyActionState
            title={
              hasActiveFilters
                ? t("searchPage.noMatchesTitle")
                : t("knowledge.emptyTitle")
            }
            detail={
              hasActiveFilters
                ? t("knowledge.emptyFilteredDetail")
                : t("knowledge.emptyDetail")
            }
          />
        )}

        {setCanonical.isError || previewCanonical.isError ? (
          <EmptyActionState
            title={t("knowledge.updateFailedTitle")}
            detail={
              setCanonical.error?.message ??
              previewCanonical.error?.message ??
              t("knowledge.updateFailedDetail")
            }
          />
        ) : null}

        {knowledgeQuery.isError ? (
          <EmptyActionState
            title={t("knowledge.waitingOnSearch")}
            detail={t("knowledge.waitingOnSearchDetail")}
          />
        ) : null}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconFilter className="size-4" />
          {t("knowledge.viewStateMirrored")}
        </div>
      </div>
      <CanonicalPreviewSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        preview={canonicalPreview}
        operation={previewOperation}
        loading={previewCanonical.isPending || setCanonical.isPending}
        error={previewCanonical.error?.message ?? null}
        primaryLabel={
          previewOperation === "publish"
            ? t("knowledge.publishCompanyContext")
            : t("knowledge.unpublishCompanyContext")
        }
        primaryDisabled={!previewRow || setCanonical.isPending}
        onPrimaryAction={() => void confirmCanonicalChange()}
      />
    </div>
  );
}

function CanonicalControl({
  row,
  pending,
  onPreview,
}: {
  row: KnowledgeRow;
  pending: boolean;
  onPreview: () => void;
}) {
  const t = useT();
  const isPublished = Boolean(row.publishedResourcePath);
  const canPublish = row.status === "published";

  if (!canPublish && !isPublished) {
    return (
      <Badge variant="outline" className="gap-1.5 text-muted-foreground">
        <IconX className="size-3" />
        {t("knowledge.notEligible")}
      </Badge>
    );
  }

  return (
    <Button
      size="sm"
      variant={isPublished ? "secondary" : "outline"}
      disabled={pending}
      onClick={onPreview}
      title={
        isPublished
          ? row.publishedResourcePath || t("knowledge.publishedToContext")
          : t("knowledge.publishToContextTitle")
      }
    >
      {isPublished ? (
        <IconCheck className="size-4" />
      ) : (
        <IconBook className="size-4" />
      )}
      {isPublished ? t("knowledge.published") : t("knowledge.publish")}
    </Button>
  );
}
