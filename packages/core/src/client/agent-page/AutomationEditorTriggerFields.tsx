import { Button } from "@agent-native/toolkit/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@agent-native/toolkit/ui/command";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconMail,
  IconPlayerPlay,
  type Icon,
} from "@tabler/icons-react";

import { useT } from "../i18n.js";
import type { AutomationEvent } from "./use-jobs.js";

export type EditorTrigger = "schedule" | "event" | "manual" | "email";

export type EmailFilters = {
  from: string;
  to: string;
  subject: string;
  additional: string;
};

function TriggerCard({
  value,
  selected,
  disabled,
  icon: TriggerIcon,
  title,
  description,
  onSelect,
}: {
  value: EditorTrigger;
  selected: boolean;
  disabled?: boolean;
  icon: Icon;
  title: string;
  description: string;
  onSelect: (value: EditorTrigger) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      className={`min-h-24 rounded-lg border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted/50"
      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      onClick={() => {
        if (!disabled) onSelect(value);
      }}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <TriggerIcon className="size-4 shrink-0" />
        {title}
      </span>
      <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
        {description}
      </span>
    </button>
  );
}

export function AutomationTriggerCards({
  trigger,
  emailAvailable,
  onChange,
  onOpenConnections,
}: {
  trigger: EditorTrigger;
  emailAvailable: boolean;
  onChange: (trigger: EditorTrigger) => void;
  onOpenConnections: () => void;
}) {
  const t = useT();
  const cards = [
    {
      value: "schedule" as const,
      icon: IconClock,
      title: t("jobs.triggerScheduleTitle", { defaultValue: "Schedule" }),
      description: t("jobs.triggerScheduleDescription", {
        defaultValue: "Run at a recurring time you choose.",
      }),
    },
    {
      value: "event" as const,
      icon: IconBolt,
      title: t("jobs.triggerAppEventTitle", { defaultValue: "App event" }),
      description: t("jobs.triggerAppEventDescription", {
        defaultValue: "Run when a registered event happens.",
      }),
    },
    {
      value: "manual" as const,
      icon: IconPlayerPlay,
      title: t("jobs.triggerManualTitle", { defaultValue: "On demand" }),
      description: t("jobs.triggerManualDescription", {
        defaultValue: "Run only when someone starts it.",
      }),
    },
    {
      value: "email" as const,
      icon: IconMail,
      title: t("jobs.triggerEmailTitle", { defaultValue: "Email received" }),
      description: emailAvailable
        ? t("jobs.triggerEmailDescription", {
            defaultValue: "Run when an incoming email matches your filters.",
          })
        : t("jobs.triggerEmailUnavailableDescription", {
            defaultValue: "Connect Mail to use email-triggered automations.",
          }),
      disabled: !emailAvailable,
    },
  ];

  return (
    <fieldset>
      <legend className="text-sm font-medium">
        {t("jobs.editorTriggerLabel", { defaultValue: "Trigger" })}
      </legend>
      <div
        className="mt-2 grid gap-2 sm:grid-cols-2"
        role="radiogroup"
        aria-label={t("jobs.editorTriggerLabel", { defaultValue: "Trigger" })}
      >
        {cards.map((card) => (
          <TriggerCard
            key={card.value}
            {...card}
            selected={trigger === card.value}
            onSelect={onChange}
          />
        ))}
      </div>
      {!emailAvailable ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>
            {t("jobs.editorEmailSetupHelp", {
              defaultValue:
                "Email received becomes available after a Mail connection registers its event.",
            })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={onOpenConnections}
          >
            {t("jobs.editorOpenConnections", {
              defaultValue: "Open connections",
            })}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

export function AutomationEventFields({
  events,
  loading,
  eventName,
  condition,
  pickerOpen,
  invalid,
  onPickerOpenChange,
  onEventChange,
  onConditionChange,
}: {
  events: AutomationEvent[];
  loading: boolean;
  eventName: string;
  condition: string;
  pickerOpen: boolean;
  invalid: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onEventChange: (event: string) => void;
  onConditionChange: (condition: string) => void;
}) {
  const t = useT();
  const selectedEvent = events.find((event) => event.name === eventName);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium" htmlFor="automation-event">
          {t("jobs.editorEventLabel", { defaultValue: "App event" })}
        </label>
        <Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
          <PopoverTrigger asChild>
            <Button
              id="automation-event"
              type="button"
              role="combobox"
              variant="outline"
              className="mt-1 w-full cursor-pointer justify-between font-normal"
              aria-expanded={pickerOpen}
              aria-invalid={invalid}
            >
              <span className="truncate">
                {selectedEvent?.name ??
                  t("jobs.editorEventPlaceholder", {
                    defaultValue: "Select an event",
                  })}
              </span>
              <IconChevronDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[--radix-popover-trigger-width] p-0"
          >
            <Command>
              <CommandInput
                placeholder={t("jobs.editorEventSearch", {
                  defaultValue: "Search events…",
                })}
              />
              <CommandList>
                <CommandEmpty>
                  {loading
                    ? t("jobs.editorEventsLoading", {
                        defaultValue: "Loading events…",
                      })
                    : t("jobs.editorEventsEmpty", {
                        defaultValue: "No matching events.",
                      })}
                </CommandEmpty>
                <CommandGroup>
                  {events.map((event) => (
                    <CommandItem
                      key={event.name}
                      value={`${event.name} ${event.description}`}
                      onSelect={() => {
                        onEventChange(event.name);
                        onPickerOpenChange(false);
                      }}
                      className="items-start gap-2"
                    >
                      <IconCheck
                        className={`mt-0.5 size-4 shrink-0 ${
                          event.name === eventName ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{event.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {event.description}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {invalid ? (
          <p className="mt-1 text-xs text-destructive">
            {t("jobs.editorEventRequired", {
              defaultValue: "Select an app event.",
            })}
          </p>
        ) : selectedEvent?.description ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedEvent.description}
          </p>
        ) : null}
      </div>
      <div>
        <label
          className="text-sm font-medium"
          htmlFor="automation-event-condition"
        >
          {t("jobs.editorConditionLabel", {
            defaultValue: "Condition (optional)",
          })}
        </label>
        <Input
          id="automation-event-condition"
          className="mt-1"
          value={condition}
          placeholder={t("jobs.editorConditionPlaceholder", {
            defaultValue: "For example, only high-priority items",
          })}
          onChange={(event) => onConditionChange(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}

export function AutomationEmailFields({
  filters,
  onChange,
}: {
  filters: EmailFilters;
  onChange: (filters: EmailFilters) => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["from", "to", "subject"] as const).map((field) => (
        <div key={field}>
          <label
            className="text-sm font-medium"
            htmlFor={`automation-email-${field}`}
          >
            {field === "from"
              ? t("jobs.editorEmailFrom", { defaultValue: "From" })
              : field === "to"
                ? t("jobs.editorEmailTo", { defaultValue: "To" })
                : t("jobs.editorEmailSubject", { defaultValue: "Subject" })}
          </label>
          <Input
            id={`automation-email-${field}`}
            className="mt-1"
            value={filters[field]}
            onChange={(event) =>
              onChange({ ...filters, [field]: event.currentTarget.value })
            }
          />
        </div>
      ))}
      <div className="sm:col-span-2">
        <label
          className="text-sm font-medium"
          htmlFor="automation-email-condition"
        >
          {t("jobs.editorAdditionalCondition", {
            defaultValue: "Additional condition (optional)",
          })}
        </label>
        <Input
          id="automation-email-condition"
          className="mt-1"
          value={filters.additional}
          placeholder={t("jobs.editorAdditionalConditionPlaceholder", {
            defaultValue: "For example, only messages with attachments",
          })}
          onChange={(event) =>
            onChange({ ...filters, additional: event.currentTarget.value })
          }
        />
      </div>
    </div>
  );
}
