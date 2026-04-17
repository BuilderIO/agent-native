import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useContacts, type Contact } from "@/hooks/use-emails";

interface SearchBarProps {
  onClose: () => void;
  initialQuery?: string;
  autoFocus?: boolean;
  hasActiveSearch?: boolean;
}

export function SearchBar({
  onClose,
  initialQuery = "",
  autoFocus = true,
  hasActiveSearch = false,
}: SearchBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const lastSyncedQueryRef = useRef(initialQuery);

  const { data: contacts = [] } = useContacts();

  // Sync from URL when it changes externally (e.g. browser back/forward).
  // Track the last prop we absorbed so user typing isn't clobbered when the
  // debounced navigate round-trips back through the URL.
  useEffect(() => {
    if (initialQuery !== lastSyncedQueryRef.current) {
      lastSyncedQueryRef.current = initialQuery;
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  // Filter contacts matching the query
  const matchedContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return contacts
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query, contacts]);

  const showDropdown = matchedContacts.length > 0;

  // Reset selection when matches change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [matchedContacts.length]);

  const executeSearch = useCallback(
    (q: string) => {
      if (q.trim()) {
        lastSyncedQueryRef.current = q.trim();
        navigate(`/inbox?q=${encodeURIComponent(q.trim())}`);
      }
    },
    [navigate],
  );

  const selectContact = useCallback(
    (contact: Contact) => {
      const q = contact.email;
      setQuery(q);
      lastSyncedQueryRef.current = q;
      navigate(`/inbox?q=${encodeURIComponent(q)}`);
      inputRef.current?.blur();
    },
    [navigate],
  );

  // Debounced auto-search as you type (only for text queries, not contact selection)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length >= 3) {
      debounceRef.current = setTimeout(() => {
        executeSearch(q);
      }, 400);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, executeSearch]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (showDropdown) {
        setSelectedIndex((prev) =>
          Math.min(prev + 1, matchedContacts.length - 1),
        );
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (showDropdown) {
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && matchedContacts[selectedIndex]) {
        selectContact(matchedContacts[selectedIndex]);
      } else {
        executeSearch(query);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      setQuery("");
      onClose();
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-contact-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Highlight matching text
  const highlight = (text: string, q: string) => {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="font-semibold text-foreground">
          {text.slice(idx, idx + q.length)}
        </span>
        {text.slice(idx + q.length)}
      </>
    );
  };

  const handleClear = useCallback(() => {
    setQuery("");
    lastSyncedQueryRef.current = "";
    onClose();
  }, [onClose]);

  return (
    <div className="relative flex items-center gap-1.5">
      <div
        className={cn(
          "relative flex items-center rounded bg-accent/80 focus-within:ring-1 focus-within:ring-primary/40",
          hasActiveSearch ? "w-56 sm:w-64" : "w-40 sm:w-48",
        )}
      >
        <input
          ref={inputRef}
          id="mail-search"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            // Don't close if clicking on a dropdown item
            if (
              e.relatedTarget &&
              (e.relatedTarget as HTMLElement).closest("[data-search-dropdown]")
            ) {
              return;
            }
            // Keep the bar mounted while a search is active — the user needs
            // to see what they searched. Only collapse when empty.
            if (hasActiveSearch || query.trim()) return;
            setTimeout(onClose, 100);
          }}
          placeholder="Search..."
          className={cn(
            "h-8 sm:h-7 flex-1 min-w-0 bg-transparent border-none px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none",
            hasActiveSearch && "font-medium",
          )}
        />
        {(hasActiveSearch || query) && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              handleClear();
            }}
            title="Clear search (Esc)"
            className="flex h-5 w-5 mr-1 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Contact suggestions dropdown */}
      {showDropdown && (
        <div
          data-search-dropdown
          ref={listRef}
          className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-border bg-popover shadow-lg z-50 py-1 overflow-hidden"
        >
          {matchedContacts.map((contact, i) => (
            <button
              key={contact.email}
              data-contact-item
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                selectContact(contact);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left text-[13px]",
                i === selectedIndex && "bg-accent",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-foreground/90">
                {highlight(contact.name || contact.email, query.trim())}
              </span>
              {contact.name && (
                <span className="shrink-0 text-muted-foreground text-xs">
                  {highlight(contact.email, query.trim())}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
