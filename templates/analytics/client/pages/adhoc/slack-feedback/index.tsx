import { useState, useMemo, useCallback, useEffect } from "react";
import { RefreshCw, MessageSquareText, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { sendToAgentChat, useAgentChatGenerating } from "@agent-native/core";
import { ChannelSelector } from "./ChannelSelector";
import { MessageList } from "./MessageList";
import { SearchBar } from "./SearchBar";
import {
  useSlackChannels,
  useSlackPaginatedHistory,
  useSlackSearch,
  useSlackTeam,
  type Workspace,
} from "./hooks";

const FILTER_CHIPS = ["bug", "issue", "broken", "error", "feedback", "request"];

const DEFAULT_CHANNELS = [
  "product-suggestions-from-app",
  "product-feedback-cancellation-and-upgrade-form",
];

export default function SlackFeedbackDashboard() {
  const workspace: Workspace = "primary";
  const isAnalyzing = useAgentChatGenerating();
  const [selectedChannels, setSelectedChannels] = useState<Map<string, string>>(
    new Map()
  );
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeChips, setActiveChips] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const { data: team } = useSlackTeam(workspace);
  const { data: channels, isLoading: channelsLoading } =
    useSlackChannels(workspace);

  // Auto-select default channels on first load
  useEffect(() => {
    if (channels && !defaultsApplied) {
      const defaults = new Map<string, string>();
      for (const name of DEFAULT_CHANNELS) {
        const match = channels.find((c) => c.name === name);
        if (match) defaults.set(match.id, match.name);
      }
      if (defaults.size > 0) setSelectedChannels(defaults);
      setDefaultsApplied(true);
    }
  }, [channels, defaultsApplied]);

  const channelIds = useMemo(
    () => [...selectedChannels.keys()],
    [selectedChannels]
  );
  const channelNames = useMemo(
    () => [...selectedChannels.values()],
    [selectedChannels]
  );

  const isSearchMode = searchQuery.length >= 2;

  const {
    data: historyData,
    isLoading: historyLoading,
    error: historyError,
    page,
    hasNextPage,
    hasPrevPage,
    goNextPage,
    goPrevPage,
    resetPagination,
  } = useSlackPaginatedHistory(workspace, channelIds, channelNames);

  const {
    data: searchData,
    isLoading: searchLoading,
    error: searchError,
  } = useSlackSearch(workspace, isSearchMode ? searchQuery : "");

  const handleChannelsChange = useCallback(
    (next: Map<string, string>) => {
      setSelectedChannels(next);
      setSearchQuery("");
      setActiveChips(new Set());
      resetPagination();
    },
    [resetPagination]
  );

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
  }, []);

  const toggleChip = useCallback((chip: string) => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  }, []);

  // Filter messages by active chips (client-side filter on top of server page)
  const displayMessages = useMemo(() => {
    const source = isSearchMode
      ? searchData?.messages
      : historyData?.messages;
    if (!source) return undefined;
    if (activeChips.size === 0) return source;
    const chips = [...activeChips];
    return source.filter((msg) => {
      const text = msg.text.toLowerCase();
      return chips.some((chip) => text.includes(chip));
    });
  }, [isSearchMode, searchData, historyData, activeChips]);

  const displayUsers = isSearchMode ? searchData?.users : historyData?.users;
  const isLoading = isSearchMode ? searchLoading : historyLoading;
  const error = isSearchMode ? searchError : historyError;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["slack-channels"] });
    queryClient.invalidateQueries({ queryKey: ["slack-history"] });
    queryClient.invalidateQueries({ queryKey: ["slack-multi-history"] });
    queryClient.invalidateQueries({ queryKey: ["slack-search"] });
    queryClient.invalidateQueries({ queryKey: ["slack-team"] });
    resetPagination();
  };

  const hasChannels = selectedChannels.size > 0;
  const searchPlaceholder = hasChannels
    ? `Search in ${channelNames.map((n) => `#${n}`).join(", ")}...`
    : "Search...";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Slack Feedback</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and search messages across Slack workspaces to surface
          feedback, bug reports, and discussions
        </p>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3">
        <span className="px-3 py-1.5 rounded-md border border-border bg-card text-xs font-medium text-foreground">
          {team?.name || "Builder Internal"}
        </span>

        <button
          onClick={handleRefresh}
          className="px-3 py-1.5 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>

        <div className="flex items-center gap-3 ml-auto">
          <ChannelSelector
            channels={channels}
            isLoading={channelsLoading}
            selected={selectedChannels}
            onChange={handleChannelsChange}
          />
          {hasChannels && (
            <button
              onClick={() => {
                if (isAnalyzing) return;
                const chList = channelNames.map((n) => `#${n}`).join(" and ");
                sendToAgentChat({
                  message: `Look at the slack feedback for the last week in ${chList}. What are the key trends and have there been any recent spikes of issues?`,
                  context: `The user is viewing the Slack Feedback dashboard. They are on the "${team?.name || "Builder Internal"}" workspace, channels: ${channelNames.map((n, i) => `#${n} (ID: ${channelIds[i]})`).join(", ")}. Use the /api/slack/history endpoint to fetch messages and analyze them.`,
                  submit: true,
                });
              }}
              disabled={isAnalyzing}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium transition-colors hover:bg-primary/90 flex items-center gap-1.5 flex-shrink-0 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <MessageSquareText className="h-3.5 w-3.5" />
                  Analyze Feedback
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {hasChannels && (
        <>
          {/* Search + filter chips */}
          <div className="space-y-3">
            <SearchBar
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={searchPlaceholder}
            />
            <div className="flex flex-wrap gap-2">
              {FILTER_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => toggleChip(chip)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                    activeChips.has(chip)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  {chip}
                </button>
              ))}
              {activeChips.size > 0 && (
                <button
                  onClick={() => setActiveChips(new Set())}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Message count */}
          {displayMessages && (
            <div className="text-xs text-muted-foreground">
              {displayMessages.length} message
              {displayMessages.length !== 1 ? "s" : ""} on this page
              {isSearchMode ? " (search results)" : ""}
              {activeChips.size > 0 &&
                ` (filtered by: ${[...activeChips].join(", ")})`}
            </div>
          )}

          {/* Messages */}
          <MessageList
            messages={displayMessages}
            users={displayUsers}
            isLoading={isLoading}
            error={error as Error | null}
            page={isSearchMode ? 0 : page}
            hasNextPage={isSearchMode ? false : hasNextPage}
            hasPrevPage={isSearchMode ? false : hasPrevPage}
            onNextPage={goNextPage}
            onPrevPage={goPrevPage}
            emptyText={
              isSearchMode
                ? "No messages match your search"
                : "No messages in selected channels"
            }
          />
        </>
      )}

      {!hasChannels && !channelsLoading && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          Select one or more channels above to view messages
        </div>
      )}
    </div>
  );
}
