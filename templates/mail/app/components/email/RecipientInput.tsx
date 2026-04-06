import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import {
  IconX,
  IconUsersGroup,
  IconPencil,
  IconArrowsDiagonal,
  IconPlus,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useContacts, type Contact } from "@/hooks/use-emails";
import { useAliases, useCreateAlias } from "@/hooks/use-aliases";
import {
  isAliasToken,
  aliasIdFromToken,
  ALIAS_PREFIX,
} from "@/lib/alias-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Alias } from "@shared/types";

interface RecipientInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

function parseRecipients(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeRecipients(recipients: string[]): string {
  return recipients.join(", ");
}

// ─── AliasPopover ─────────────────────────────────────────────────────────────

interface AliasPopoverProps {
  alias: Alias;
  anchorEl: HTMLElement;
  onClose: () => void;
  onExpand: () => void;
}

function AliasPopover({
  alias,
  anchorEl,
  onClose,
  onExpand,
}: AliasPopoverProps) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    setPos({
      top: rect.bottom + 6,
      left: rect.left,
    });
  }, [anchorEl]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !anchorEl.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [anchorEl, onClose]);

  const handleEdit = () => {
    navigate(`/settings?alias=${alias.id}`);
    onClose();
  };

  const handleExpand = () => {
    onExpand();
    onClose();
  };

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9999] w-72 rounded-xl border border-border bg-popover shadow-xl"
      style={{ top: pos.top, left: pos.left }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <IconUsersGroup className="size-4 shrink-0 text-indigo-400" />
        <span className="flex-1 truncate text-[13px] font-semibold text-foreground">
          {alias.name}
        </span>
        <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
          {alias.emails.length} recipients
        </span>
        <button
          type="button"
          title="Edit alias"
          onClick={handleEdit}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconPencil className="size-3.5" />
        </button>
        <button
          type="button"
          title="Expand to individual emails"
          onClick={handleExpand}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconArrowsDiagonal className="size-3.5" />
        </button>
      </div>
      {/* Email list */}
      <div className="max-h-[180px] overflow-y-auto p-1.5">
        {alias.emails.map((email) => (
          <div
            key={email}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[10px] font-semibold uppercase text-indigo-300">
              {email[0]}
            </div>
            <span className="truncate text-[12px] text-muted-foreground">
              {email}
            </span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─── SaveAliasModal ───────────────────────────────────────────────────────────

interface SaveAliasModalProps {
  emails: string[];
  onClose: () => void;
}

function SaveAliasModal({ emails, onClose }: SaveAliasModalProps) {
  const [name, setName] = useState("");
  const createAlias = useCreateAlias();

  const handleSave = async () => {
    if (!name.trim()) return;
    await createAlias.mutateAsync({ name: name.trim(), emails });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[14px]">Save as alias</DialogTitle>
          <DialogDescription className="text-[12px]">
            Create a reusable group of {emails.length} recipients
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            e.stopPropagation();
          }}
          placeholder="Alias name"
        />
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || createAlias.isPending}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {createAlias.isPending ? "Saving…" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── RecipientInput ───────────────────────────────────────────────────────────

export function RecipientInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: RecipientInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const [popoverAlias, setPopoverAlias] = useState<{
    alias: Alias;
    anchorEl: HTMLElement;
  } | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: contacts = [] } = useContacts();
  const { data: aliases = [] } = useAliases();

  const recipients = parseRecipients(value);

  const query = inputValue.toLowerCase().trim();

  const filteredAliases = query
    ? aliases.filter((a) => {
        const alreadyAdded = recipients.includes(`${ALIAS_PREFIX}${a.id}`);
        return !alreadyAdded && a.name.toLowerCase().includes(query);
      })
    : [];

  // Contacts come pre-sorted by frequency from the server (SQL-tracked send counts)
  const filteredContacts = query
    ? contacts.filter((c) => {
        const alreadyAdded = recipients.some(
          (r) => r.toLowerCase() === c.email.toLowerCase(),
        );
        return (
          !alreadyAdded &&
          (c.name.toLowerCase().includes(query) ||
            c.email.toLowerCase().includes(query))
        );
      })
    : [];

  // Combined for keyboard nav — aliases first (sliced to match dropdown rendering)
  const aliasSlice = filteredAliases.slice(0, 4);
  const contactSlice = filteredContacts.slice(
    0,
    8 - Math.min(filteredAliases.length, 4),
  );
  const allSuggestions: Array<
    { type: "alias"; item: Alias } | { type: "contact"; item: Contact }
  > = [
    ...aliasSlice.map((a) => ({ type: "alias" as const, item: a })),
    ...contactSlice.map((c) => ({ type: "contact" as const, item: c })),
  ];

  const hasSuggestions = allSuggestions.length > 0;

  const addRecipient = useCallback(
    (emailOrContact: string | Contact) => {
      const email =
        typeof emailOrContact === "string"
          ? emailOrContact.trim()
          : emailOrContact.email;
      if (!email) return;
      const alreadyAdded = recipients.some(
        (r) => r.toLowerCase() === email.toLowerCase(),
      );
      if (alreadyAdded) {
        setInputValue("");
        setShowSuggestions(false);
        return;
      }
      const updated = [...recipients, email];
      onChange(serializeRecipients(updated));
      setInputValue("");
      setShowSuggestions(false);
      setSelectedIndex(0);
    },
    [recipients, onChange],
  );

  const addAliasToken = useCallback(
    (alias: Alias) => {
      const token = `${ALIAS_PREFIX}${alias.id}`;
      const alreadyAdded = recipients.includes(token);
      if (alreadyAdded) {
        setInputValue("");
        setShowSuggestions(false);
        return;
      }
      const updated = [...recipients, token];
      onChange(serializeRecipients(updated));
      setInputValue("");
      setShowSuggestions(false);
      setSelectedIndex(0);
    },
    [recipients, onChange],
  );

  const removeRecipient = useCallback(
    (index: number) => {
      const updated = recipients.filter((_, i) => i !== index);
      onChange(serializeRecipients(updated));
    },
    [recipients, onChange],
  );

  const expandAlias = useCallback(
    (index: number) => {
      const token = recipients[index];
      const id = aliasIdFromToken(token);
      const alias = aliases.find((a) => a.id === id);
      if (!alias) return;
      const before = recipients.slice(0, index);
      const after = recipients.slice(index + 1);
      const expanded = [...new Set(alias.emails)];
      onChange(serializeRecipients([...before, ...expanded, ...after]));
    },
    [recipients, aliases, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab") {
      if (hasSuggestions && showSuggestions) {
        e.preventDefault();
        const suggestion = allSuggestions[selectedIndex] ?? allSuggestions[0];
        if (suggestion.type === "alias") {
          addAliasToken(suggestion.item);
        } else {
          addRecipient(suggestion.item);
        }
      } else if (inputValue.trim()) {
        e.preventDefault();
        addRecipient(inputValue);
      } else if (e.key === "Tab") {
        return;
      }
    } else if (e.key === ",") {
      e.preventDefault();
      if (inputValue.trim()) {
        addRecipient(inputValue);
      }
    } else if (e.key === "Backspace" && !inputValue && recipients.length > 0) {
      removeRecipient(recipients.length - 1);
    } else if (e.key === "ArrowDown" && showSuggestions) {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, allSuggestions.length - 1));
    } else if (e.key === "ArrowUp" && showSuggestions) {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape" && showSuggestions) {
      e.stopPropagation();
      setShowSuggestions(false);
    }
  };

  // Position dropdown relative to container, rendered via portal
  useLayoutEffect(() => {
    if (showSuggestions && hasSuggestions && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 280),
      });
    }
  }, [showSuggestions, hasSuggestions, inputValue]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Clamp selected index when filtered list changes (preserves position when possible)
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, allSuggestions.length - 1));
  }, [allSuggestions.length]);

  const dropdown =
    showSuggestions && hasSuggestions
      ? createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
            }}
          >
            <div className="max-h-[200px] overflow-y-auto p-1">
              {filteredAliases.slice(0, 4).map((alias, i) => (
                <button
                  key={`alias-${alias.id}`}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors",
                    i === selectedIndex
                      ? "bg-indigo-500/12 text-indigo-200"
                      : "bg-indigo-500/6 hover:bg-indigo-500/12",
                  )}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addAliasToken(alias);
                  }}
                >
                  <IconUsersGroup className="size-3.5 shrink-0 text-indigo-400" />
                  <span className="flex-1 truncate font-medium text-indigo-200">
                    {alias.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-indigo-400/70">
                    {alias.emails.length} people
                  </span>
                </button>
              ))}
              {filteredContacts
                .slice(0, 8 - Math.min(filteredAliases.length, 4))
                .map((contact, i) => {
                  const globalIndex = Math.min(filteredAliases.length, 4) + i;
                  return (
                    <button
                      key={contact.email}
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between gap-4 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors",
                        globalIndex === selectedIndex
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50",
                      )}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addRecipient(contact);
                      }}
                    >
                      <span className="truncate font-medium text-foreground">
                        {contact.name}
                      </span>
                      {contact.name !== contact.email && (
                        <span className="truncate text-[12px] text-muted-foreground/60 shrink-0">
                          {contact.email}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>,
          document.body,
        )
      : null;

  // Non-alias recipients for save-as-alias
  const nonAliasRecipients = recipients.filter((r) => !isAliasToken(r));
  const canSaveAlias = nonAliasRecipients.length >= 2;

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="flex flex-wrap items-center gap-1 py-1.5">
        {recipients.map((r, i) => {
          if (isAliasToken(r)) {
            const id = aliasIdFromToken(r);
            const alias = aliases.find((a) => a.id === id);
            const displayName = alias?.name ?? id;
            const count = alias?.emails.length ?? 0;
            return (
              <span
                key={`${r}-${i}`}
                className="flex items-center gap-0.5 rounded-md border border-indigo-500/35 bg-indigo-500/18 px-2 py-0.5 text-xs"
              >
                <button
                  type="button"
                  className="flex items-center gap-1 text-indigo-200 hover:text-indigo-100 transition-colors"
                  onClick={(e) => {
                    const anchor = e.currentTarget.closest("span");
                    if (alias && anchor instanceof HTMLElement) {
                      setPopoverAlias({ alias, anchorEl: anchor });
                    }
                  }}
                >
                  <IconUsersGroup className="size-3 shrink-0" />
                  <span className="max-w-[140px] truncate font-medium">
                    {displayName}
                  </span>
                  {count > 0 && (
                    <span className="rounded-full bg-indigo-500/25 px-1.5 py-px text-[10px] font-medium text-indigo-300">
                      {count}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => removeRecipient(i)}
                  className="ml-0.5 rounded-sm p-0.5 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                >
                  <IconX className="size-2.5" />
                </button>
              </span>
            );
          }

          return (
            <span
              key={`${r}-${i}`}
              className="flex items-center gap-0.5 rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground"
            >
              <span className="max-w-[180px] truncate">{r}</span>
              <button
                type="button"
                onClick={() => removeRecipient(i)}
                className="ml-0.5 rounded-sm p-0.5 hover:bg-foreground/10 transition-colors"
              >
                <IconX className="size-2.5" />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => {
            if (inputValue.trim()) setShowSuggestions(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={recipients.length === 0 ? placeholder : ""}
          className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autoFocus={autoFocus}
        />
        {canSaveAlias && (
          <button
            type="button"
            onClick={() => setShowSaveModal(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/35 transition-colors hover:text-muted-foreground/60"
          >
            <IconPlus className="size-3" />
            Save as alias
          </button>
        )}
      </div>
      {dropdown}
      {popoverAlias && (
        <AliasPopover
          alias={popoverAlias.alias}
          anchorEl={popoverAlias.anchorEl}
          onClose={() => setPopoverAlias(null)}
          onExpand={() => {
            const index = recipients.indexOf(
              `${ALIAS_PREFIX}${popoverAlias.alias.id}`,
            );
            if (index !== -1) expandAlias(index);
          }}
        />
      )}
      {showSaveModal && (
        <SaveAliasModal
          emails={nonAliasRecipients}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </div>
  );
}
