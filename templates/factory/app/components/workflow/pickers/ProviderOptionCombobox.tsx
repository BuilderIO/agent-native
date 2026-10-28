import { IconCheck, IconChevronLeft, IconSelector } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { TextInput } from "@/components/workflow-canvas/inspector/fields";
import { useInvalidMark } from "@/components/workflow-canvas/inspector/issue-marks";
import type { MapTargetProps } from "@/components/workflow-canvas/inspector/map-target";
import { providerName } from "@/components/workflow-canvas/node-kinds";
import { cn } from "@/lib/utils";

import type { ProviderOption } from "../../../../server/workflow-host/option-listers/types.js";
import type { PickerKind } from "./picker-kinds";
import { usePickerScope } from "./picker-scope";
import { usePickerStrings } from "./picker-strings";
import {
  useProviderOptions,
  type ListFailure,
  type ProviderOptionsState,
} from "./use-provider-options";

/** A typed query is sent to the provider after this long without a keystroke. */
const SEARCH_DEBOUNCE_MS = 250;

/** A value that follows its source once the source has been still for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/** What the list shows while typed text is still settling: the last search does not answer it. */
const SETTLING: ProviderOptionsState = {
  options: undefined,
  loading: true,
  failure: null,
  retry: () => {},
  hasMore: false,
  loadMore: () => {},
  loadingMore: false,
};

function matches(option: ProviderOption, query: string): boolean {
  const needle = query.toLowerCase();
  return [option.label, option.value, option.hint].some((text) =>
    text?.toLowerCase().includes(needle),
  );
}

/** The organization half of a stored `organization/project`, when it has one. */
function parentOf(kind: PickerKind, value: string): string | undefined {
  if (!kind.parentResource) return undefined;
  const [parent, project, ...rest] = value.split("/");
  return parent && project && rest.length === 0 ? parent : undefined;
}

function FailureNotice({
  provider,
  failure,
  onRetry,
}: {
  provider: string;
  failure: ListFailure;
  onRetry: () => void;
}) {
  const s = usePickerStrings();
  const name = providerName(provider);
  let text: string;
  switch (failure.code) {
    case "credential_missing":
      text =
        failure.reason === "refused"
          ? s.error.refused(name)
          : failure.reason === "missing_scope"
            ? failure.scope
              ? s.error.missingScope(name, failure.scope)
              : s.error.refused(name)
            : s.error.notConnected(name);
      break;
    case "rate_limited":
      text = s.error.rateLimited(name);
      break;
    case "provider_unreadable":
      text = s.error.unreadable(name);
      break;
  }
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 border-b border-border p-3 text-xs text-destructive"
    >
      <p>{text}</p>
      <Button type="button" variant="outline" size="xs" onClick={onRetry}>
        {s.retry}
      </Button>
    </div>
  );
}

function OptionRows({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-1 p-1" aria-hidden>
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} className="h-8 w-full" />
      ))}
    </div>
  );
}

