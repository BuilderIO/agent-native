import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Search, Loader2 } from "lucide-react";
import { useTwitterSearch } from "@/hooks/use-twitter";
import { useGoogleSearch } from "@/hooks/use-google-search";
import type { TwitterTweet, CollectedLink, GoogleSearchResult } from "@shared/api";
import {
  ResearchSearchBar,
  type SourceFilter,
  type DateRange,
  type TweetFilter,
  type SortType,
} from "./ResearchSearchBar";
import { GoogleResultsList } from "./GoogleResultsList";
import { TweetMasonryGrid } from "@/components/twitter/TweetMasonryGrid";
import { TweetCard } from "@/components/twitter/TweetCard";
import { LinkPreviewPanel } from "@/components/twitter/LinkPreviewPanel";
import { CollectedLinksBar } from "@/components/twitter/CollectedLinksBar";

const STORAGE_KEY = "research-search-filters";

function loadFilters(): {
  sourceFilter: SourceFilter;
  dateRange: DateRange;
  tweetFilter: TweetFilter;
  sortType: SortType;
} {
  const defaults = {
    sourceFilter: "google" as SourceFilter,
    dateRange: "90d" as DateRange,
    tweetFilter: "links" as TweetFilter,
    sortType: "Top" as SortType,
  };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migrate old "both" value
      if (parsed.sourceFilter === "both") parsed.sourceFilter = "google";
      return { ...defaults, ...parsed };
    }
  } catch {}
  return defaults;
}

function saveFilters(
  sourceFilter: SourceFilter,
  dateRange: DateRange,
  tweetFilter: TweetFilter,
  sortType: SortType
) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sourceFilter, dateRange, tweetFilter, sortType })
    );
  } catch {}
}

function getTimestamp(range: DateRange): number | undefined {
  if (range === "all") return undefined;
  const now = Date.now();
  const ms: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  };
  return Math.floor((now - ms[range]) / 1000);
}

function isTwitterVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if ((host === "twitter.com" || host === "x.com") && /\/video\//.test(u.pathname)) return true;
    if (/\.(mp4|webm|mov|avi|m3u8)(\?|$)/i.test(u.pathname)) return true;
  } catch {}
  return false;
}

function extractLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/\S+/g) || [];
  return matches.filter((url) => !isTwitterVideoUrl(url));
}

function getPreviewUrlForTweet(tweet: TwitterTweet): string | null {
  const hasVideo = tweet.media?.some((m) => m.type === "video" || m.type === "animated_gif");
  const rawLinks = extractLinks(tweet.text);
  const links = hasVideo
    ? rawLinks.filter((url) => {
        try {
          const host = new URL(url).hostname;
          return host !== "t.co";
        } catch {
          return true;
        }
      })
    : rawLinks;
  return links[0] || null;
}

interface ResearchSearchPanelProps {
  onPreviewChange?: (isOpen: boolean) => void;
  activeProjectSlug?: string | null;
  currentWorkspace?: string;
  sidebarCollapsed?: boolean;
}

