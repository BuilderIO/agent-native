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
  createCustomRecurrenceDraft,
  parseCustomRecurrence,
  type RecurrencePreset,
  type CustomRecurrenceDraft,
} from "@/lib/event-form-utils";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    ? `${hour}:00 ${period}`
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
                <span className="ml-3 flex min-w-0 items-center gap-2 text-muted-foreground">
                  {getOptionMeta?.(option) && (
                    <span className="truncate">{getOptionMeta(option)}</span>
                  )}
                  <span
                    aria-hidden="true"
                    className="flex size-3.5 shrink-0 items-center justify-center"
                  >
                    {selected && <IconCheck className="size-3.5" />}
                  </span>
                </span>
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
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  compact?: boolean;
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
          className={cn(
            compact
              ? "size-7 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
              : "h-auto justify-start rounded px-1.5 py-0.5 text-sm font-normal text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          aria-label={label}
          title={compact ? label : undefined}
        >
          <IconWorld className={cn("size-4 shrink-0", !compact && "mr-2")} />
          {!compact && formatTimezoneLabel(value)}
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
  recurrence,
  onChange,
  onCustomChange,
}: {
  preset: RecurrencePreset;
  referenceDate: string;
  recurrence?: string[];
  onChange: (preset: RecurrencePreset) => void;
  onCustomChange?: (draft: CustomRecurrenceDraft) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(() =>
    parseCustomRecurrence(recurrence, referenceDate),
  );
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
    { value: "custom", label: t("eventForm.customSchedule") },
  ];

  const selectedOption = options.find((option) => option.value === preset);
  const triggerLabel =
    preset === "none" ? t("eventForm.repeat") : selectedOption?.label;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && preset === "custom") {
          setCustomDraft(parseCustomRecurrence(recurrence, referenceDate));
          setCustomOpen(true);
        }
        if (!nextOpen) setCustomOpen(false);
      }}
    >
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
        className={cn(
          "p-1",
          customOpen ? "w-[min(22rem,calc(100vw-2rem))]" : "w-64",
        )}
        data-time-picker-popover
      >
        {customOpen ? (
          <CustomRecurrenceEditor
            draft={customDraft}
            onChange={setCustomDraft}
            onCancel={() => {
              setCustomOpen(false);
              setOpen(false);
            }}
            onSave={() => {
              onCustomChange?.(customDraft);
              onChange("custom");
              setCustomOpen(false);
              setOpen(false);
            }}
          />
        ) : (
          options.map((option) => {
            const selected = option.value === preset;
            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  selected && "bg-accent text-accent-foreground",
                )}
                onClick={() => {
                  if (option.value === "custom") {
                    setCustomDraft(
                      parseCustomRecurrence(recurrence, referenceDate),
                    );
                    setCustomOpen(true);
                    return;
                  }
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                <span className="ml-3 flex items-center gap-2 text-muted-foreground">
                  {option.meta}
                  <span
                    aria-hidden="true"
                    className="flex size-3.5 shrink-0 items-center justify-center"
                  >
                    {selected && <IconCheck className="size-3.5" />}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}

const CUSTOM_WEEKDAYS = [
  ["SU", "S"],
  ["MO", "M"],
  ["TU", "T"],
  ["WE", "W"],
  ["TH", "T"],
  ["FR", "F"],
  ["SA", "S"],
] as const;

function CustomRecurrenceEditor({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: CustomRecurrenceDraft;
  onChange: (draft: CustomRecurrenceDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useT();
  const update = (changes: Partial<CustomRecurrenceDraft>) =>
    onChange({ ...draft, ...changes });
  const toggleDay = (day: string) => {
    const days = draft.days.includes(day)
      ? draft.days.filter((value) => value !== day)
      : [...draft.days, day];
    update({ days });
  };

  return (
    <div className="max-h-[min(32rem,var(--radix-popover-content-available-height))] overflow-y-auto p-3">
      <div className="mb-3 text-base font-semibold text-foreground">
        {t("eventForm.customRecurrenceTitle")}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t("eventForm.repeatEvery")}
        </span>
        <Input
          type="number"
          min={1}
          max={999}
          value={draft.interval}
          onChange={(event) =>
            update({ interval: Math.max(1, Number(event.target.value) || 1) })
          }
          className="h-9 w-16 text-center"
          aria-label={t("eventForm.repeatEvery")}
        />
        <Select
          value={draft.unit}
          onValueChange={(unit) =>
            update({
              unit: unit as CustomRecurrenceDraft["unit"],
              days: unit === "week" ? draft.days : [],
            })
          }
        >
          <SelectTrigger className="h-9 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">{t("eventForm.day")}</SelectItem>
            <SelectItem value="week">{t("eventForm.week")}</SelectItem>
            <SelectItem value="month">{t("eventForm.month")}</SelectItem>
            <SelectItem value="year">{t("eventForm.year")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {draft.unit === "week" && (
        <div className="mt-4">
          <div className="mb-2 text-sm text-muted-foreground">
            {t("eventForm.repeatOn")}
          </div>
          <div className="flex justify-between gap-1">
            {CUSTOM_WEEKDAYS.map(([value, label]) => {
              const selected = draft.days.includes(value);
              return (
                <Button
                  key={value}
                  type="button"
                  variant={selected ? "default" : "secondary"}
                  size="icon"
                  className="size-8 rounded-full text-xs"
                  aria-pressed={selected}
                  onClick={() => toggleDay(value)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      <fieldset className="mt-5 space-y-2">
        <legend className="mb-2 text-sm text-muted-foreground">
          {t("eventForm.ends")}
        </legend>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="custom-recurrence-end"
            checked={draft.endMode === "never"}
            onChange={() => update({ endMode: "never" })}
          />
          {t("eventForm.never")}
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="custom-recurrence-end"
            checked={draft.endMode === "date"}
            onChange={() => update({ endMode: "date" })}
          />
          <span>{t("eventForm.onDate", { date: "" }).replace(/ $/, "")}</span>
          <Input
            type="date"
            value={draft.endDate}
            onChange={(event) =>
              update({ endMode: "date", endDate: event.target.value })
            }
            className="h-8 min-w-0 flex-1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="custom-recurrence-end"
            checked={draft.endMode === "count"}
            onChange={() => update({ endMode: "count" })}
          />
          <span>{t("eventForm.after")}</span>
          <Input
            type="number"
            min={1}
            max={999}
            value={draft.count}
            onChange={(event) =>
              update({ endMode: "count", count: Math.max(1, Number(event.target.value) || 1) })
            }
            className="h-8 w-20"
          />
          <span className="text-muted-foreground">
            {t("eventForm.occurrences")}
          </span>
        </label>
      </fieldset>

      <div className="mt-5 flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("eventForm.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={draft.unit === "week" && draft.days.length === 0}
          onClick={onSave}
        >
          {t("eventForm.save")}
        </Button>
      </div>
    </div>
  );
}