function Combobox({
  id,
  factoryId,
  kind,
  value,
  onChange,
  invalid,
  mapTarget,
}: {
  id?: string | undefined;
  factoryId: string;
  kind: PickerKind;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean | undefined;
  mapTarget?: MapTargetProps | undefined;
}) {
  const s = usePickerStrings();
  const mark = useInvalidMark(invalid);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | undefined>();

  // Closed, the trigger names what is stored, so it reads the list the value belongs to.
  const parent = open ? picked : parentOf(kind, value);
  const choosingParent = kind.parentResource !== undefined && !parent;
  const resource =
    choosingParent && kind.parentResource ? kind.parentResource : kind.resource;
  const listParent = choosingParent ? undefined : parent;
  const base = useProviderOptions({
    factoryId,
    kind,
    resource,
    parent: listParent,
    enabled: open,
  });

  // A list with more pages cannot be filtered here, so the provider is asked.
  const typed = query.trim();
  const searching = typed !== "" && base.hasMore;
  const search = useDebounced(typed, SEARCH_DEBOUNCE_MS);
  const settling = searching && search !== typed;
  const found = useProviderOptions({
    factoryId,
    kind,
    resource,
    parent: listParent,
    search,
    enabled: open && searching && !settling,
  });
  const listed = settling ? SETTLING : searching ? found : base;

  const shown = searching
    ? (listed.options ?? [])
    : (base.options ?? []).filter((option) => !typed || matches(option, typed));
  // Until the search answers, Enter would commit the half-typed text instead of the match.
  const offersTyped =
    typed !== "" &&
    !(searching && listed.loading) &&
    !shown.some((o) => o.value === typed);
  const empty =
    !listed.loading && !listed.failure && shown.length === 0 && !offersTyped;
  const storedLabel = choosingParent
    ? undefined
    : base.options?.find((option) => option.value === value)?.label;

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setPicked(parentOf(kind, value));
        }
      }}
    >
      <div
        className={cn("rounded-md", mapTarget?.className)}
        data-map-target={mapTarget?.["data-map-target"]}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-invalid={mark}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value ? (storedLabel ?? value) : s.choose[kind.resource]}
            </span>
            <IconSelector aria-hidden className="opacity-50" />
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
      >
        <Command shouldFilter={false}>
          {kind.parentResource && parent ? (
            <div className="flex items-center border-b border-border p-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={s.changeOrganization}
                onClick={() => {
                  setPicked(undefined);
                  setQuery("");
                }}
              >
                <IconChevronLeft aria-hidden className="rtl:rotate-180" />
                <span className="truncate">{parent}</span>
              </Button>
            </div>
          ) : null}
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={s.search}
          />
          {listed.failure ? (
            <FailureNotice
              provider={kind.provider}
              failure={listed.failure}
              onRetry={listed.retry}
            />
          ) : null}
          <CommandList className="max-h-64" aria-busy={listed.loading}>
            {listed.loading ? <OptionRows rows={3} /> : null}
            {empty ? <CommandEmpty>{s.noMatches}</CommandEmpty> : null}
            <CommandGroup
              heading={choosingParent ? s.choose.organizations : undefined}
            >
              {shown.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    if (choosingParent) {
                      setPicked(option.value);
                      setQuery("");
                    } else {
                      choose(option.value);
                    }
                  }}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate">{option.label}</span>
                    {option.tags?.length ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {option.tags.map((tag) => s.tag[tag]).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  {option.hint ? (
                    <span className="ms-auto min-w-0 max-w-2/5 truncate font-mono text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                  <IconCheck
                    aria-hidden
                    className={cn(
                      option.hint ? "" : "ms-auto",
                      option.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
              {offersTyped ? (
                <CommandItem
                  value={`typed:${typed}`}
                  onSelect={() => choose(typed)}
                >
                  <span className="truncate">{s.useTyped(typed)}</span>
                </CommandItem>
              ) : null}
              {listed.hasMore ? (
                <CommandItem
                  value="load-more"
                  disabled={listed.loadingMore}
                  onSelect={listed.loadMore}
                  className="justify-center"
                >
                  <span className="text-muted-foreground">{s.loadMore}</span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A field that holds one of a provider's resources: a dropdown of what the
 * connection really has, with a search that also takes a typed value. It
 * writes the same text the plain box did, and the list never gates saving.
 * Outside a factory there is no connection to list from, so it is that box.
 */
export function ProviderOptionCombobox({
  id,
  kind,
  value,
  onChange,
  example,
  invalid,
  mapTarget,
}: {
  id?: string;
  kind: PickerKind;
  value: string;
  onChange: (value: string) => void;
  /** What the plain box shows while empty; the dropdown asks to choose instead. */
  example?: string;
  invalid?: boolean;
  mapTarget?: MapTargetProps;
}) {
  const scope = usePickerScope();
  if (!scope) {
    return (
      <TextInput
        id={id}
        value={value}
        placeholder={example}
        invalid={invalid}
        onChange={onChange}
        {...mapTarget}
      />
    );
  }
  return (
    <Combobox
      id={id}
      factoryId={scope.factoryId}
      kind={kind}
      value={value}
      onChange={onChange}
      invalid={invalid}
      mapTarget={mapTarget}
    />
  );
}
