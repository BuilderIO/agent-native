import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContacts, type Contact } from "@/hooks/use-emails";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { data: contacts = [] } = useContacts();

  const recipients = parseRecipients(value);

  const filteredContacts = inputValue.trim()
    ? contacts.filter((c) => {
        const query = inputValue.toLowerCase();
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

  const removeRecipient = useCallback(
    (index: number) => {
      const updated = recipients.filter((_, i) => i !== index);
      onChange(serializeRecipients(updated));
    },
    [recipients, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab") {
      if (filteredContacts.length > 0 && showSuggestions) {
        e.preventDefault();
        addRecipient(filteredContacts[selectedIndex] || filteredContacts[0]);
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
    } else if (
      e.key === "Backspace" &&
      !inputValue &&
      recipients.length > 0
    ) {
      removeRecipient(recipients.length - 1);
    } else if (e.key === "ArrowDown" && showSuggestions) {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filteredContacts.length - 1));
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
    if (showSuggestions && filteredContacts.length > 0 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 280),
      });
    }
  }, [showSuggestions, filteredContacts.length, inputValue]);

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

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredContacts.length]);

  const dropdown =
    showSuggestions && filteredContacts.length > 0
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
              {filteredContacts.slice(0, 8).map((contact, i) => (
                <button
                  key={contact.email}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    i === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addRecipient(contact);
                  }}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                    {contact.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">
                      {contact.name}
                    </div>
                    {contact.name !== contact.email && (
                      <div className="truncate text-xs text-muted-foreground">
                        {contact.email}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="flex flex-wrap items-center gap-1 py-1.5">
        {recipients.map((r, i) => (
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
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
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
      </div>
      {dropdown}
    </div>
  );
}
