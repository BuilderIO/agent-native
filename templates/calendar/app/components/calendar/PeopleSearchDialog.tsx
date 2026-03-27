import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, UserPlus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useOverlayPeople,
  useAddOverlayPerson,
  useRemoveOverlayPerson,
} from "@/hooks/use-overlay-people";

interface SearchResult {
  name: string;
  email: string;
  photoUrl?: string;
}

interface SearchResponse {
  results: SearchResult[];
  scopeRequired?: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PeopleSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PeopleSearchDialog({
  open,
  onOpenChange,
}: PeopleSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [scopeRequired, setScopeRequired] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const listRef = useRef<HTMLDivElement>(null);

  const { data: overlayPeople = [] } = useOverlayPeople();
  const addPerson = useAddOverlayPerson();
  const removePerson = useRemoveOverlayPerson();

  const overlayEmails = new Set(overlayPeople.map((p) => p.email));

  // Selectable results (exclude already-added)
  const selectableResults = results.filter((r) => !overlayEmails.has(r.email));

  const search = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const url = q
        ? `/api/people/search?q=${encodeURIComponent(q)}`
        : `/api/people/search`;
      const res = await fetch(url);
      if (res.ok) {
        const data: SearchResponse = await res.json();
        setResults(data.results ?? []);
        setScopeRequired(data.scopeRequired ?? false);
      }
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), query ? 300 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(results.length > 0 ? 0 : -1);
  }, [results]);

  // Load org contacts when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setScopeRequired(false);
      setActiveIndex(-1);
      search("");
    }
  }, [open, search]);

  function handleAdd(email: string, name?: string) {
    addPerson.mutate({ email, name });
  }

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-result]");
    items[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i < selectableResults.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : selectableResults.length - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // If an item is selected via arrow keys, add it
      if (activeIndex >= 0 && activeIndex < selectableResults.length) {
        const person = selectableResults[activeIndex];
        handleAdd(person.email, person.name);
        return;
      }
      // Otherwise, try adding as a typed email
      const trimmed = query.trim();
      if (EMAIL_REGEX.test(trimmed) && !overlayEmails.has(trimmed)) {
        handleAdd(trimmed);
        setQuery("");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] gap-0 p-0">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="text-base">People</DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="relative px-4 pt-3 pb-2">
          <Search className="absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by name or type an email..."
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            autoFocus
          />
          {searching && (
            <Loader2 className="absolute right-7 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Search results */}
        {results.length > 0 && (
          <div
            ref={listRef}
            className="max-h-48 overflow-y-auto border-t border-border"
          >
            {results.map((person) => {
              const alreadyAdded = overlayEmails.has(person.email);
              const selectableIdx = selectableResults.indexOf(person);
              const isActive = !alreadyAdded && selectableIdx === activeIndex;
              return (
                <button
                  key={person.email}
                  data-result
                  disabled={alreadyAdded}
                  onClick={() => handleAdd(person.email, person.name)}
                  onMouseEnter={() => {
                    if (!alreadyAdded) setActiveIndex(selectableIdx);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm disabled:opacity-40 ${
                    isActive
                      ? "bg-accent text-foreground"
                      : "hover:bg-accent/50"
                  }`}
                >
                  <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    {person.name && (
                      <div className="truncate font-medium text-foreground">
                        {person.name}
                      </div>
                    )}
                    <div className="truncate text-xs text-muted-foreground">
                      {person.email}
                    </div>
                  </div>
                  {alreadyAdded && (
                    <span className="text-xs text-muted-foreground">Added</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Scope hint */}
        {scopeRequired && (
          <div className="px-4 py-2 text-xs text-muted-foreground">
            Directory search is limited. Type a full email address and press
            Enter to add directly.
          </div>
        )}

        {/* Manual email hint */}
        {query.length > 0 &&
          results.length === 0 &&
          !searching &&
          EMAIL_REGEX.test(query.trim()) && (
            <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              Press{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-mono">
                Enter
              </kbd>{" "}
              to add{" "}
              <span className="font-medium text-foreground">
                {query.trim()}
              </span>
            </div>
          )}

        {/* Current overlay people */}
        {overlayPeople.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Showing calendars
            </p>
            <div className="space-y-1.5">
              {overlayPeople.map((person) => (
                <div
                  key={person.email}
                  className="flex items-center gap-2.5 text-sm"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: person.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {person.name || person.email}
                  </span>
                  <button
                    onClick={() => removePerson.mutate(person.email)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
