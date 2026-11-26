import { cn } from "@agent-native/toolkit/utils";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface FilterListboxItem {
  key: string;
  label: string;
  section?: string | undefined;
  icon?: ReactNode;
  detail?: ReactNode;
  checked?: boolean | undefined;
}

export interface FilterListboxProps {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  items: readonly FilterListboxItem[];
  empty: ReactNode;
  onPick: (item: FilterListboxItem, via: "enter" | "pointer") => void;
  footer?: ReactNode;
  autoFocus?: boolean;
  label: string;
  multiple?: boolean;
}

export function FilterListbox({
  query,
  onQueryChange,
  placeholder,
  items,
  empty,
  onPick,
  footer,
  autoFocus = true,
  label,
  multiple = false,
}: FilterListboxProps) {
  const id = useId();
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex =
    items.length === 0 ? -1 : Math.min(active, items.length - 1);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const option = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    option?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const move = (delta: number) => {
    if (items.length === 0) return;
    setActive((activeIndex + delta + items.length) % items.length);
  };

  let lastSection: string | undefined;
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3">
        <IconSearch className="size-4 shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={
            activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
          }
          aria-label={label}
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            ) {
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const item = activeIndex >= 0 ? items.at(activeIndex) : undefined;
              if (item) onPick(item, "enter");
            }
          }}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        className={cn(
          "max-h-72 overflow-y-auto overscroll-contain p-1",
          footer ? "min-h-24" : undefined,
        )}
      >
        {items.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">{empty}</div>
        ) : (
          items.map((item, index) => {
            const heading =
              item.section !== undefined && item.section !== lastSection
                ? item.section
                : undefined;
            lastSection = item.section;
            return (
              <div key={item.key}>
                {heading ? (
                  <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    {heading}
                  </div>
                ) : null}
                <div
                  id={`${id}-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={item.checked ?? index === activeIndex}
                  onPointerMove={() => {
                    if (index !== activeIndex) setActive(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(item, "pointer")}
                  className={cn(
                    "flex min-w-0 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                    index === activeIndex && "bg-accent text-accent-foreground",
                  )}
                >
                  {item.checked === undefined ? null : (
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                        item.checked &&
                          "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {item.checked ? <IconCheck className="size-3" /> : null}
                    </span>
                  )}
                  {item.icon ? (
                    <span className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4">
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate" title={item.label}>
                    {item.label}
                  </span>
                  {item.detail === undefined ? null : (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      {footer}
    </div>
  );
}
