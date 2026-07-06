import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@agent-native/toolkit/ui/popover";
import {
  IconAddressBook,
  IconBuilding,
  IconLoader2,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  filterPeopleResults,
  usePeopleContacts,
  type PeopleSearchResult,
} from "@/hooks/use-people";
import { isMcpEmbedSurface } from "@/lib/mcp-embed";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AttendeeRecipient {
  email: string;
  displayName?: string;
  photoUrl?: string;
}

export interface AttendeeAutocompleteHandle {
  commitPending: () => AttendeeRecipient[];
}

interface AttendeeAutocompleteProps {
  attendees?: AttendeeRecipient[];
  selectedEmails?: string[];
  onAdd: (attendee: AttendeeRecipient) => void;
  onRemove?: (email: string) => void;
  inputId?: string;
  placeholder?: string;
  autoFocus?: boolean;
  variant?: "box" | "inline";
  showChips?: boolean;
  showAddButton?: boolean;
  className?: string;
  inputClassName?: string;
  onEscape?: () => void;
  onEmptyEnter?: () => void;
}

function parseEmails(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => EMAIL_RE.test(part)),
    ),
  );
}

function sourceLabel(
  t: ReturnType<typeof useT>,
  source?: PeopleSearchResult["source"],
) {
  switch (source) {
    case "directory":
      return t("attendees.directory");
    case "otherContact":
      return t("attendees.otherContacts");
    default:
      return t("attendees.contacts");
  }
}

function SourceIcon({ source }: { source?: PeopleSearchResult["source"] }) {
  if (source === "directory") {
    return <IconBuilding className="h-3 w-3" />;
  }
  return <IconAddressBook className="h-3 w-3" />;
}

