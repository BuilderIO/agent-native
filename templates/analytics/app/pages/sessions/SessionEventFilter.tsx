import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconListDetails, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import {
  MAX_SESSION_EVENT_CONDITIONS,
  type SessionEventNameCount,
} from "../../../shared/session-events";

export type SessionEventConditions = {
  didEvents: string[];
  didNotEvents: string[];
};

type Mode = "did" | "didNot";

type EventNamesResult = {
  events: SessionEventNameCount[];
  coverageStartedAt: string | null;
};

export function withEventCondition(
  current: SessionEventConditions,
  eventName: string,
  mode: Mode,
): SessionEventConditions {
  const didEvents = current.didEvents.filter((name) => name !== eventName);
  const didNotEvents = current.didNotEvents.filter(
    (name) => name !== eventName,
  );
  if (mode === "did") didEvents.push(eventName);
  else didNotEvents.push(eventName);
  return { didEvents, didNotEvents };
}

export function withoutEventCondition(
  current: SessionEventConditions,
  eventName: string,
): SessionEventConditions {
  return {
    didEvents: current.didEvents.filter((name) => name !== eventName),
    didNotEvents: current.didNotEvents.filter((name) => name !== eventName),
  };
}

export function SessionEventFilter({
  conditions,
  from,
  to,
  app,
  catalogHref,
  onChange,
}: {
  conditions: SessionEventConditions;
  from?: string;
  to?: string;
  app?: string;
  catalogHref: string;
  onChange: (next: SessionEventConditions) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [newMode, setNewMode] = useState<Mode>("did");
  const [search, setSearch] = useState("");
  const { data, error, isPending } = useActionQuery<EventNamesResult>(
    "list-session-event-names",
    { from, to, app: app || undefined },
    { enabled: open, staleTime: 60_000 },
  );
  const rows: Array<{ eventName: string; mode: Mode }> = [
    ...conditions.didEvents.map((eventName) => ({
      eventName,
      mode: "did" as const,
    })),
    ...conditions.didNotEvents.map((eventName) => ({
      eventName,
      mode: "didNot" as const,
    })),
  ];
  const active = rows.length > 0;
  const full = rows.length >= MAX_SESSION_EVENT_CONDITIONS;
  const chosen = new Set(rows.map((row) => row.eventName));
  const options = (data?.events ?? []).filter(
    (option) => !chosen.has(option.eventName),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "secondary" : "outline"}
          size="sm"
          className={cn(
            "h-8 border border-input font-normal",
            !active && "bg-transparent hover:bg-accent",
          )}
        >
          {active
            ? t("sessions.eventFiltersActive", { count: String(rows.length) })
            : t("sessions.events")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-medium">
            {t("sessions.eventFilters")}
          </span>
          <Button asChild variant="ghost" size="xs">
            <Link to={catalogHref}>
              <IconListDetails />
              {t("sessions.eventCatalog")}
            </Link>
          </Button>
        </div>
        {rows.length ? (
          <ul className="space-y-1.5 border-b px-3 py-2">
            {rows.map((row) => (
              <li
                key={row.eventName}
                className="flex min-w-0 items-center gap-2"
              >
                <ModeToggle
                  value={row.mode}
                  label={row.eventName}
                  onChange={(mode) =>
                    onChange(
                      withEventCondition(conditions, row.eventName, mode),
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {row.eventName}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={t("sessions.removeEventCondition", {
                    event: row.eventName,
                  })}
                  onClick={() =>
                    onChange(withoutEventCondition(conditions, row.eventName))
                  }
                >
                  <IconX className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {full ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("sessions.eventConditionLimit", {
              count: String(MAX_SESSION_EVENT_CONDITIONS),
            })}
          </p>
        ) : (
          <div className="space-y-2 px-3 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {t("sessions.addEventCondition")}
              </span>
              <ModeToggle
                value={newMode}
                label={t("sessions.addEventCondition")}
                onChange={setNewMode}
              />
            </div>
            <div className="overflow-hidden rounded-md border">
              <Command>
                <CommandInput
                  value={search}
                  onValueChange={setSearch}
                  placeholder={t("sessions.searchEvents")}
                />
                <CommandList className="max-h-56">
                  {isPending ? (
                    <div className="space-y-2 p-2">
                      {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} className="h-6 w-full" />
                      ))}
                    </div>
                  ) : error ? (
                    <p className="p-3 text-xs text-destructive" role="alert">
                      {t("sessions.eventNamesFailed", {
                        message: error.message,
                      })}
                    </p>
                  ) : (
                    <>
                      <CommandEmpty>{t("sessions.noEventNames")}</CommandEmpty>
                      <CommandGroup>
                        {options.map((option) => (
                          <CommandItem
                            key={option.eventName}
                            value={option.eventName}
                            onSelect={() => {
                              setSearch("");
                              onChange(
                                withEventCondition(
                                  conditions,
                                  option.eventName,
                                  newMode,
                                ),
                              );
                            }}
                            className="justify-between"
                          >
                            <span className="min-w-0 truncate font-mono text-xs">
                              {option.eventName}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {t(
                                option.sessionCount === 1
                                  ? "sessions.showingSingular"
                                  : "sessions.showing",
                                { count: option.sessionCount.toLocaleString() },
                              )}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </div>
          </div>
        )}
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {data?.coverageStartedAt
            ? t("sessions.eventCoverageSince", {
                date: new Date(data.coverageStartedAt).toLocaleDateString(),
              })
            : t("sessions.eventCoverageStarting")}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function ModeToggle({
  value,
  label,
  onChange,
}: {
  value: Mode;
  label: string;
  onChange: (mode: Mode) => void;
}) {
  const t = useT();
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === "did" || next === "didNot") onChange(next);
      }}
      aria-label={label}
      variant="outline"
      size="sm"
      className="shrink-0"
    >
      <ToggleGroupItem value="did">{t("sessions.eventDid")}</ToggleGroupItem>
      <ToggleGroupItem value="didNot">
        {t("sessions.eventDidNot")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
