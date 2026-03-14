import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

type BaseToolbarProps = {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  tagOptions: string[];
  selectedTags: string[];
  onSelectedTagsChange: (value: string[]) => void;
  resultCount: number;
  onReset: () => void;
};

type BlogToolbarProps = BaseToolbarProps & {
  kind: "blog";
  categoryOptions: string[];
  selectedCategories: string[];
  onSelectedCategoriesChange: (value: string[]) => void;
  authorOptions: string[];
  selectedAuthors: string[];
  onSelectedAuthorsChange: (value: string[]) => void;
};

type DocsToolbarProps = BaseToolbarProps & {
  kind: "docs";
  showRedirectOnly: boolean;
  onShowRedirectOnlyChange: (value: boolean) => void;
  showNoIndexOnly: boolean;
  onShowNoIndexOnlyChange: (value: boolean) => void;
};

type ContentTableToolbarProps = BlogToolbarProps | DocsToolbarProps;

type ActiveFilter = {
  key: string;
  label: string;
  onRemove: () => void;
};

interface MultiSelectFilterProps {
  label: string;
  options: string[];
  selectedValues: string[];
  onSelectedValuesChange: (values: string[]) => void;
  emptyLabel: string;
  searchPlaceholder: string;
  className?: string;
}

function MultiSelectFilter({
  label,
  options,
  selectedValues,
  onSelectedValuesChange,
  emptyLabel,
  searchPlaceholder,
  className,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);

  const triggerLabel = useMemo(() => {
    if (selectedValues.length === 0) {
      return emptyLabel;
    }

    if (selectedValues.length === 1) {
      return selectedValues[0];
    }

    return `${selectedValues.length} selected`;
  }, [emptyLabel, selectedValues]);

  const toggleValue = (value: string) => {
    onSelectedValuesChange(
      selectedValues.includes(value)
        ? selectedValues.filter((selectedValue) => selectedValue !== value)
        : [...selectedValues, value],
    );
  };

  const clearValues = () => {
    onSelectedValuesChange([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-between font-normal sm:w-auto",
            selectedValues.length > 0 && "border-foreground/20 text-foreground",
            className,
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-0">
        <Command>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            {selectedValues.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={clearValues}
              >
                Clear
              </Button>
            )}
          </div>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedValues.includes(option);

                return (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => toggleValue(option)}
                    className="gap-2"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-sm border border-primary/40",
                        isSelected && "bg-primary text-primary-foreground",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{option}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ContentTableToolbar(props: ContentTableToolbarProps) {
  const hasActiveFilters =
    props.searchQuery.trim().length > 0 ||
    props.selectedTags.length > 0 ||
    (props.kind === "blog"
      ? props.selectedCategories.length > 0 || props.selectedAuthors.length > 0
      : props.showRedirectOnly || props.showNoIndexOnly);

  const activeFilters: ActiveFilter[] = [
    ...(props.searchQuery.trim()
      ? [
          {
            key: "search",
            label: `Search: ${props.searchQuery.trim()}`,
            onRemove: () => props.onSearchQueryChange(""),
          },
        ]
      : []),
    ...(props.kind === "blog"
      ? [
          ...props.selectedCategories.map((category) => ({
            key: `category-${category}`,
            label: `Category: ${category}`,
            onRemove: () =>
              props.onSelectedCategoriesChange(
                props.selectedCategories.filter((value) => value !== category),
              ),
          })),
          ...props.selectedAuthors.map((author) => ({
            key: `author-${author}`,
            label: `Author: ${author}`,
            onRemove: () =>
              props.onSelectedAuthorsChange(
                props.selectedAuthors.filter((value) => value !== author),
              ),
          })),
        ]
      : [
          ...(props.showRedirectOnly
            ? [
                {
                  key: "redirect-only",
                  label: "Redirect only",
                  onRemove: () => props.onShowRedirectOnlyChange(false),
                },
              ]
            : []),
          ...(props.showNoIndexOnly
            ? [
                {
                  key: "no-index-only",
                  label: "No index only",
                  onRemove: () => props.onShowNoIndexOnlyChange(false),
                },
              ]
            : []),
        ]),
    ...props.selectedTags.map((tag) => ({
      key: `tag-${tag}`,
      label: `Tag: ${tag}`,
      onRemove: () => props.onSelectedTagsChange(props.selectedTags.filter((value) => value !== tag)),
    })),
  ];

  return (
    <div className="rounded-md bg-card py-4">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={props.searchQuery}
              onChange={(event) => props.onSearchQueryChange(event.target.value)}
              placeholder={
                props.kind === "blog" ? "Search titles and authors..." : "Search titles..."
              }
              className="pl-9"
            />
          </div>

          {props.kind === "blog" ? (
            <>
              <MultiSelectFilter
                label="Categories"
                options={props.categoryOptions}
                selectedValues={props.selectedCategories}
                onSelectedValuesChange={props.onSelectedCategoriesChange}
                emptyLabel="All categories"
                searchPlaceholder="Filter categories..."
              />
              <MultiSelectFilter
                label="Authors"
                options={props.authorOptions}
                selectedValues={props.selectedAuthors}
                onSelectedValuesChange={props.onSelectedAuthorsChange}
                emptyLabel="All authors"
                searchPlaceholder="Filter authors..."
              />
              {props.tagOptions.length > 0 && (
                <MultiSelectFilter
                  label="Tags"
                  options={props.tagOptions}
                  selectedValues={props.selectedTags}
                  onSelectedValuesChange={props.onSelectedTagsChange}
                  emptyLabel="All tags"
                  searchPlaceholder="Filter tags..."
                />
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {props.tagOptions.length > 0 && (
                <MultiSelectFilter
                  label="Tags"
                  options={props.tagOptions}
                  selectedValues={props.selectedTags}
                  onSelectedValuesChange={props.onSelectedTagsChange}
                  emptyLabel="All tags"
                  searchPlaceholder="Filter tags..."
                  className="sm:w-auto"
                />
              )}
              <Toggle
                variant="outline"
                size="sm"
                pressed={props.showRedirectOnly}
                onPressedChange={props.onShowRedirectOnlyChange}
              >
                Redirect only
              </Toggle>
              <Toggle
                variant="outline"
                size="sm"
                pressed={props.showNoIndexOnly}
                onPressedChange={props.onShowNoIndexOnlyChange}
              >
                No index only
              </Toggle>
            </div>
          )}
        </div>

        {(hasActiveFilters || activeFilters.length > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {hasActiveFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={props.onReset}>
                Clear all
              </Button>
            )}
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={filter.onRemove}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
              >
                <span>{filter.label}</span>
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
