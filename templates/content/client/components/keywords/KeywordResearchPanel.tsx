import { useState, useCallback } from "react";
import { Search, Key } from "lucide-react";
import { useKeywordSuggest, useKeywordApiStatus } from "@/hooks/use-keywords";
import { KeywordSearchInput } from "./KeywordSearchInput";
import { KeywordResults } from "./KeywordResults";
import { ApiKeySetup } from "./ApiKeySetup";

export function KeywordResearchPanel() {
  const [query, setQuery] = useState("");
  const [showApiSetup, setShowApiSetup] = useState(false);
  const { data: apiStatus } = useKeywordApiStatus();
  const { data, isLoading, error } = useKeywordSuggest(query);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
  }, []);

  return (
    <div className="flex-1 flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <Search size={16} className="text-muted-foreground" />
          <h1 className="text-sm font-semibold text-foreground">Keyword Research</h1>
        </div>
        <button
          onClick={() => setShowApiSetup(!showApiSetup)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Key size={13} />
          API Settings
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {/* API Setup Panel (collapsible) */}
          {showApiSetup && (
            <div className="mb-6">
              <ApiKeySetup onClose={() => setShowApiSetup(false)} />
            </div>
          )}

          {/* Search */}
          <KeywordSearchInput onSearch={handleSearch} isLoading={isLoading} />

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              {error.message}
            </div>
          )}

          {/* Results */}
          {data && (
            <div className="mt-6">
              <KeywordResults
                suggestions={data.suggestions}
                source={data.source}
                query={data.query}
              />
            </div>
          )}

          {/* Empty state */}
          {!data && !isLoading && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Search size={32} className="mb-3 opacity-30" />
              <p className="text-sm">Enter a keyword to discover related terms</p>
              <p className="text-xs mt-1.5">
                Try terms like "content marketing", "react hooks", "seo strategy"
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
