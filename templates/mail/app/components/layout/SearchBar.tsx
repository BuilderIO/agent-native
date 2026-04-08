import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { useContacts, type Contact } from "@/hooks/use-emails";

interface SearchBarProps {
  onClose: () => void;
}

export function SearchBar({ onClose }: SearchBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { data: contacts = [] } = useContacts();

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
        navigate(`/inbox?q=${encodeURIComponent(q.trim())}`);
      }
    },
    [navigate],
  );

  const selectContact = useCallback(
    (contact: Contact) => {
      const q = contact.email;
      setQuery(q);
      navigate(`/inbox?q=${encodeURIComponent(q)}`);
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

  return (
    <div className="relative flex items-center gap-1.5">
      <input
        ref={inputRef}
        id="mail-search"
        autoFocus
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
          if (!query) {
            setTimeout(onClose, 100);
          }
        }}
        placeholder="Search..."
        className="h-8 sm:h-7 w-40 sm:w-48 rounded bg-accent/80 border-none px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary/40"
      />

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
