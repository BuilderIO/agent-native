import { useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SourceFilter = "google" | "twitter";
export type DateRange = "24h" | "7d" | "30d" | "90d" | "all";
export type TweetFilter = "all" | "links" | "media";
export type SortType = "Top" | "Latest";

interface ResearchSearchBarProps {
  onSearch: (query: string) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (source: SourceFilter) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  tweetFilter: TweetFilter;
  onTweetFilterChange: (filter: TweetFilter) => void;
  sortType: SortType;
  onSortTypeChange: (sort: SortType) => void;
  isLoading?: boolean;
  hasSearched?: boolean;
  rightContent?: React.ReactNode;
  compact?: boolean;
}

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "google", label: "Google" },
  { value: "twitter", label: "Twitter" },
];

const DATE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];

const FILTER_OPTIONS: { value: TweetFilter; label: string }[] = [
  { value: "all", label: "All tweets" },
  { value: "links", label: "Links" },
  { value: "media", label: "Media" },
];

const SORT_OPTIONS: { value: SortType; label: string }[] = [
  { value: "Top", label: "Top" },
  { value: "Latest", label: "Latest" },
];

export function ResearchSearchBar({
  onSearch,
  sourceFilter,
  onSourceFilterChange,
  dateRange,
  onDateRangeChange,
  tweetFilter,
  onTweetFilterChange,
  sortType,
  onSortTypeChange,
  isLoading,
  hasSearched,
  rightContent,
  compact,
}: ResearchSearchBarProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim());
  };

  const showTwitterFilters = sourceFilter === "twitter" && !compact && !rightContent;

  return (
    <div className="space-y-2.5">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Google & Twitter..."
            className="pl-9 h-9 bg-muted/50"
          />
        </div>
        <Button type="submit" variant={hasSearched ? "outline" : "default"} size="sm" className="h-9" disabled={!query.trim() || isLoading}>
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </form>

      <div className="flex items-center gap-1.5">
        {/* Source tabs */}
        <PillGroup
          options={SOURCE_OPTIONS}
          value={sourceFilter}
          onChange={onSourceFilterChange}
        />

        {/* Twitter-specific dropdowns — hidden in compact mode */}
        {showTwitterFilters && !compact && (
          <>
            <Divider />
            <MiniSelect
              options={SORT_OPTIONS}
              value={sortType}
              onChange={onSortTypeChange}
            />
            <MiniSelect
              options={FILTER_OPTIONS}
              value={tweetFilter}
              onChange={onTweetFilterChange}
            />
            <MiniSelect
              options={DATE_OPTIONS}
              value={dateRange}
              onChange={onDateRangeChange}
            />
          </>
        )}

        {/* Collected links (right side) */}
        {rightContent && (
          <div className="ml-auto shrink-0">{rightContent}</div>
        )}
      </div>
    </div>
  );
}

function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function MiniSelect<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none bg-transparent text-xs font-medium text-muted-foreground hover:text-foreground pl-2 pr-5 py-1 rounded-md hover:bg-muted cursor-pointer border-0 outline-none focus:ring-0"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={10}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
      />
    </div>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-border mx-0.5" />;
}
