import { useState, useEffect, useRef, useCallback } from "react";
import {
  IconSearch,
  IconX,
  IconUserPlus,
  IconLoader2,
  IconLink,
  IconCalendarPlus,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useOverlayPeople,
  useAddOverlayPerson,
  useRemoveOverlayPerson,
} from "@/hooks/use-overlay-people";
import {
  useExternalCalendars,
  useAddExternalCalendar,
  useRemoveExternalCalendar,
} from "@/hooks/use-external-calendars";
import { toast } from "sonner";

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
const URL_REGEX = /^(https?|webcal):\/\/.+/i;

interface AddCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "people" | "url";
}

export function AddCalendarDialog({
  open,
  onOpenChange,
  defaultTab = "people",
}: AddCalendarDialogProps) {
  const [activeTab, setActiveTab] = useState<"people" | "url">(defaultTab);

  // Sync default tab when dialog opens
  useEffect(() => {
    if (open) setActiveTab(defaultTab);
  }, [open, defaultTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] gap-0 p-0 top-[8%] translate-y-0">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="text-base">Add Calendar</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "people" | "url")}
          className="mt-3"
        >
          <TabsList className="mx-4 w-[calc(100%-2rem)]">
            <TabsTrigger value="people" className="flex-1">
              People
            </TabsTrigger>
            <TabsTrigger value="url" className="flex-1">
              From URL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="people" className="mt-0">
            <PeopleTab onClose={() => onOpenChange(false)} />
          </TabsContent>

          <TabsContent value="url" className="mt-0 px-4 pb-4 pt-3">
            <UrlTab onClose={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ─── People tab ──────────────────────────────────────────────────────────────

function PeopleTab({ onClose: _ }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [scopeRequired, setScopeRequired] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const listRef = useRef<HTMLDivElement>(null);

  const { data: rawOverlayPeople } = useOverlayPeople();
  const overlayPeople = Array.isArray(rawOverlayPeople) ? rawOverlayPeople : [];
  const addPerson = useAddOverlayPerson();
  const removePerson = useRemoveOverlayPerson();

  const overlayEmails = new Set(overlayPeople.map((p) => p.email));
  const selectableResults = results.filter((r) => !overlayEmails.has(r.email));

  const search = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const url = q
        ? `/_agent-native/actions/search-people?q=${encodeURIComponent(q)}`
        : `/_agent-native/actions/search-people`;
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

  useEffect(() => {
    setActiveIndex(results.length > 0 ? 0 : -1);
  }, [results]);

  useEffect(() => {
    setQuery("");
    setResults([]);
    setScopeRequired(false);
    setActiveIndex(-1);
    search("");
  }, [search]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-result]");
    items[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function handleAdd(email: string, name?: string) {
    addPerson.mutate({ email, name });
  }

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
      if (activeIndex >= 0 && activeIndex < selectableResults.length) {
        const person = selectableResults[activeIndex];
        handleAdd(person.email, person.name);
        return;
      }
      const trimmed = query.trim();
      if (EMAIL_REGEX.test(trimmed) && !overlayEmails.has(trimmed)) {
        handleAdd(trimmed);
        setQuery("");
      }
    }
  }

  return (
    <>
      <div className="relative px-4 pt-3 pb-2">
        <IconSearch className="absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
          <IconLoader2 className="absolute right-7 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

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
                  isActive ? "bg-accent text-foreground" : "hover:bg-accent/50"
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
                  <span className="text-xs text-muted-foreground">Added</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {scopeRequired && (
        <div className="px-4 py-2 text-xs text-muted-foreground">
          Directory search is limited. Type a full email and press Enter to add.
        </div>
      )}

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
            <span className="font-medium text-foreground">{query.trim()}</span>
          </div>
        )}

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
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── URL / ICS tab ───────────────────────────────────────────────────────────

function UrlTab({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const addCalendar = useAddExternalCalendar();
  const removeCalendar = useRemoveExternalCalendar();
  const { data: rawCalendars } = useExternalCalendars();
  const calendars = Array.isArray(rawCalendars) ? rawCalendars : [];

  const canSubmit = URL_REGEX.test(url.trim()) && !addCalendar.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    addCalendar.mutate(
      { url: url.trim() },
      {
        onSuccess: (cal) => {
          toast.success(`"${cal.name}" added`);
          setUrl("");
          onClose();
        },
        onError: () => toast.error("Failed to add calendar"),
      },
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="cal-url" className="text-xs">
            URL
          </Label>
          <div className="relative">
            <IconLink className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="cal-url"
              placeholder="webcal:// or https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Paste a webcal:// or https:// ICS feed URL
          </p>
        </div>
        <Button
          type="submit"
          size="sm"
          className="w-full"
          disabled={!canSubmit}
        >
          {addCalendar.isPending ? (
            <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <IconCalendarPlus className="mr-1.5 h-4 w-4" />
          )}
          Add Calendar
        </Button>
      </form>

      {calendars.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Subscribed feeds
          </p>
          <div className="space-y-1.5">
            {calendars.map((cal) => (
              <div key={cal.id} className="flex items-center gap-2.5 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: cal.color }}
                />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {cal.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeCalendar.mutate(cal.id)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
