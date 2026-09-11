import { useT } from "@agent-native/core/client/i18n";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useId } from "react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function WorkspaceAppSearch({
  query,
  onQueryChange,
  className,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  className?: string;
}) {
  const t = useT();
  const inputId = useId();
  const label = t("dispatch.pages.searchApps", {
    defaultValue: "Search apps",
  });
  const placeholder = t("dispatch.pages.searchAppsPlaceholder", {
    defaultValue: "Search apps",
  });

  return (
    <div role="search" className={cn("flex items-center gap-2", className)}>
      <div className="relative min-w-0 flex-1">
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <IconSearch
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={inputId}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          className="h-9 bg-background ps-9"
          autoComplete="off"
        />
      </div>
      {query ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5 text-muted-foreground"
          onClick={() => onQueryChange("")}
        >
          <IconX size={14} aria-hidden="true" />
          <span>
            {t("dispatch.pages.clearAppSearch", {
              defaultValue: "Clear",
            })}
          </span>
        </Button>
      ) : null}
    </div>
  );
}

export function WorkspaceAppSearchEmpty({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border border-dashed bg-card px-4 py-8 text-center">
      <p className="text-sm font-medium text-foreground">
        {t("dispatch.pages.noAppsMatch", {
          defaultValue: "No apps match your search",
        })}
      </p>
      <p className="mx-auto mt-1 max-w-md truncate text-xs text-muted-foreground">
        “{query}”
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={onClear}
      >
        {t("dispatch.pages.clearAppSearch", { defaultValue: "Clear search" })}
      </Button>
    </div>
  );
}
