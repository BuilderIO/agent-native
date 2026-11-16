import { useT } from "@agent-native/core/client/i18n";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@agent-native/toolkit/ui/input-group";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useId, useRef } from "react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const label = t("dispatch.pages.searchApps", {
    defaultValue: "Search apps",
  });
  const placeholder = t("dispatch.pages.searchAppsPlaceholder", {
    defaultValue: "Search apps",
  });

  const clearLabel = t("dispatch.pages.clearAppSearch", {
    defaultValue: "Clear search",
  });

  return (
    <div role="search" className={cn("flex items-center", className)}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <InputGroup size="sm" className="min-w-0 flex-1">
        <InputGroupAddon>
          <IconSearch aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          id={inputId}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        {query ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={clearLabel}
              title={clearLabel}
              onClick={() => {
                onQueryChange("");
                // The button unmounts once the query is empty.
                inputRef.current?.focus();
              }}
            >
              <IconX aria-hidden="true" />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
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