function initialsFor(person: PeopleSearchResult | AttendeeRecipient) {
  const label =
    "name" in person
      ? person.name || person.email
      : person.displayName || person.email;
  return label
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export const AttendeeAutocomplete = forwardRef<
  AttendeeAutocompleteHandle,
  AttendeeAutocompleteProps
>(function AttendeeAutocomplete(
  {
    attendees = [],
    selectedEmails,
    onAdd,
    onRemove,
    inputId,
    placeholder = "Add guests",
    autoFocus,
    variant = "box",
    showChips = true,
    showAddButton = false,
    className,
    inputClassName,
    onEscape,
    onEmptyEnter,
  },
  ref,
) {
  const t = useT();
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const contacts = usePeopleContacts();

  const selectedEmailSet = useMemo(
    () =>
      new Set(
        (selectedEmails ?? attendees.map((attendee) => attendee.email)).map(
          (email) => email.toLowerCase(),
        ),
      ),
    [attendees, selectedEmails],
  );

  const visibleResults = useMemo(
    () =>
      filterPeopleResults(
        contacts.data?.results ?? [],
        inputValue,
        selectedEmailSet,
      ),
    [contacts.data?.results, inputValue, selectedEmailSet],
  );

  const canAddManual = parseEmails(inputValue).length > 0;
  const searching = contacts.isLoading || contacts.isFetching;
  const scopeRequired = Boolean(contacts.data?.scopeRequired);
  const shouldShowPopover =
    open &&
    inputValue.trim().length > 0 &&
    (visibleResults.length > 0 || searching || scopeRequired || canAddManual);

  const addPerson = useCallback(
    (person: PeopleSearchResult | AttendeeRecipient) => {
      const email = person.email.trim();
      if (!EMAIL_RE.test(email) || selectedEmailSet.has(email.toLowerCase())) {
        setInputValue("");
        setOpen(false);
        return;
      }

      const displayName =
        "name" in person
          ? person.name && person.name !== person.email
            ? person.name
            : undefined
          : person.displayName;

      onAdd({
        email,
        displayName,
        photoUrl: person.photoUrl,
      });
      setInputValue("");
      setOpen(false);
      setActiveIndex(0);
    },
    [onAdd, selectedEmailSet],
  );

  const commitManualInput = useCallback(() => {
    const existing = new Set(selectedEmailSet);
    const added: AttendeeRecipient[] = [];

    for (const email of parseEmails(inputValue)) {
      if (existing.has(email)) continue;
      existing.add(email);
      const attendee = { email };
      added.push(attendee);
      onAdd(attendee);
    }

    if (added.length > 0) {
      setInputValue("");
      setOpen(false);
      setActiveIndex(0);
    }

    return added;
  }, [inputValue, onAdd, selectedEmailSet]);

  const commitActiveOrManual = useCallback(() => {
    if (visibleResults.length > 0) {
      addPerson(
        visibleResults[Math.min(activeIndex, visibleResults.length - 1)],
      );
      return [];
    }
    return commitManualInput();
  }, [activeIndex, addPerson, commitManualInput, visibleResults]);

  useImperativeHandle(
    ref,
    () => ({
      commitPending: commitManualInput,
    }),
    [commitManualInput],
  );

  useEffect(() => {
    setActiveIndex((index) =>
      visibleResults.length === 0
        ? 0
        : Math.min(index, visibleResults.length - 1),
    );
  }, [visibleResults.length]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();

    if (event.key === "ArrowDown" && shouldShowPopover) {
      event.preventDefault();
      setActiveIndex((index) =>
        visibleResults.length === 0
          ? 0
          : Math.min(index + 1, visibleResults.length - 1),
      );
      return;
    }

    if (event.key === "ArrowUp" && shouldShowPopover) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      if (shouldShowPopover || inputValue.trim()) {
        event.preventDefault();
        commitActiveOrManual();
        return;
      }
      if (event.key === "Enter" && onEmptyEnter) {
        event.preventDefault();
        onEmptyEnter();
      }
      return;
    }

    if (event.key === "," || event.key === ";") {
      if (canAddManual) {
        event.preventDefault();
        commitManualInput();
      }
      return;
    }

    if (
      event.key === "Backspace" &&
      !inputValue &&
      showChips &&
      attendees.length > 0 &&
      onRemove
    ) {
      event.preventDefault();
      onRemove(attendees[attendees.length - 1].email);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (shouldShowPopover) {
        setOpen(false);
      } else {
        onEscape?.();
      }
    }
  }

  return (
    <Popover open={shouldShowPopover} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          data-attendee-autocomplete
          className={cn(
            variant === "box"
              ? "rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus-within:ring-1 focus-within:ring-ring"
              : "flex min-w-0 flex-1 items-center gap-2",
            className,
          )}
          onClick={() => inputRef.current?.focus()}
        >
          {showChips && attendees.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {attendees.map((attendee) => (
                <span
                  key={attendee.email}
                  className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]"
                >
                  <span className="truncate">
                    {attendee.displayName || attendee.email}
                  </span>
                  {onRemove && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemove(attendee.email);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={t("attendees.removeAttendee", {
                        email: attendee.email,
                      })}
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          <div className="flex min-w-0 items-center gap-2">
            <input
              ref={inputRef}
              id={inputId}
              data-attendee-input
              type="text"
              value={inputValue}
              onChange={(event) => {
                setInputValue(event.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                if (inputValue.trim()) setOpen(true);
              }}
              onBlur={() => {
                if (canAddManual) commitManualInput();
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                attendees.length === 0
                  ? placeholder
                  : t("attendees.addAnotherGuest")
              }
              className={cn(
                "min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60",
                inputClassName,
              )}
              autoFocus={autoFocus}
            />
            {showAddButton && inputValue.trim() && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-2 text-xs"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitActiveOrManual()}
              >
                {t("bookingLinks.add")}
              </Button>
            )}
          </div>
        </div>
      </PopoverAnchor>

      <PopoverContent
        data-attendee-autocomplete
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden p-1"
      >
        <div className="max-h-64 overflow-y-auto">
          {searching && visibleResults.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              {t("attendees.searchingPeople")}
            </div>
          )}

          {visibleResults.map((person, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={person.email}
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  addPerson(person);
                }}
              >
                {person.photoUrl && !isMcpEmbedSurface() ? (
                  <img
                    src={person.photoUrl}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  // MCP host iframes (ChatGPT / Claude) block cross-origin
                  // googleusercontent.com contact avatars at the COEP layer
                  // and produce console errors. Fall back to initials when
                  // rendered in an embedded surface.
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                    {initialsFor(person) || (
                      <IconUserCircle className="h-4 w-4" />
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {person.name || person.email}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {person.email}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <SourceIcon source={person.source} />
                  {sourceLabel(t, person.source)}
                </span>
              </button>
            );
          })}

          {visibleResults.length === 0 && !searching && canAddManual && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent/50"
              onMouseDown={(event) => {
                event.preventDefault();
                commitManualInput();
              }}
            >
              <IconUserCircle className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">
                {t("attendees.inviteEmail", {
                  email: parseEmails(inputValue)[0],
                })}
              </span>
            </button>
          )}

          {visibleResults.length === 0 &&
            !searching &&
            !canAddManual &&
            scopeRequired && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {t("attendees.contactsReconnect")}
              </div>
            )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
