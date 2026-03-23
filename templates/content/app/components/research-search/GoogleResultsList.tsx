import { Loader2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GoogleSearchResult } from "@shared/api";
import { GoogleResultCard } from "./GoogleResultCard";

interface GoogleResultsListProps {
  results: GoogleSearchResult[];
  isLoading: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  onLinkClick: (url: string) => void;
  error?: Error | null;
}

export function GoogleResultsList({
  results,
  isLoading,
  hasNextPage,
  onLoadMore,
  isLoadingMore,
  onLinkClick,
  error,
}: GoogleResultsListProps) {
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

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 size={24} className="animate-spin mb-3" />
        <p className="text-sm">Searching Google...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Globe size={28} className="mb-2 opacity-30" />
        <p className="text-sm">No Google results</p>
      </div>
    );
  }

  return (
    <div>
      <div className="divide-y divide-border/50">
        {results.map((result) => (
          <GoogleResultCard
            key={`${result.position}-${result.url}`}
            result={result}
            onLinkClick={onLinkClick}
          />
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1.5" />
                Loading...
              </>
            ) : (
              "More results"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