export function ResearchSearchPanel({ onPreviewChange, activeProjectSlug, currentWorkspace, sidebarCollapsed }: ResearchSearchPanelProps) {
  const initial = loadFilters();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(initial.sourceFilter);
  const [dateRange, setDateRange] = useState<DateRange>(initial.dateRange);
  const [tweetFilter, setTweetFilter] = useState<TweetFilter>(initial.tweetFilter);
  const [sortType, setSortType] = useState<SortType>(initial.sortType);
  const [allTweets, setAllTweets] = useState<TwitterTweet[]>([]);
  const lastQueryRef = useRef<string>("");

  // Link preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTweet, setPreviewTweet] = useState<TwitterTweet | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Collected links
  const [collectedLinks, setCollectedLinks] = useState<CollectedLink[]>([]);

  // Track explicit user clicks so the sync effect doesn't immediately close the panel
  const explicitOpenRef = useRef(false);

  // Google state
  const [googlePage, setGooglePage] = useState(0);
  const [googleAllResults, setGoogleAllResults] = useState<GoogleSearchResult[]>([]);
  const [googleQuery, setGoogleQuery] = useState<string | null>(null);

  // Twitter state
  const [frozenParams, setFrozenParams] = useState<{
    query: string;
    queryType: SortType;
    sinceTime?: number;
    cursor?: string;
    filter?: "all" | "links" | "media";
  } | null>(null);

  // Always search both providers so results are ready when switching tabs
  // Google search
  const googleSearchParams = googleQuery ? { query: googleQuery, page: googlePage } : null;
  const {
    data: googleData,
    isLoading: googleLoading,
    error: googleError,
    isFetching: googleFetching,
  } = useGoogleSearch(googleSearchParams);

  // Twitter search
  const {
    data: twitterData,
    isLoading: twitterLoading,
    isFetching: twitterFetching,
    error: twitterError,
  } = useTwitterSearch(frozenParams);

  const tweets = frozenParams?.cursor ? allTweets : (twitterData?.tweets ?? []);

  // Accumulate Google results across pages
  useEffect(() => {
    if (googleData?.results && googlePage === 0) {
      setGoogleAllResults(googleData.results);
    } else if (googleData?.results && googlePage > 0) {
      setGoogleAllResults((prev) => {
        const existingUrls = new Set(prev.map((r) => r.url));
        const newResults = googleData.results.filter((r) => !existingUrls.has(r.url));
        return [...prev, ...newResults];
      });
    }
  }, [googleData, googlePage]);

  const previewItems = useMemo(() => {
    return tweets
      .map((tweet) => ({ tweet, url: getPreviewUrlForTweet(tweet) }))
      .filter((item) => item.url || item.tweet.article);
  }, [tweets]);

  const handleSearch = useCallback(
    (query: string) => {
      lastQueryRef.current = query;

      // Fire both searches in parallel
      setGoogleQuery(query);
      setGooglePage(0);
      setGoogleAllResults([]);

      setFrozenParams({
        query,
        queryType: sortType,
        sinceTime: getTimestamp(dateRange),
        filter: tweetFilter,
      });
      setAllTweets([]);
    },
    [sortType, dateRange, tweetFilter]
  );

  // Re-search Twitter when its filters change
  useEffect(() => {
    saveFilters(sourceFilter, dateRange, tweetFilter, sortType);
    if (lastQueryRef.current) {
      setFrozenParams({
        query: lastQueryRef.current,
        queryType: sortType,
        sinceTime: getTimestamp(dateRange),
        filter: tweetFilter,
      });
      setAllTweets([]);
    }
  }, [sortType, dateRange, tweetFilter, sourceFilter]);

  const handleTwitterLoadMore = useCallback(() => {
    if (twitterData?.nextCursor && twitterData.tweets && frozenParams) {
      setAllTweets((prev) => {
        const existing = new Set(prev.map((t) => t.id));
        const newTweets = twitterData.tweets.filter((t) => !existing.has(t.id));
        return [...prev, ...newTweets];
      });
      setFrozenParams({ ...frozenParams, cursor: twitterData.nextCursor });
    }
  }, [twitterData, frozenParams]);

  const handleGoogleLoadMore = useCallback(() => {
    if (googleData?.hasNextPage) {
      setGooglePage((prev) => prev + 1);
    }
  }, [googleData]);

  const handleLinkClick = useCallback(
    (url: string, tweet?: TwitterTweet) => {
      explicitOpenRef.current = true;
      setPreviewUrl(url);
      setPreviewTweet(tweet || null);
      if (tweet) {
        setPreviewIndex(previewItems.findIndex((item) => item.tweet.id === tweet.id));
      }
      onPreviewChange?.(true);
    },
    [onPreviewChange, previewItems]
  );

  const handleGoogleLinkClick = useCallback(
    (url: string) => {
      setPreviewUrl(url);
      setPreviewTweet(null);
      setPreviewIndex(null);
      onPreviewChange?.(true);
    },
    [onPreviewChange]
  );

  const handleCollectLink = useCallback((link: CollectedLink) => {
    setCollectedLinks((prev) => {
      if (prev.some((l) => l.url === link.url)) return prev;
      return [...prev, link];
    });
  }, []);

  const handleRemoveLink = useCallback((url: string) => {
    setCollectedLinks((prev) => prev.filter((l) => l.url !== url));
  }, []);

  const collectedUrls = new Set(collectedLinks.map((l) => l.url));

  const navigatePreview = useCallback(
    (direction: -1 | 1) => {
      if (!previewItems.length) return;
      const currentIndex = previewIndex ?? previewItems.findIndex((item) => item.tweet.id === previewTweet?.id);
      if (currentIndex < 0) return;
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), previewItems.length - 1);
      if (nextIndex === currentIndex) return;
      const nextItem = previewItems[nextIndex];
      setPreviewIndex(nextIndex);
      setPreviewTweet(nextItem.tweet);
      setPreviewUrl(nextItem.url || nextItem.tweet.url);
      onPreviewChange?.(true);
    },
    [previewItems, previewIndex, previewTweet, onPreviewChange]
  );

  useEffect(() => {
    if (!previewTweet) return;
    // Skip if the user just explicitly clicked a link — don't let the sync close the panel
    if (explicitOpenRef.current) {
      explicitOpenRef.current = false;
      return;
    }
    const idx = previewItems.findIndex((item) => item.tweet.id === previewTweet.id);
    if (idx === -1) {
      setPreviewTweet(null);
      setPreviewUrl(null);
      setPreviewIndex(null);
      onPreviewChange?.(false);
      return;
    }
    setPreviewIndex(idx);
  }, [previewItems, previewTweet, onPreviewChange]);

  useEffect(() => {
    if (!previewTweet) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        navigatePreview(1);
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        navigatePreview(-1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigatePreview, previewTweet]);


  return (
    <div className="flex-1 flex h-screen bg-background overflow-hidden">
      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar & filters */}
        <div className="px-6 py-3 border-b border-border shrink-0">
          <ResearchSearchBar
            onSearch={handleSearch}
            sourceFilter={sourceFilter}
            onSourceFilterChange={setSourceFilter}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            tweetFilter={tweetFilter}
            onTweetFilterChange={setTweetFilter}
            sortType={sortType}
            onSortTypeChange={setSortType}
            isLoading={googleLoading || twitterLoading}
            hasSearched={!!lastQueryRef.current}
            compact={!sidebarCollapsed}
            rightContent={
              <CollectedLinksBar
                inline
                links={collectedLinks}
                onRemove={handleRemoveLink}
                onClear={() => setCollectedLinks([])}
                onClosePreview={() => {
                  setPreviewUrl(null);
                  setPreviewTweet(null);
                  setPreviewIndex(null);
                  onPreviewChange?.(false);
                }}
                onSaved={() => {
                  setCollectedLinks([]);
                  setPreviewUrl(null);
                  setPreviewTweet(null);
                  setPreviewIndex(null);
                  onPreviewChange?.(false);
                }}
                defaultProjectSlug={activeProjectSlug ?? undefined}
                currentWorkspace={currentWorkspace}
              />
            }
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative">
          {!lastQueryRef.current ? (
            <EmptyState />
          ) : sourceFilter === "google" ? (
            <div className="h-full overflow-y-auto scrollbar-thin px-6 py-4">
              <GoogleResultsList
                results={googleAllResults}
                isLoading={googleLoading}
                hasNextPage={googleData?.hasNextPage ?? false}
                onLoadMore={handleGoogleLoadMore}
                isLoadingMore={googleFetching && googlePage > 0}
                onLinkClick={handleGoogleLinkClick}
                error={googleError as Error | null}
              />
            </div>
          ) : (
            <div className="h-full overflow-y-auto scrollbar-thin">
              <TwitterOnlyResults
                tweets={tweets}
                isLoading={twitterLoading}
                error={twitterError}
                hasNextPage={twitterData?.hasNextPage ?? false}
                isFetching={twitterFetching}
                onLoadMore={handleTwitterLoadMore}
                onLinkClick={handleLinkClick}
                query={lastQueryRef.current}
              />
            </div>
          )}
        </div>
      </div>

      {/* Link preview side panel */}
      {previewUrl && (
        <LinkPreviewPanel
          url={previewUrl}
          tweet={previewTweet ?? undefined}
          onClose={() => {
            setPreviewUrl(null);
            setPreviewTweet(null);
            setPreviewIndex(null);
            onPreviewChange?.(false);
          }}
          onCollect={handleCollectLink}
          isCollected={collectedUrls.has(previewUrl)}
          onPrev={previewTweet ? () => navigatePreview(-1) : undefined}
          onNext={previewTweet ? () => navigatePreview(1) : undefined}
          hasPrev={previewTweet ? (previewIndex ?? 0) > 0 : false}
          hasNext={previewTweet ? (previewIndex != null && previewIndex < previewItems.length - 1) : false}
        />
      )}
    </div>
  );
}

