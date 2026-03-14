import { useState, useCallback } from "react";
import { Search, X } from "lucide-react";

interface KeywordSearchInputProps {
  onSearch: (query: string) => void;
  isLoading: boolean;
}

export function KeywordSearchInput({
  onSearch,
  isLoading,
}: KeywordSearchInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed.length >= 2) {
        onSearch(trimmed);
      }
    },
    [value, onSearch],
  );

  const handleClear = () => {
    setValue("");
    onSearch("");
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative flex items-center">
        <Search
          size={16}
          className="absolute left-3 text-muted-foreground pointer-events-none"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter a seed keyword..."
          className="w-full h-10 pl-9 pr-20 rounded-lg border border-border bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 transition-colors"
        />
        <div className="absolute right-1.5 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="submit"
            disabled={value.trim().length < 2 || isLoading}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {isLoading ? "..." : "Search"}
          </button>
        </div>
      </div>
    </form>
  );
}
