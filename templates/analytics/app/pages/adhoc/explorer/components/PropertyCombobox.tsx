import { useState, useMemo, useEffect, useRef } from "react";
import { IconCheck, IconSelector, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { KNOWN_PROPERTIES, ENRICHED_PROPERTY_MAP } from "../types";
import { useDynamicProperties } from "../use-dynamic-schema";

interface PropertyComboboxProps {
  value: string;
  onChange: (value: string) => void;
  triggerLabel?: string;
  /** If true, the popover opens automatically on mount */
  autoOpen?: boolean;
}

export function PropertyCombobox({
  value,
  onChange,
  triggerLabel,
  autoOpen,
}: PropertyComboboxProps) {
  const [open, setOpen] = useState(autoOpen ?? false);
  const { properties: dynamicProps, isLoading } = useDynamicProperties();
  const [search, setSearch] = useState("");

  const knownSet = useMemo(() => {
    const set = new Set<string>();
    for (const group of KNOWN_PROPERTIES) {
      for (const p of group.properties) set.add(p);
    }
    return set;
  }, []);

  const extraProps = useMemo(
    () => dynamicProps.filter((p) => !knownSet.has(p.name)),
    [dynamicProps, knownSet],
  );

  // Allow selecting a custom typed value not in the list
  const allKnown = useMemo(() => {
    const set = new Set(knownSet);
    for (const p of dynamicProps) set.add(p.name);
    return set;
  }, [knownSet, dynamicProps]);

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between font-normal text-sm h-7 px-2"
          size="sm"
        >
          <span className="truncate">
            {value || triggerLabel || "Select property..."}
          </span>
          <IconSelector className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Search or type property..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (e.key === "Enter" && search.trim()) {
                // If the search term isn't in the list, allow using it as custom
                const trimmed = search.trim();
                if (!allKnown.has(trimmed)) {
                  handleSelect(trimmed);
                  setSearch("");
                }
              }
            }}
          />
          <CommandList className="max-h-[350px]">
            <CommandEmpty>
              {isLoading ? (
                <div className="space-y-1.5 p-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-sm" />
                  ))}
                </div>
              ) : search.trim() ? (
                <button
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
                  onClick={() => {
                    handleSelect(search.trim());
                    setSearch("");
                  }}
                >
                  Use "<strong>{search.trim()}</strong>"
                </button>
              ) : (
                "No properties found."
              )}
            </CommandEmpty>
            {KNOWN_PROPERTIES.map((group) => (
              <CommandGroup key={group.category} heading={group.category}>
                {group.properties.map((prop) => {
                  const enriched = ENRICHED_PROPERTY_MAP.get(prop);
                  return (
                    <CommandItem
                      key={prop}
                      value={prop}
                      onSelect={handleSelect}
                    >
                      <IconCheck
                        className={cn(
                          "mr-2 h-3 w-3 shrink-0",
                          value === prop ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {enriched?.label ?? prop}
                      {enriched && (
                        <span className="ml-auto text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          joined
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
            {extraProps.length > 0 && (
              <CommandGroup heading={`Data Properties (${extraProps.length})`}>
                {extraProps.map((p) => (
                  <CommandItem
                    key={p.name}
                    value={p.name}
                    onSelect={handleSelect}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3 w-3 shrink-0",
                        value === p.name ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {p.count.toLocaleString()}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {isLoading && extraProps.length === 0 && (
              <CommandGroup>
                <div className="space-y-1.5 p-1">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-sm" />
                  ))}
                </div>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