/* ---- Twitter-only results ---- */

function TwitterOnlyResults({
  tweets,
  isLoading,
  error,
  hasNextPage,
  isFetching,
  onLoadMore,
  onLinkClick,
  query,
  compact,
}: {
  tweets: TwitterTweet[];
  isLoading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
  onLinkClick: (url: string, tweet: TwitterTweet) => void;
  query: string;
  compact?: boolean;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-red-500">
        <p className="text-sm font-medium mb-1">Search failed</p>
        <p className="text-xs text-muted-foreground max-w-md text-center">
          {error.message}
        </p>
      </div>
    );
  }

  if (isLoading && !tweets.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 size={24} className="animate-spin mb-3" />
        <p className="text-sm">Searching tweets...</p>
      </div>
    );
  }

  if (tweets.length > 0) {
    return (
      <div className={compact ? "" : "px-6 py-4 pb-20"}>
        {!compact && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
            <span>{tweets.length} results</span>
          </div>
        )}

        {compact ? (
          <div className="flex flex-col gap-3">
            {tweets.map((tweet) => (
              <TweetCard key={tweet.id} tweet={tweet} onLinkClick={onLinkClick} />
            ))}
          </div>
        ) : (
          <TweetMasonryGrid tweets={tweets} onLinkClick={onLinkClick} />
        )}

        {hasNextPage && (
          <div className="flex justify-center py-6">
            <button
              onClick={onLoadMore}
              disabled={isFetching}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {isFetching ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <p className="text-sm">No tweets found for "{query}"</p>
      <p className="text-xs mt-1">Try a different query or adjust filters</p>
    </div>
  );
}

/* ---- Empty state ---- */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <Search size={36} className="mb-3 mt-8 opacity-20" />
      <p className="text-sm font-medium">Search Google & Twitter</p>
    </div>
  );
}
