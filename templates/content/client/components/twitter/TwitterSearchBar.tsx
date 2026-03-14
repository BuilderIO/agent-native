import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type DateRange = "24h" | "7d" | "30d" | "90d" | "all";
export type TweetFilter = "all" | "links" | "media";
export type SortType = "Top" | "Latest";

interface TwitterSearchBarProps {
  onSearch: (query: string) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  tweetFilter: TweetFilter;
  onTweetFilterChange: (filter: TweetFilter) => void;
  sortType: SortType;
  onSortTypeChange: (sort: SortType) => void;
  isLoading?: boolean;
  rightContent?: React.ReactNode;
}

const DATE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

const FILTER_OPTIONS: { value: TweetFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "links", label: "Links" },
  { value: "media", label: "Media" },
];

const SORT_OPTIONS: { value: SortType; label: string }[] = [
  { value: "Top", label: "Top" },
  { value: "Latest", label: "Latest" },
];

export function TwitterSearchBar({
  onSearch,
  dateRange,
  onDateRangeChange,
  tweetFilter,
  onTweetFilterChange,
  sortType,
  onSortTypeChange,
  isLoading,
  rightContent,
}: TwitterSearchBarProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim());
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tweets..."
            className="pl-9 h-9 bg-muted/50"
          />
        </div>
        <Button type="submit" size="sm" className="h-9" disabled={!query.trim() || isLoading}>
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </form>

      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <PillGroup
            options={SORT_OPTIONS}
            value={sortType}
            onChange={onSortTypeChange}
          />
          <Divider />
          <PillGroup
            options={FILTER_OPTIONS}
            value={tweetFilter}
            onChange={onTweetFilterChange}
          />
          <Divider />
          <PillGroup
            options={DATE_OPTIONS}
            value={dateRange}
            onChange={onDateRangeChange}
          />
        </div>
        {rightContent && (
          <div className="ml-auto w-full sm:w-auto">{rightContent}</div>
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

function Divider() {
  return <div className="w-px h-4 bg-border mx-1" />;
}
