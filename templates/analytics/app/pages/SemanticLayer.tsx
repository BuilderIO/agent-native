import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { mcpIntegrationLogo } from "@agent-native/core/client/resources/mcp-integration-logos";
import { useSendToAgentChat } from "@agent-native/toolkit/app/chat";
import {
  IntegrationGrid,
  type IntegrationGridItem,
} from "@agent-native/toolkit/app/integrations";
import { McpIntegrationLogo } from "@agent-native/toolkit/app/resources";
import {
  IconBook2,
  IconDatabase,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { DATA_SOURCE_LOGO_IDS } from "@/lib/data-sources";

import { DefinitionPanel } from "../components/semantic-layer/DefinitionPanel";
import { IndexPanel } from "../components/semantic-layer/IndexPanel";
import type {
  DictionaryEntry,
  DictionaryPage,
} from "../components/semantic-layer/types";

type TablerIcon = ComponentType<Record<string, unknown>>;

interface BrainOverview {
  index: {
    state: "not-built" | "current" | "stale" | "running" | "failed";
    entryCount: number;
    generatedAt: string | null;
  };
}

const DEFINITIONS_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

type SheetTarget =
  | { kind: "index" }
  | { kind: "definition"; entry: DictionaryEntry | null };

const INDEX_STATUS = {
  current: { key: "semanticLayer.indexFresh", className: "text-emerald-500" },
  stale: { key: "semanticLayer.indexStale", className: "text-amber-500" },
  running: {
    key: "semanticLayer.indexBuilding",
    className: "text-muted-foreground",
  },
  failed: { key: "semanticLayer.indexFailed", className: "text-destructive" },
  "not-built": {
    key: "semanticLayer.indexNotBuilt",
    className: "text-muted-foreground",
  },
} as const;

function entryStatus(entry: DictionaryEntry) {
  if (entry.approved) {
    return {
      key: "semanticLayer.statusApproved",
      className: "text-emerald-500",
    };
  }
  if (entry.aiGenerated) {
    return {
      key: "semanticLayer.statusSuggested",
      className: "text-amber-500",
    };
  }
  return {
    key: "semanticLayer.statusUnreviewed",
    className: "text-muted-foreground",
  };
}

/** Same frame as a logo, so a Tabler icon stands in without shifting the row. */
function LogoBox({ icon: Icon }: { icon: TablerIcon }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

/** Mirrors SourceLogo on the Data Sources page: shared logo table first, Tabler icon otherwise. */
function SourceLogo({
  id,
  name,
  fallbackIcon,
}: {
  id: string;
  name: string;
  fallbackIcon: TablerIcon;
}) {
  const logoId = DATA_SOURCE_LOGO_IDS[id] ?? id;
  const logoUrl = mcpIntegrationLogo(logoId);
  if (!logoUrl) return <LogoBox icon={fallbackIcon} />;
  return (
    <McpIntegrationLogo
      name={name}
      logoUrl={logoUrl}
      integrationId={logoId}
      className="size-8"
      imageClassName="size-6"
    />
  );
}

/** Skeleton rows with the same geometry as IntegrationGrid variant="rows". */
function RowsSkeleton({ count, label }: { count: number; label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2"
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5"
        >
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SemanticLayer() {
  const t = useT();
  const formatters = useFormatters();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [target, setTarget] = useState<SheetTarget>({ kind: "index" });
  const { send } = useSendToAgentChat();

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setQuery(search.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [search]);

  const overview = useActionQuery("get-brain-overview", undefined, {
    staleTime: 30_000,
  });
  // Keyed by the debounced query, so each new search pages from the start.
  const dictionary = useInfiniteQuery({
    queryKey: [
      "action",
      "list-data-dictionary",
      { paged: true, search: query },
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      callAction<DictionaryPage, "list-data-dictionary">(
        "list-data-dictionary",
        {
          search: query || undefined,
          limit: DEFINITIONS_PAGE_SIZE,
          ...(pageParam ? { nextPage: pageParam } : {}),
        },
        { method: "GET", signal },
      ),
    getNextPageParam: (lastPage) => lastPage.nextPage,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
  const overviewData = overview.data as BrainOverview | undefined;
  // Ranking can shift between page requests, so one entry may come back twice.
  const entries = [
    ...new Map(
      (dictionary.data?.pages ?? [])
        .flatMap((page) => page.results)
        .map((entry) => [entry.id, entry] as const),
    ).values(),
  ];

  const openTarget = (next: SheetTarget) => {
    setTarget(next);
    setSheetOpen(true);
  };
  const addDefinition = () => openTarget({ kind: "definition", entry: null });
  const closeSheet = () => setSheetOpen(false);

  const index = overviewData?.index;
  const indexStatus = index ? INDEX_STATUS[index.state] : null;
  // Unbuilt indexes show only the status label; a description would repeat it.
  const indexDescription = index?.generatedAt
    ? t("semanticLayer.indexBuilt", {
        count: index.entryCount,
        date: formatters.formatDate(index.generatedAt, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      })
    : undefined;
  const indexItem: IntegrationGridItem = {
    id: "source-index",
    name: t("semanticLayer.sourceIndex"),
    description: indexDescription,
    logo: <LogoBox icon={IconDatabase} />,
    status: indexStatus
      ? t(indexStatus.key)
      : t("semanticLayer.indexUnavailable"),
    statusClassName: indexStatus?.className ?? "text-destructive",
    actionKind: "manage",
    actionLabel: t("dataSources.manage"),
    onAction: () => openTarget({ kind: "index" }),
  };

  const bySource = new Map<string, DictionaryEntry[]>();
  for (const entry of entries) {
    const source = entry.source ?? "";
    bySource.set(source, [...(bySource.get(source) ?? []), entry]);
  }
  const groups = [...bySource].sort(([a], [b]) => a.localeCompare(b));

  const definitionItem = (entry: DictionaryEntry): IntegrationGridItem => {
    const status = entryStatus(entry);
    return {
      id: entry.id,
      name: entry.metric,
      description: entry.definition,
      logo: (
        <SourceLogo
          id={entry.source ?? ""}
          name={entry.source ?? entry.metric}
          fallbackIcon={IconDatabase}
        />
      ),
      status: [
        t(status.key),
        entry.department,
        entry.table,
        entry.aiGenerated ? t("dataDictionary.ai") : null,
      ]
        .filter(Boolean)
        .join(" · "),
      statusClassName: status.className,
      actionKind: "manage",
      actionLabel: t("semanticLayer.edit"),
      actionAriaLabel: t("semanticLayer.editNamed", { name: entry.metric }),
      onAction: () => openTarget({ kind: "definition", entry }),
    };
  };

  let definitionsContent: ReactNode;
  if (dictionary.isLoading) {
    definitionsContent = (
      <RowsSkeleton count={4} label={t("semanticLayer.loading")} />
    );
  } else if (dictionary.isError) {
    definitionsContent = (
      <p role="alert" className="text-sm text-destructive">
        {t("semanticLayer.loadFailed")}
      </p>
    );
  } else if (entries.length === 0) {
    definitionsContent = query ? (
      <p className="text-sm text-muted-foreground">
        {t("semanticLayer.noMatches")}
      </p>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          {t("semanticLayer.emptyDefinitions")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ms-3"
            onClick={() =>
              send({
                message: t("dataDictionary.populateAgentPrompt"),
                submit: false,
              })
            }
          >
            {t("dataDictionary.askAgent")}
          </Button>
        </div>
      </div>
    );
  } else {
    // Placeholder pages belong to the previous query, so paging waits for the new one.
    const showLoadMore =
      dictionary.hasNextPage && !dictionary.isPlaceholderData;
    definitionsContent = (
      <>
        <div className="flex flex-col gap-4">
          {groups.map(([source, rows]) => (
            <div key={source} className="flex flex-col gap-1">
              <p className="px-2 text-xs font-medium text-muted-foreground">
                {source || t("semanticLayer.unsourced")}
              </p>
              <IntegrationGrid
                variant="rows"
                items={rows.map(definitionItem)}
              />
            </div>
          ))}
        </div>
        {showLoadMore ? (
          <div className="flex flex-col items-start gap-2 px-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={dictionary.isFetchingNextPage}
              onClick={() => void dictionary.fetchNextPage()}
            >
              {t("semanticLayer.loadMore")}
            </Button>
            {dictionary.isFetchNextPageError ? (
              <p role="alert" className="text-xs text-destructive">
                {t("semanticLayer.loadFailed")}
              </p>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  const sheetHeader =
    target.kind === "index"
      ? {
          logo: <LogoBox icon={IconDatabase} />,
          title: t("semanticLayer.sourceIndex"),
        }
      : target.entry
        ? {
            logo: (
              <SourceLogo
                id={target.entry.source ?? ""}
                name={target.entry.source ?? target.entry.metric}
                fallbackIcon={IconDatabase}
              />
            ),
            title: target.entry.metric,
          }
        : {
            logo: <LogoBox icon={IconBook2} />,
            title: t("semanticLayer.newDefinition"),
          };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <div className="flex items-center justify-end gap-2">
        <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("semanticLayer.searchPlaceholder")}
            aria-label={t("semanticLayer.searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={addDefinition}
        >
          <IconPlus className="size-4" aria-hidden="true" />
          {t("semanticLayer.addDefinition")}
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("semanticLayer.indexSection")}
        </h2>
        {overview.isLoading ? (
          <RowsSkeleton count={1} label={t("semanticLayer.loading")} />
        ) : (
          <IntegrationGrid variant="rows" items={[indexItem]} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("semanticLayer.definitionsSection")}
        </h2>
        {definitionsContent}
      </section>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          aria-describedby={undefined}
          className="w-full overflow-y-auto sm:max-w-lg"
        >
          <SheetHeader className="pe-8">
            <div className="flex min-w-0 items-center gap-3">
              {sheetHeader.logo}
              <SheetTitle className="truncate">{sheetHeader.title}</SheetTitle>
            </div>
          </SheetHeader>
          <div className="mt-5 min-w-0">
            {target.kind === "index" ? (
              <IndexPanel />
            ) : (
              <DefinitionPanel entry={target.entry} onDone={closeSheet} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
