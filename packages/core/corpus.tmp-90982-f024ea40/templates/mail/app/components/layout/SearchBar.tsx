import { useT } from "@agent-native/core/client";
import type { EmailMessage } from "@shared/types";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useContacts,
  type Contact,
  type InfiniteEmails,
} from "@/hooks/use-emails";
import { ensureThread } from "@/lib/thread-cache";
import { groupIntoThreads, type ThreadSummary } from "@/lib/threads";
import { cn } from "@/lib/utils";

const LOCAL_MATCH_LIMIT = 8;
const MIN_REMOTE_QUERY_LENGTH = 3;

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
  const t = useT();
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(autoFocus);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSyncedQueryRef = useRef(initialQuery);

  const { data: contacts = [] } = useContacts();
  const queryClient = useQueryClient();

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

  // Instant local matches over already-cached email pages (subject/from/snippet
  // substring), so something shows up before the debounced remote Gmail search
  // fires and while it's in flight. Cheap and quota-free — no network call.
  const localMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    const cached = queryClient.getQueriesData<InfiniteEmails>({
      queryKey: ["emails"],
    });
    const seenThreadIds = new Set<string>();
    const messages: EmailMessage[] = [];
    for (const [, data] of cached) {
      for (const page of data?.pages ?? []) {
        for (const email of page.emails) {
          const threadKey = email.threadId || email.id;
          if (seenThreadIds.has(threadKey)) continue;
          const haystack =
            `${email.subject} ${email.from.name} ${email.from.email} ${email.snippet}`.toLowerCase();
          if (!haystack.includes(q)) continue;
          seenThreadIds.add(threadKey);
          messages.push(email);
        }
      }
    }
    return groupIntoThreads(messages).slice(0, LOCAL_MATCH_LIMIT);
  }, [query, queryClient]);

  // True while a live Gmail search for the current query is in flight, so we
  // can show a "searching Gmail" row under the instant local matches.
  const remoteSearchPending =
    useIsFetching({ queryKey: ["emails", "all", query.trim()] }) > 0;

  const showLocalResults = isFocused && query.trim().length >= 2;
  const showDropdown =
    isFocused && (matchedContacts.length > 0 || showLocalResults);

  // Reset selection when matches change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [matchedContacts.length, localMatches.length]);

  const executeSearch = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (trimmed && trimmed !== lastSyncedQueryRef.current) {
        lastSyncedQueryRef.current = trimmed;
        navigate(`/all?q=${encodeURIComponent(trimmed)}`);
      }
    },
    [navigate],
  );

  const selectContact = useCallback(
    (contact: Contact) => {
      const q = contact.email;
      setQuery(q);
      lastSyncedQueryRef.current = q;
      navigate(`/all?q=${encodeURIComponent(q)}`);
      inputRef.current?.blur();
    },
    [navigate],
  );

  const selectThread = useCallback(
    (thread: ThreadSummary) => {
      const email = thread.latestMessage;
      const targetThreadId = email.threadId || email.id;
      void ensureThread(targetThreadId, email.accountEmail).catch(() => {});
      navigate(`/all/${targetThreadId}`);
      inputRef.current?.blur();
    },
    [navigate],
  );

  // Debounced auto-search as you type (only for text queries, not contact
  // selection). Kept at 400ms and gated to 3+ chars — Gmail's per-user search
  // quota is tight, so this must not fire a live round trip per keystroke.
  // Instant local matches (above) cover the gap while this waits/runs.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length >= MIN_REMOTE_QUERY_LENGTH) {
      debounceRef.current = setTimeout(() => {
        executeSearch(q);
      }, 400);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, executeSearch]);

  // Combined keyboard-navigable list: contacts first, then instant local
  // thread matches, matching the visual order of the dropdown.
  const combinedMatchCount = matchedContacts.length + localMatches.length;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (showDropdown) {
        setSelectedIndex((prev) => Math.min(prev + 1, combinedMatchCount - 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (showDropdown) {
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < matchedContacts.length) {
        selectContact(matchedContacts[selectedIndex]);
      } else if (selectedIndex >= matchedContacts.length) {
        const thread = localMatches[selectedIndex - matchedContacts.length];
        if (thread) selectThread(thread);
      } else if (query.trim().length >= MIN_REMOTE_QUERY_LENGTH) {
        executeSearch(query);
        inputRef.current?.blur();
      } else if (localMatches[0]) {
        // Below the remote-search minimum: only ever run the local filter,
        // never a live Gmail round trip for a 1-2 char query.
        selectThread(localMatches[0]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
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
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            // Don't close if clicking on a dropdown item
            if (
              e.relatedTarget &&
              (e.relatedTarget as HTMLElement).closest("[data-search-dropdown]")
            ) {
              return;
            }
            setIsFocused(false);
            // Keep the bar mounted while a search is active — the user needs
            // to see what they searched. Only collapse when empty.
            if (hasActiveSearch || query.trim()) return;
            setTimeout(onClose, 100);
          }}
          placeholder={t("mail.search.placeholder")}
          className={cn(
            "h-8 sm:h-7 flex-1 min-w-0 bg-transparent border-none px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none",
            hasActiveSearch && "font-medium",
          )}
        />
        {(hasActiveSearch || query) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleClear();
                }}
                className="flex h-5 w-5 me-1 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("mail.search.clear")}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Contact + instant local-match suggestions dropdown */}
      {showDropdown && (
        <div
          data-search-dropdown
          ref={listRef}
          className="absolute end-0 top-full mt-1 w-72 rounded-lg border border-border bg-popover shadow-lg z-50 py-1 overflow-hidden"
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
                "flex w-full items-center gap-3 px-3 py-2 text-start text-[13px]",
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

          {showLocalResults && localMatches.length > 0 && (
            <div
              className={cn(
                "border-border/60",
                matchedContacts.length > 0 && "border-t",
              )}
            >
              <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t("mail.search.localResults")}
              </div>
              {localMatches.map((thread, i) => {
                const combinedIndex = matchedContacts.length + i;
                const email = thread.latestMessage;
                return (
                  <button
                    key={email.threadId || email.id}
                    data-contact-item
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectThread(thread);
                    }}
                    onMouseEnter={() => setSelectedIndex(combinedIndex)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-start text-[13px]",
                      combinedIndex === selectedIndex && "bg-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground/90">
                      {highlight(
                        email.subject || email.from.name,
                        query.trim(),
                      )}
                    </span>
                    <span className="shrink-0 truncate max-w-[35%] text-muted-foreground text-xs">
                      {email.from.name || email.from.email}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {showLocalResults && remoteSearchPending && (
            <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2 text-[12px] text-muted-foreground">
              <IconLoader2 className="h-3 w-3 animate-spin" />
              {t("mail.search.searchingGmail")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
