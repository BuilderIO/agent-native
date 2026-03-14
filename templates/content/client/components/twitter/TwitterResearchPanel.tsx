import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Twitter, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTwitterSearch } from "@/hooks/use-twitter";
import type { TwitterTweet, CollectedLink } from "@shared/api";
import {
  TwitterSearchBar,
  type DateRange,
  type TweetFilter,
  type SortType,
} from "./TwitterSearchBar";
import { TweetMasonryGrid } from "./TweetMasonryGrid";
import { LinkPreviewPanel } from "./LinkPreviewPanel";
import { CollectedLinksBar } from "./CollectedLinksBar";

const STORAGE_KEY = "twitter-research-filters";

function loadFilters(): { dateRange: DateRange; tweetFilter: TweetFilter; sortType: SortType } {
  const defaults = { dateRange: "90d" as DateRange, tweetFilter: "links" as TweetFilter, sortType: "Top" as SortType };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const validFilters: TweetFilter[] = ["all", "links", "media"];
      if (!validFilters.includes(parsed.tweetFilter)) parsed.tweetFilter = defaults.tweetFilter;
      return { ...defaults, ...parsed };
    }
  } catch {}
  return defaults;
}

function saveFilters(dateRange: DateRange, tweetFilter: TweetFilter, sortType: SortType) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dateRange, tweetFilter, sortType }));
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

interface TwitterResearchPanelProps {
  onPreviewChange?: (isOpen: boolean) => void;
}

export function TwitterResearchPanel({ onPreviewChange }: TwitterResearchPanelProps) {
  const initial = loadFilters();
  const [dateRange, setDateRange] = useState<DateRange>(initial.dateRange);
  const [tweetFilter, setTweetFilter] = useState<TweetFilter>(initial.tweetFilter);
  const [sortType, setSortType] = useState<SortType>(initial.sortType);
  const [allTweets, setAllTweets] = useState<TwitterTweet[]>([]);
  const lastQueryRef = useRef<string>("");

  // Link preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTweet, setPreviewTweet] = useState<TwitterTweet | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Collected links state
  const [collectedLinks, setCollectedLinks] = useState<CollectedLink[]>([]);

  // Track explicit user clicks so the sync effect doesn't immediately close the panel
  const explicitOpenRef = useRef(false);

  const [frozenParams, setFrozenParams] = useState<{
    query: string;
    queryType: SortType;
    sinceTime?: number;
    cursor?: string;
    filter?: "all" | "links" | "media";
  } | null>(null);

  const { data, isLoading, isFetching, error } = useTwitterSearch(frozenParams);

  const tweets = frozenParams?.cursor ? allTweets : (data?.tweets ?? []);

  const previewItems = useMemo(() => {
    return tweets
      .map((tweet) => ({ tweet, url: getPreviewUrlForTweet(tweet) }))
      .filter((item) => item.url || item.tweet.article);
  }, [tweets]);

  const handleSearch = useCallback(
    (query: string) => {
      lastQueryRef.current = query;
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

  useEffect(() => {
    saveFilters(dateRange, tweetFilter, sortType);
    if (lastQueryRef.current) {
      setFrozenParams({
        query: lastQueryRef.current,
        queryType: sortType,
        sinceTime: getTimestamp(dateRange),
        filter: tweetFilter,
      });
      setAllTweets([]);
    }
  }, [sortType, dateRange, tweetFilter]);

  const handleLoadMore = useCallback(() => {
    if (data?.nextCursor && data.tweets && frozenParams) {
      setAllTweets((prev) => {
        const existing = new Set(prev.map((t) => t.id));
        const newTweets = data.tweets.filter((t) => !existing.has(t.id));
        return [...prev, ...newTweets];
      });
      setFrozenParams({ ...frozenParams, cursor: data.nextCursor });
    }
  }, [data, frozenParams]);

  const handleLinkClick = useCallback((url: string, tweet: TwitterTweet) => {
    explicitOpenRef.current = true;
    setPreviewUrl(url);
    setPreviewTweet(tweet);
    setPreviewIndex(previewItems.findIndex((item) => item.tweet.id === tweet.id));
    onPreviewChange?.(true);
  }, [onPreviewChange, previewItems]);

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
          <TwitterSearchBar
            onSearch={handleSearch}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            tweetFilter={tweetFilter}
            onTweetFilterChange={setTweetFilter}
            sortType={sortType}
            onSortTypeChange={setSortType}
            isLoading={isLoading}
            rightContent={
              <CollectedLinksBar
                inline
                links={collectedLinks}
                onRemove={handleRemoveLink}
                onClear={() => setCollectedLinks([])}
                onSaved={() => setCollectedLinks([])}
              />
            }
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin relative">
          {error ? (
            <div className="flex flex-col items-center justify-center py-20 text-red-500">
              <p className="text-sm font-medium mb-1">Search failed</p>
              <p className="text-xs text-muted-foreground max-w-md text-center">
                {error.message}
              </p>
            </div>
          ) : isLoading && !tweets.length ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 size={24} className="animate-spin mb-3" />
              <p className="text-sm">Searching tweets...</p>
            </div>
          ) : tweets.length > 0 ? (
            <div className="px-6 py-4 pb-20">
              <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                <span>{tweets.length} results</span>
              </div>

              <TweetMasonryGrid tweets={tweets} onLinkClick={handleLinkClick} />

              {data?.hasNextPage && (
                <div className="flex justify-center py-6">
                  <Button
                    variant="outline"
                    onClick={handleLoadMore}
                    disabled={isFetching}
                  >
                    {isFetching ? (
                      <>
                        <Loader2 size={14} className="animate-spin mr-1.5" />
                        Loading...
                      </>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                </div>
              )}
            </div>
          ) : lastQueryRef.current ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-sm">No tweets found for "{lastQueryRef.current}"</p>
              <p className="text-xs mt-1">
                Try a different query or adjust filters
              </p>
            </div>
          ) : (
            <EmptyState />
          )}

        </div>
      </div>

      {/* Link preview side panel */}
      {previewUrl && previewTweet && (
        <LinkPreviewPanel
          url={previewUrl}
          tweet={previewTweet}
          onClose={() => {
            setPreviewUrl(null);
            setPreviewTweet(null);
            setPreviewIndex(null);
            onPreviewChange?.(false);
          }}
          onCollect={handleCollectLink}
          isCollected={collectedUrls.has(previewUrl)}
          onPrev={() => navigatePreview(-1)}
          onNext={() => navigatePreview(1)}
          hasPrev={(previewIndex ?? 0) > 0}
          hasNext={previewIndex != null && previewIndex < previewItems.length - 1}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Twitter size={36} className="mb-3 mt-8 opacity-20 text-blue-500" />
      <p className="text-sm font-medium">Search Twitter / X</p>
    </div>
  );
}
