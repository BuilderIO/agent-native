import { useT } from "@agent-native/core/client/i18n";
import {
  IconCheck,
  IconClock,
  IconRefresh,
  IconWorld,
} from "@tabler/icons-react";
import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";

import { TimezoneCombobox } from "@/components/TimezoneCombobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatTimezoneLabel,
  type RecurrencePreset,
} from "@/lib/event-form-utils";
import { cn } from "@/lib/utils";

const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

function formatTimeValue(value: string) {
  const [hourValue, minuteValue] = value.split(":").map(Number);
  if (!Number.isFinite(hourValue) || !Number.isFinite(minuteValue)) {
    return value;
  }
  const period = hourValue >= 12 ? "PM" : "AM";
  const hour = hourValue % 12 || 12;
  return minuteValue === 0
    ? `${hour} ${period}`
    : `${hour}:${String(minuteValue).padStart(2, "0")} ${period}`;
}

function formatDateValue(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "EEE MMM d");
}

export function TimePickerPopover({
  value,
  onChange,
  label,
  getOptionMeta,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  getOptionMeta?: (value: string) => string | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const options = useMemo(
    () =>
      TIME_OPTIONS.includes(value) ? TIME_OPTIONS : [value, ...TIME_OPTIONS],
    [value],
  );

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() =>
        selectedRef.current?.scrollIntoView({ block: "center" }),
      );
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-auto rounded px-1.5 py-0.5 text-base font-normal text-foreground hover:bg-muted",
            className,
          )}
          aria-label={label}
        >
          {formatTimeValue(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-52 p-1"
        data-time-picker-popover
      >
        <div className="flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-muted-foreground">
          <IconClock className="size-3.5" />
          {label}
        </div>
        <div className="max-h-64 overflow-y-auto">
          {options.map((option) => {
            const selected = option === value;
            return (
              <button
                key={option}
                ref={selected ? selectedRef : undefined}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  selected && "bg-accent text-accent-foreground",
                )}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                <span>{formatTimeValue(option)}</span>
                {getOptionMeta?.(option) && (
                  <span className="text-muted-foreground">
                    {getOptionMeta(option)}
                  </span>
                )}
                {selected && <IconCheck className="ml-2 size-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DatePickerPopover({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-auto rounded px-1.5 py-0.5 text-base font-normal text-foreground hover:bg-muted",
            className,
          )}
          aria-label={label}
        >
          {formatDateValue(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto p-3"
        data-time-picker-popover
      >
        <Input
          type="date"
          value={value}
          aria-label={label}
          autoFocus
          onChange={(event) => {
            if (!event.target.value) return;
            onChange(event.target.value);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function TimezonePickerPopover({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto justify-start rounded px-1.5 py-0.5 text-sm font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={label}
        >
          <IconWorld className="mr-2 size-4 shrink-0" />
          {formatTimezoneLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(20rem,calc(100vw-2rem))] p-3"
        data-time-picker-popover
      >
        <TimezoneCombobox
          id="inline-event-timezone"
          value={value}
          onChange={(nextValue) => {
            onChange(nextValue);
            setOpen(false);
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {t("eventForm.timezone")}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function RepeatPicker({
  preset,
  referenceDate,
  onChange,
}: {
  preset: RecurrencePreset;
  referenceDate: string;
  onChange: (preset: RecurrencePreset) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const reference = new Date(referenceDate);
  const weekday = Number.isNaN(reference.getTime())
    ? ""
    : format(reference, "EEE");
  const monthDay = Number.isNaN(reference.getTime())
    ? ""
    : format(reference, "do");
  const options: Array<{
    value: RecurrencePreset;
    label: string;
    meta?: string;
    disabled?: boolean;
  }> = [
    { value: "none", label: t("eventForm.doesNotRepeat") },
    { value: "daily", label: t("eventForm.daily") },
    {
      value: "weekdays",
      label: t("eventForm.everyWeekday"),
      meta: t("eventForm.weekdaysShort"),
    },
    {
      value: "weekly",
      label: t("eventForm.weekly"),
      meta: weekday ? t("eventForm.onDay", { day: weekday }) : undefined,
    },
    {
      value: "biweekly",
      label: t("eventForm.everyTwoWeeks"),
      meta: weekday ? t("eventForm.onDay", { day: weekday }) : undefined,
    },
    {
      value: "monthly",
      label: t("eventForm.monthly"),
      meta: monthDay ? t("eventForm.onMonthDay", { day: monthDay }) : undefined,
    },
    {
      value: "yearly",
      label: t("eventForm.yearly"),
      meta: monthDay
        ? t("eventForm.onDate", { date: format(reference, "MMM d") })
        : undefined,
    },
    {
      value: "custom",
      label: t("eventForm.customSchedule"),
      disabled: true,
    },
  ];

  const selectedOption = options.find((option) => option.value === preset);
  const triggerLabel =
    preset === "none" ? t("eventForm.repeat") : selectedOption?.label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto w-full justify-start rounded-md px-1.5 py-1 text-sm font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("eventForm.repeat")}
        >
          <IconRefresh className="mr-2 size-4 shrink-0" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 p-1"
        data-time-picker-popover
      >
        {options.map((option) => {
          const selected = option.value === preset;
          return (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                selected && "bg-accent text-accent-foreground",
                option.disabled &&
                  "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              <span className="ml-3 flex items-center gap-2 text-muted-foreground">
                {option.meta}
                {selected && <IconCheck className="size-3.5 shrink-0" />}
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
