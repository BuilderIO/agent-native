import { useActionQuery, useT } from "@agent-native/core/client";
import {
  IconBook2,
  IconCircleCheck,
  IconDatabase,
  IconExternalLink,
  IconFileText,
  IconInfoCircle,
  IconLink,
  IconQuote,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

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
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  type KnowledgeRow,
  type SearchEverythingResponse,
  type SearchEverythingResult,
  formatPercent,
  statusLabel,
} from "@/lib/brain";

const typeOptions = ["all", "knowledge", "capture", "source"];
const providerOptions = [
  "all",
  "slack",
  "granola",
  "github",
  "clips",
  "manual",
  "generic",
];
const statusOptions = [
  "all",
  "published",
  "draft",
  "redacted",
  "queued",
  "distilling",
  "distilled",
  "ignored",
  "active",
  "paused",
  "archived",
  "error",
];
const limitOptions = ["10", "25", "50", "100"];
const groupOrder = ["knowledge", "capture", "source"];

export default function SearchRoute() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const type = params.get("type") ?? "all";
  const provider = params.get("provider") ?? "all";
  const status = params.get("status") ?? "all";
  const limit = params.get("limit") ?? "25";

  const actionParams = useMemo(
    () => ({
      query: query.trim() || undefined,
      type: type === "all" ? undefined : type,
      provider: provider === "all" ? undefined : provider,
      status: status === "all" ? undefined : status,
      limit: Number.parseInt(limit, 10) || 25,
    }),
    [limit, provider, query, status, type],
  );

  const searchQuery = useActionQuery<SearchEverythingResponse>(
    "search-everything" as any,
    actionParams as any,
    { enabled: Boolean(query.trim()), retry: false },
  );

  const results = useMemo(
    () => filterResults(normalizeResults(searchQuery.data), provider, status),
    [provider, searchQuery.data, status],
  );
  const hasFilters =
    Boolean(query.trim()) ||
    type !== "all" ||
    provider !== "all" ||
    status !== "all";
  const groupedResults = useMemo(() => groupResults(results), [results]);
  const resultFacets = useMemo(
    () =>
      buildResultFacets(results, {
        type: t("searchPage.type"),
        source: t("searchPage.source"),
        status: t("searchPage.status"),
      }),
    [results, t],
  );
  const resultCount = results.length;

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === "all" || (key === "limit" && value === "25")) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setParams(next, { replace: true });
  }

  function clearFilters() {
    setParams(new URLSearchParams(), { replace: true });
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow={t("searchPage.eyebrow")}
        title={t("searchPage.title")}
        description={t("searchPage.description")}
        actions={
          <Badge variant="outline" className="gap-2">
            <IconSearch className="size-4" />
            {searchQuery.isFetching
              ? t("searchPage.searching")
              : t("searchPage.results", { count: resultCount })}
          </Badge>
        }
      />

      <div className="grid gap-5 p-5 lg:p-7">
        <Card>
          <CardContent className="grid gap-3 p-4">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => updateParam("q", event.target.value)}
                placeholder={t("searchPage.searchPlaceholder")}
                className="h-11 ps-9 text-base"
                autoFocus
              />
            </div>

            <div className="brain-search-filter-grid grid gap-2">
              <Select
                value={type}
                onValueChange={(value) => updateParam("type", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("searchPage.type")} />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "all"
                        ? t("searchPage.allTypes")
                        : statusLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={provider}
                onValueChange={(value) => updateParam("provider", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("searchPage.source")} />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "all"
                        ? t("searchPage.allSources")
                        : displayLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={status}
                onValueChange={(value) => updateParam("status", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("searchPage.status")} />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "all"
                        ? t("searchPage.allStatuses")
                        : statusLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={limit}
                onValueChange={(value) => updateParam("limit", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("searchPage.limit")} />
                </SelectTrigger>
                <SelectContent>
                  {limitOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                onClick={clearFilters}
                disabled={!hasFilters && limit === "25"}
              >
                <IconRefresh className="size-4" />
                {t("searchPage.reset")}
              </Button>
            </div>

            {results.length ? (
              <ResultFacets
                facets={resultFacets}
                onSelect={(key, value) => updateParam(key, value)}
              />
            ) : null}
          </CardContent>
        </Card>

        {searchQuery.isLoading ? (
          <LoadingRows rows={5} />
        ) : searchQuery.isError ? (
          <EmptyActionState
            title={t("searchPage.unavailableTitle")}
            detail={t("searchPage.unavailableDetail")}
          />
        ) : results.length ? (
          <div className="grid gap-5">
            {groupedResults.map(([group, groupResults]) => (
              <section
                key={group}
                className="overflow-hidden rounded-md border border-border bg-card"
              >
                <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/35 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <ResultTypeIcon type={group} />
                    <h2 className="truncate text-sm font-semibold capitalize">
                      {statusLabel(group)}
                    </h2>
                  </div>
                  <Badge variant="secondary">{groupResults.length}</Badge>
                </div>
                <div className="divide-y divide-border">
                  {groupResults.map((result) => (
                    <SearchResultRow
                      key={`${result.type}-${result.id}`}
                      result={result}
                      query={query}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <EmptyActionState
            title={
              hasFilters
                ? t("searchPage.noMatchesTitle")
                : t("searchPage.startTitle")
            }
            detail={
              hasFilters
                ? t("searchPage.noMatchesDetail")
                : t("searchPage.startDetail")
            }
          />
        )}
      </div>
    </div>
  );
}

function SearchResultRow({
  result,
  query,
}: {
  result: SearchEverythingResult;
  query: string;
}) {
  const t = useT();
  const body = result.snippet ?? result.summary ?? t("searchPage.noExcerpt");
  const whyMatched = explainMatch(result, query);
  const sourceLabel =
    result.sourceTitle ??
    result.source?.title ??
    result.sourceProvider ??
    result.provider ??
    t("searchPage.companyKnowledge");
  const internalHref = internalResultHref(result);
  const sourceUrl =
    result.url ?? result.sourceUrl ?? result.citation?.sourceUrl ?? null;
  const sourceProvider =
    result.sourceProvider ?? result.provider ?? result.source?.provider ?? null;

  return (
    <article className="grid gap-3 p-4 transition-colors hover:bg-muted/25">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ResultTypeBadge type={result.type} />
            {result.status ? <StatusBadge status={result.status} /> : null}
            {sourceProvider ? (
              <Badge variant="secondary" className="capitalize">
                {displayLabel(sourceProvider)}
              </Badge>
            ) : null}
          </div>
          <h3 className="mt-3 text-base font-semibold leading-6 text-foreground">
            {result.title || t("searchPage.untitledResult")}
          </h3>
          <p className="mt-2 line-clamp-3 max-w-4xl text-sm leading-6 text-muted-foreground">
            {body}
          </p>
          {whyMatched ? (
            <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <IconCircleCheck className="size-3.5 shrink-0 text-foreground" />
              <span className="truncate">{whyMatched}</span>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          {typeof result.confidence === "number" ? (
            <Badge variant="outline">
              {t("searchPage.confidence")} {formatPercent(result.confidence)}
            </Badge>
          ) : null}
          {typeof result.score === "number" ? (
            <Badge variant="outline">
              {t("searchPage.score")} {formatScore(result.score)}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate">
            {t("searchPage.citation")}: {sourceLabel}
          </span>
          {result.updatedAt ? (
            <span>
              {t("searchPage.updated")} {result.updatedAt}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchResultDetails result={result} query={query} />
          {internalHref ? (
            <Button asChild variant="ghost" size="sm">
              <Link to={internalHref}>{t("searchPage.viewInBrain")}</Link>
            </Button>
          ) : null}
          {sourceUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={sourceUrl} target="_blank" rel="noreferrer">
                <IconExternalLink className="size-4" />
                {t("searchPage.openSource")}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SearchResultDetails({
  result,
  query,
}: {
  result: SearchEverythingResult;
  query: string;
}) {
  const t = useT();
  const body = result.snippet ?? result.summary ?? t("searchPage.noExcerpt");
  const summary = result.summary ?? result.snippet ?? null;
  const sourceProvider =
    result.sourceProvider ?? result.provider ?? result.source?.provider ?? null;
  const sourceTitle =
    result.sourceTitle ??
    result.source?.title ??
    result.citation?.captureTitle ??
    t("searchPage.companyKnowledge");
  const sourceUrl =
    result.url ?? result.sourceUrl ?? result.citation?.sourceUrl ?? null;
  const internalHref = internalResultHref(result);
  const quote = result.citation?.quote ?? null;
  const whyMatched = explainMatch(result, query);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <IconInfoCircle className="size-4" />
          {t("searchPage.details")}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full max-w-full flex-col overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-5 py-5 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <ResultTypeBadge type={result.type} />
            {result.status ? <StatusBadge status={result.status} /> : null}
            {sourceProvider ? (
              <Badge variant="secondary" className="capitalize">
                {displayLabel(sourceProvider)}
              </Badge>
            ) : null}
          </div>
          <SheetTitle className="text-start text-xl leading-7">
            {result.title || t("searchPage.untitledResult")}
          </SheetTitle>
          <SheetDescription className="text-start leading-6">
            {body}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 px-5 py-5">
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t("searchPage.whyMatched")}
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {whyMatched ?? t("searchPage.matchedIndex")}
            </p>
          </section>

          <Separator />

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("searchPage.summary")}
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {summary ?? t("searchPage.noSummary")}
            </p>
          </section>

          <section className="grid gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <IconQuote className="size-4" />
              {t("searchPage.citationQuote")}
            </h3>
            {quote ? (
              <blockquote className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
                {quote}
              </blockquote>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                {t("searchPage.noCitationQuote")}
              </p>
            )}
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("searchPage.details")}
            </h3>
            <dl className="grid gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
              <DetailItem label={t("searchPage.source")} value={sourceTitle} />
              <DetailItem
                label={t("searchPage.provider")}
                value={sourceProvider ? displayLabel(sourceProvider) : null}
              />
              <DetailItem
                label={t("searchPage.status")}
                value={result.status ? statusLabel(result.status) : null}
              />
              <DetailItem
                label={t("searchPage.confidence")}
                value={
                  typeof result.confidence === "number"
                    ? formatPercent(result.confidence)
                    : null
                }
              />
              <DetailItem
                label={t("searchPage.score")}
                value={
                  typeof result.score === "number"
                    ? formatScore(result.score)
                    : null
                }
              />
              <DetailItem
                label={t("searchPage.updated")}
                value={formatDateTime(result.updatedAt)}
              />
            </dl>
          </section>

          <section className="grid gap-2">
            {sourceUrl ? (
              <Button asChild variant="outline" className="justify-start">
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  <IconExternalLink className="size-4" />
                  <span className="truncate">
                    {t("searchPage.openSourceUrl")}
                  </span>
                </a>
              </Button>
            ) : null}
            {internalHref ? (
              <Button asChild variant="ghost" className="justify-start">
                <Link to={internalHref}>
                  <IconLink className="size-4" />
                  <span className="truncate">
                    {t("searchPage.openBrainRecord")}
                  </span>
                </Link>
              </Button>
            ) : result.source?.id ? (
              <Button asChild variant="ghost" className="justify-start">
                <Link to={`/sources?sourceId=${result.source.id}`}>
                  <IconLink className="size-4" />
                  <span className="truncate">
                    {t("searchPage.openRelatedSource")}
                  </span>
                </Link>
              </Button>
            ) : null}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  const t = useT();

  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-foreground">
        {value || t("searchPage.notAvailable")}
      </dd>
    </div>
  );
}

function ResultFacets({
  facets,
  onSelect,
}: {
  facets: ResultFacetGroup[];
  onSelect: (key: string, value: string) => void;
}) {
  const t = useT();
  const visibleFacets = facets.filter((facet) => facet.items.length);
  if (!visibleFacets.length) return null;

  return (
    <div className="grid gap-2 border-t border-border pt-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">
        {t("searchPage.inTheseResults")}
      </div>
      <div className="flex flex-wrap gap-2">
        {visibleFacets.flatMap((facet) =>
          facet.items.slice(0, 4).map((item) => (
            <button
              key={`${facet.key}-${item.value}`}
              type="button"
              onClick={() => onSelect(facet.key, item.value)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">
                {facet.label}: {item.label}
              </span>
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                {item.count}
              </Badge>
            </button>
          )),
        )}
      </div>
    </div>
  );
}

function ResultTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <ResultTypeIcon type={type} />
      {statusLabel(type)}
    </Badge>
  );
}

function ResultTypeIcon({ type }: { type: string }) {
  const normalized = type.toLowerCase();
  if (normalized === "source") return <IconDatabase className="size-3.5" />;
  if (normalized === "capture") return <IconFileText className="size-3.5" />;
  return <IconBook2 className="size-3.5" />;
}

type ResultFacetGroup = {
  key: "type" | "provider" | "status";
  label: string;
  items: Array<{ value: string; label: string; count: number }>;
};

function buildResultFacets(
  results: SearchEverythingResult[],
  labels: { type: string; source: string; status: string },
): ResultFacetGroup[] {
  return [
    {
      key: "type",
      label: labels.type,
      items: countFacet(results, (result) => result.type || "knowledge"),
    },
    {
      key: "provider",
      label: labels.source,
      items: countFacet(
        results,
        (result) =>
          result.sourceProvider ?? result.provider ?? result.source?.provider,
      ),
    },
    {
      key: "status",
      label: labels.status,
      items: countFacet(results, (result) => result.status),
    },
  ];
}

function countFacet(
  results: SearchEverythingResult[],
  getValue: (result: SearchEverythingResult) => string | null | undefined,
) {
  const counts = new Map<string, number>();
  for (const result of results) {
    const value = getValue(result)?.toLowerCase();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      label: displayLabel(value),
      count,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );
}

function normalizeResults(
  data: SearchEverythingResponse | undefined,
): SearchEverythingResult[] {
  const direct = data?.results ?? data?.items ?? data?.rows;
  if (direct?.length) return direct.map(normalizeResult);
  if (data?.knowledge?.length) return data.knowledge.map(knowledgeToResult);
  return [];
}

function normalizeResult(
  result: SearchEverythingResult,
): SearchEverythingResult {
  return {
    id: result.id,
    type: result.type ?? "knowledge",
    title: result.title || "",
    snippet: result.snippet,
    summary: result.summary,
    provider: result.provider,
    source: result.source,
    sourceTitle: result.sourceTitle ?? result.source?.title,
    sourceProvider:
      result.sourceProvider ?? result.provider ?? result.source?.provider,
    sourceUrl: result.sourceUrl,
    citation: result.citation,
    status: result.status,
    url: result.url ?? result.sourceUrl ?? result.citation?.sourceUrl,
    confidence: result.confidence,
    updatedAt: result.updatedAt,
    score: result.score,
  };
}

function knowledgeToResult(row: KnowledgeRow): SearchEverythingResult {
  return {
    id: row.id,
    type: "knowledge",
    title: row.title,
    snippet: row.summary ?? row.body,
    summary: row.summary,
    sourceTitle: row.sourceName ?? row.sourceId,
    sourceProvider: row.sourceType,
    status: row.status,
    confidence: row.confidence,
    updatedAt: row.updatedAt,
  };
}

function groupResults(results: SearchEverythingResult[]) {
  const grouped = new Map<string, SearchEverythingResult[]>();
  for (const result of results) {
    const key = result.type || "knowledge";
    grouped.set(key, [...(grouped.get(key) ?? []), result]);
  }
  return Array.from(grouped.entries()).sort(([left], [right]) => {
    const leftIndex = groupOrder.indexOf(left);
    const rightIndex = groupOrder.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

function filterResults(
  results: SearchEverythingResult[],
  provider: string,
  status: string,
) {
  return results.filter((result) => {
    const resultProvider =
      result.sourceProvider ?? result.provider ?? result.source?.provider;
    const matchesProvider =
      provider === "all" || resultProvider?.toLowerCase() === provider;
    const matchesStatus =
      status === "all" || result.status?.toLowerCase() === status;
    return matchesProvider && matchesStatus;
  });
}

function internalResultHref(result: SearchEverythingResult) {
  if (result.type === "knowledge") return `/knowledge?knowledgeId=${result.id}`;
  if (result.type === "source") return `/sources?sourceId=${result.id}`;
  return null;
}

function explainMatch(result: SearchEverythingResult, query: string) {
  const queryTerms = normalizeQueryTerms(query);
  const matchedFields = [
    textMatchesTerms(result.title, queryTerms) ? "title" : null,
    textMatchesTerms(result.summary, queryTerms) ? "summary" : null,
    textMatchesTerms(result.snippet, queryTerms) ? "snippet" : null,
    textMatchesTerms(result.citation?.quote, queryTerms)
      ? "citation quote"
      : null,
    textMatchesTerms(result.sourceTitle ?? result.source?.title, queryTerms)
      ? "source"
      : null,
    textMatchesTerms(
      `${result.sourceProvider ?? result.provider ?? ""} ${result.status ?? ""}`,
      queryTerms,
    )
      ? "metadata"
      : null,
  ].filter((field): field is string => Boolean(field));
  const score =
    typeof result.score === "number"
      ? ` with score ${formatScore(result.score)}`
      : "";
  const confidence =
    typeof result.confidence === "number"
      ? ` and ${formatPercent(result.confidence)} confidence`
      : "";
  if (matchedFields.length) {
    return `Matched ${formatList(matchedFields.slice(0, 2))}${score}${confidence}.`;
  }
  const provider =
    result.sourceProvider ?? result.provider ?? result.source?.provider;
  if (provider || result.status) {
    return `Matched source metadata${score}.`;
  }
  if (score) return `Ranked by search score ${formatScore(result.score ?? 0)}.`;
  return null;
}

function normalizeQueryTerms(query: string) {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 2),
    ),
  ).slice(0, 8);
}

function textMatchesTerms(value: string | null | undefined, terms: string[]) {
  if (!value || !terms.length) return false;
  const text = value.toLowerCase();
  return terms.some((term) => text.includes(term));
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function formatScore(score: number) {
  if (score <= 1) return score.toFixed(2);
  return Math.round(score).toString();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function displayLabel(value: string) {
  const labels: Record<string, string> = {
    docs: "Docs",
    github: "GitHub",
    drive: "Drive",
    granola: "Granola",
    manual: "Manual",
    generic: "Generic",
    notion: "Notion",
    slack: "Slack",
    clips: "Clips",
  };
  return labels[value] ?? statusLabel(value);
}
