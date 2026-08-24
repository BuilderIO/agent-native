import { useT } from "@agent-native/core/client/i18n";
import {
  IconSearch,
  IconX,
  IconUserPlus,
  IconLoader2,
} from "@tabler/icons-react";
import { useState, useEffect, useMemo, useRef } from "react";

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
import {
  filterPeopleResults,
  mergePeopleResults,
  usePeopleContacts,
  usePeopleSearch,
} from "@/hooks/use-people";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PeopleSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PeopleSearchDialog({
  open,
  onOpenChange,
}: PeopleSearchDialogProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldScrollActiveResultRef = useRef(false);

  const { data: rawOverlayPeople } = useOverlayPeople();
  const overlayPeople = Array.isArray(rawOverlayPeople) ? rawOverlayPeople : [];
  const addPerson = useAddOverlayPerson();
  const removePerson = useRemoveOverlayPerson();
  const contacts = usePeopleContacts("directory", open);
  const directorySearch = usePeopleSearch(searchQuery, open, "directory");

  const overlayEmails = useMemo(
    () => new Set(overlayPeople.map((p) => p.email.toLowerCase())),
    [overlayPeople],
  );

  const results = useMemo(
    () =>
      filterPeopleResults(
        mergePeopleResults(
          contacts.data?.results,
          directorySearch.data?.results,
        ),
        query,
        new Set(),
      ),
    [contacts.data?.results, directorySearch.data?.results, query],
  );

  // Selectable results (exclude already-added)
  const selectableResults = results.filter(
    (r) => !overlayEmails.has(r.email.toLowerCase()),
  );

  const searching =
    contacts.isLoading ||
    contacts.isFetching ||
    directorySearch.isLoading ||
    directorySearch.isFetching;
  const scopeRequired = Boolean(
    contacts.data?.scopeRequired || directorySearch.data?.scopeRequired,
  );

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setSearchQuery(query),
      query.trim() ? 300 : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [query]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(results.length > 0 ? 0 : -1);
  }, [results]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSearchQuery("");
      setActiveIndex(-1);
    }
  }, [open]);

  function handleAdd(email: string, name?: string) {
    addPerson.mutate({ email, name });
  }

  // Scroll active item into view
  useEffect(() => {
    if (
      activeIndex < 0 ||
      !listRef.current ||
      !shouldScrollActiveResultRef.current
    ) {
      return;
    }
    shouldScrollActiveResultRef.current = false;
    const items = listRef.current.querySelectorAll("[data-selectable-result]");
    items[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      shouldScrollActiveResultRef.current = true;
      setActiveIndex((i) => (i < selectableResults.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      shouldScrollActiveResultRef.current = true;
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
      if (
        EMAIL_REGEX.test(trimmed) &&
        !overlayEmails.has(trimmed.toLowerCase())
      ) {
        handleAdd(trimmed);
        setQuery("");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] gap-0 p-0 top-[15vh] !translate-y-0">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="text-base">
            {t("eventForm.people")}
          </DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="relative px-4 pt-3 pb-2">
          <IconSearch className="absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("eventForm.searchPeoplePlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            autoFocus
          />
          {searching && (
            <IconLoader2 className="absolute right-7 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Search results */}
        {results.length > 0 && (
          <div
            ref={listRef}
            className="max-h-48 overflow-y-auto border-t border-border"
          >
            {results.map((person) => {
              const alreadyAdded = overlayEmails.has(
                person.email.toLowerCase(),
              );
              const selectableIdx = selectableResults.indexOf(person);
              const isActive = !alreadyAdded && selectableIdx === activeIndex;
              return (
                <button
                  key={person.email}
                  data-result
                  data-selectable-result={alreadyAdded ? undefined : ""}
                  disabled={alreadyAdded}
                  onClick={() => handleAdd(person.email, person.name)}
                  onMouseEnter={() => {
                    if (!alreadyAdded) {
                      shouldScrollActiveResultRef.current = false;
                      setActiveIndex(selectableIdx);
                    }
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm disabled:opacity-40 ${
                    isActive
                      ? "bg-accent text-foreground"
                      : "hover:bg-accent/50"
                  }`}
                >
                  <IconUserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
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
                    <span className="text-xs text-muted-foreground">
                      {t("eventForm.added")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Scope hint */}
        {scopeRequired && (
          <div className="px-4 py-2 text-xs text-muted-foreground">
            {t("eventForm.directorySearchLimited")}
          </div>
        )}

        {/* Manual email hint */}
        {query.length > 0 &&
          results.length === 0 &&
          !searching &&
          EMAIL_REGEX.test(query.trim()) && (
            <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              {t("eventForm.press")}{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-mono">
                Enter
              </kbd>{" "}
              {t("eventForm.toAdd")}{" "}
              <span className="font-medium text-foreground">
                {query.trim()}
              </span>
            </div>
          )}

        {/* Current overlay people */}
        {overlayPeople.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("eventForm.showingCalendars")}
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
                    <IconX className="h-3.5 w-3.5" />
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
