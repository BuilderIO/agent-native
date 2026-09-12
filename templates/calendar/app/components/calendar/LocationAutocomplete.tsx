import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface LocationAutocompleteProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  label: string;
  placeholder?: string;
  className?: string;
}

export function LocationAutocomplete({
  id,
  value,
  onChange,
  suggestions,
  label,
  placeholder,
  className,
}: LocationAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = `${id}-suggestions`;
  const filteredSuggestions = useMemo(() => {
    const query = value.trim().toLocaleLowerCase();
    return suggestions.filter(
      (suggestion) => !query || suggestion.toLocaleLowerCase().includes(query),
    );
  }, [suggestions, value]);
  const showSuggestions = open && filteredSuggestions.length > 0;

  useEffect(() => {
    setActiveIndex((index) =>
      filteredSuggestions.length === 0
        ? -1
        : Math.min(index, filteredSuggestions.length - 1),
    );
  }, [filteredSuggestions.length]);

  const selectSuggestion = useCallback(
    (suggestion: string) => {
      setOpen(false);
      setActiveIndex(-1);
      onChange(suggestion);
    },
    [onChange],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && filteredSuggestions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      setActiveIndex((index) =>
        index < 0 || index === filteredSuggestions.length - 1 ? 0 : index + 1,
      );
      return;
    }

    if (event.key === "ArrowUp" && filteredSuggestions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      setActiveIndex((index) =>
        index <= 0 ? filteredSuggestions.length - 1 : index - 1,
      );
      return;
    }

    if (event.key === "Enter" && showSuggestions && activeIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      selectSuggestion(filteredSuggestions[activeIndex]!);
      return;
    }

    if (event.key === "Escape" && showSuggestions) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <Popover open={showSuggestions} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div data-location-autocomplete>
          <Input
            id={id}
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls={listId}
            aria-activedescendant={
              showSuggestions && activeIndex >= 0
                ? `${listId}-option-${activeIndex}`
                : undefined
            }
            autoComplete="off"
            value={value}
            onChange={(event) => {
              setOpen(true);
              setActiveIndex(-1);
              onChange(event.currentTarget.value);
            }}
            onFocus={() => {
              if (filteredSuggestions.length > 0) {
                setOpen(true);
                setActiveIndex(-1);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={className}
          />
        </div>
      </PopoverAnchor>
      {showSuggestions && (
        <PopoverContent
          data-location-autocomplete
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="w-[var(--radix-popover-trigger-width)] p-1"
        >
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-48 overflow-y-auto"
          >
            {filteredSuggestions.map((suggestion, index) => (
              <div
                id={`${listId}-option-${index}`}
                key={suggestion}
                role="option"
                aria-selected={activeIndex === index}
                className={cn(
                  "cursor-pointer rounded px-2 py-1.5 text-sm",
                  activeIndex === index && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectSuggestion(suggestion);
                }}
              >
                {suggestion}
              </div>
            ))}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
