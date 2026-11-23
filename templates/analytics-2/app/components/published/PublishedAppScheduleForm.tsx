import {
  actionErrorCode,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useLocale, useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconChevronRight, IconX } from "@tabler/icons-react";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  getCachedDateTimeFormat,
  getCachedPluralRules,
} from "@/lib/intl-cache";

import {
  isIanaTimeZone,
  nextScheduleFire,
  scheduleCadence,
  type PublishedAppScheduleConfig,
  type ScheduleCadence,
  type ScheduleRecipient,
  type scheduleRecipientsOutput,
  type scheduleView,
} from "../../../shared/published-app-schedules";

const frequencies = ["hourly", "daily", "weekly", "monthly", "custom"] as const;
const triggers = ["success", "failure", "both"] as const;
const weekdays = [1, 2, 3, 4, 5, 6, 7];
const monthDays = Array.from({ length: 31 }, (_, index) => index + 1);
const dateTime: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

type Schedule = z.infer<typeof scheduleView>;
type MembersPage = z.infer<typeof scheduleRecipientsOutput>;
type Recipient = MembersPage["members"][number];
type Draft = ReturnType<typeof makeDraft>;
type InvalidField = "cron" | "hour" | "minute" | "timezone" | "recipient";

export function scheduleErrorKey(error: unknown) {
  switch (actionErrorCode(error)) {
    case "schedule_revision_conflict":
      return "changed";
    case "schedule_forbidden":
    case "source_denied":
      return "forbidden";
    case "invalid_cadence":
      return "invalidCron";
    case "invalid_timezone":
      return "invalidTimezone";
    case "recipient_not_eligible":
      return "invalidRecipient";
    case undefined:
    default:
      return "saveFailed";
  }
}

function makeDraft(now: Date, existing?: Schedule) {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezone =
    existing?.config.timezone ??
    (isIanaTimeZone(localZone) ? localZone : "UTC");
  const localTime = getCachedDateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const localHour = Number(
    localTime.find((part) => part.type === "hour")?.value,
  );
  const cadence = existing?.config.cadence;
  const hour = cadence && "hour" in cadence ? cadence.hour : localHour;
  return {
    kind: cadence?.kind ?? ("weekly" as const),
    hour: String(hour % 12 || 12),
    minute: (cadence && "minute" in cadence
      ? String(cadence.minute)
      : (localTime.find((part) => part.type === "minute")?.value ?? "")
    ).padStart(2, "0"),
    period: hour >= 12 ? "pm" : "am",
    weekday: cadence?.kind === "weekly" ? String(cadence.weekday) : "1",
    day: cadence?.kind === "monthly" ? String(cadence.day) : "1",
    cron: cadence?.kind === "custom" ? cadence.cron : "0 0 * * 1-5",
    timezone,
    updatePublishedResults: existing?.config.updatePublishedResults ?? true,
    useCachedSqlResults: existing?.config.useCachedSqlResults ?? false,
    recipients: existing?.config.recipients ?? [],
  };
}

function parseCadence(draft: Draft) {
  const minute = draft.minute === "" ? NaN : Number(draft.minute);
  const hour12 = Number(draft.hour);
  const hour =
    hour12 >= 1 && hour12 <= 12
      ? (hour12 % 12) + (draft.period === "pm" ? 12 : 0)
      : NaN;
  const fields = {
    hourly: { minute },
    daily: { hour, minute },
    weekly: { hour, minute, weekday: Number(draft.weekday) },
    monthly: { hour, minute, day: Number(draft.day) },
    custom: { cron: draft.cron },
  };
  return scheduleCadence.safeParse({ kind: draft.kind, ...fields[draft.kind] });
}

function Options<V extends string>({
  label,
  value,
  options,
  onChange,
  id,
}: {
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (value: V) => void;
  id?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const item = options.find((option) => option.value === next);
        if (item) onChange(item.value);
      }}
    >
      <SelectTrigger id={id} aria-label={label} className="h-11 min-w-0 sm:h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TimezonePicker({
  now,
  timezone,
  onChange,
  invalid,
  id,
}: {
  now: Date;
  timezone: string;
  onChange: (zone: string) => void;
  invalid: boolean;
  id: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const zones = useMemo(
    () => [
      ...new Set(["UTC", timezone, ...Intl.supportedValuesOf("timeZone")]),
    ],
    [timezone],
  );

  function offset(zone: string) {
    return getCachedDateTimeFormat(locale, {
      timeZone: zone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-label={t("publishedSchedule.timezone")}
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className="h-11 min-w-0 flex-1 justify-between font-normal sm:h-8"
          title={timezone}
        >
          <span className="truncate">{offset(timezone)}</span>
          <IconChevronDown aria-hidden className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)] p-0"
      >
        <Command>
          <CommandInput
            aria-label={t("publishedSchedule.searchTimezonesLabel")}
            placeholder={t("publishedSchedule.searchTimezones")}
          />
          <CommandList>
            <CommandEmpty>{t("publishedSchedule.noTimezones")}</CommandEmpty>
            {zones.map((zone) => (
              <CommandItem
                key={zone}
                value={zone}
                onSelect={() => {
                  onChange(zone);
                  setOpen(false);
                }}
                className="min-h-11 sm:min-h-8"
              >
                {zone}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function RecipientPicker({
  projectId,
  onSelect,
  selected,
  invalid,
  id,
}: {
  projectId: string;
  onSelect: (member: Recipient | null) => void;
  selected: Recipient | null;
  invalid: boolean;
  id: string;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const members = useActionQuery<MembersPage>(
    "list-published-app-schedule-recipients",
    {
      projectId,
      search,
    },
  );

  return (
    <Command shouldFilter={false} className="border">
      <CommandInput
        id={id}
        aria-label={t("publishedSchedule.recipient")}
        aria-expanded={selected === null}
        placeholder={t("publishedSchedule.searchRecipients")}
        value={selected?.name ?? search}
        onValueChange={(next) => {
          if (selected) onSelect(null);
          setSearch(next.slice(0, 128));
        }}
        aria-invalid={invalid || undefined}
      />
      {selected ? null : (
        <CommandList>
          {members.isPending ? (
            <div role="status" className="space-y-2 p-2">
              <span className="sr-only">
                {t("publishedSchedule.loadRecipients")}
              </span>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : members.isError ? (
            <div role="alert" className="p-2 text-sm">
              {t("publishedSchedule.recipientsFailed")}
              <Button
                type="button"
                variant="ghost"
                onClick={() => void members.refetch()}
              >
                {t("publishedSchedule.retry")}
              </Button>
            </div>
          ) : (
            <>
              <CommandEmpty>{t("publishedSchedule.noRecipients")}</CommandEmpty>
              {members.data.members.map((member) => (
                <CommandItem
                  key={member.memberId}
                  value={member.memberId}
                  aria-label={member.name}
                  onSelect={() => onSelect(member)}
                  className="min-h-11 sm:min-h-8"
                >
                  <span className="truncate" title={member.email}>
                    {member.name}
                  </span>
                </CommandItem>
              ))}
            </>
          )}
        </CommandList>
      )}
    </Command>
  );
}

export function PublishedAppScheduleForm({
  projectId,
  schedule,
  notificationsAvailable,
  onClose,
  onSubmit,
}: {
  projectId: string;
  schedule: Schedule | undefined;
  notificationsAvailable: boolean;
  onClose: () => void;
  onSubmit: (config: PublishedAppScheduleConfig) => Promise<void>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { formatDate, formatNumber } = useFormatters();
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [now] = useState(() => new Date());
  const [draft, setDraft] = useState(() => makeDraft(now, schedule));
  const [step, setStep] = useState<"cadence" | "notification">("cadence");
  const [advanced, setAdvanced] = useState(false);
  const [member, setMember] = useState<Recipient | null>(null);
  const [trigger, setTrigger] = useState<ScheduleRecipient["on"]>("both");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<{
    key: string;
    field?: InvalidField;
  } | null>(null);
  const editing = schedule !== undefined;
  const custom = draft.kind === "custom";
  const hourly = draft.kind === "hourly";
  const cadence = useMemo(() => parseCadence(draft), [draft]);
  const nextFire = useMemo(
    () =>
      cadence.success
        ? nextScheduleFire(cadence.data, draft.timezone, now)
        : null,
    [cadence, draft.timezone, now],
  );
  const cronSummary =
    custom && cadence.success ? weekdayCronSummary(cadence.data) : null;

  function weekdayCronSummary(value: ScheduleCadence) {
    if (value.kind !== "custom") return null;
    const parts = /^(\d+)\s+(\d+)\s+\*\s+\*\s+1-5$/.exec(value.cron);
    if (!parts) return null;
    return t("publishedSchedule.cronWeekdays", {
      time: formatDate(
        Date.UTC(2026, 0, 5, Number(parts[2]), Number(parts[1])),
        { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true },
      ),
      zone: draft.timezone,
    });
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function focusField(field: string) {
    form.current
      ?.querySelector<HTMLElement>(`[id="${formId}-${field}"]`)
      ?.focus();
  }

  function fail(key: string, field?: InvalidField) {
    setError({ key, ...(field ? { field } : {}) });
    if (field) focusField(field);
  }

  function showStep(next: typeof step, field: string) {
    setStep(next);
    setError(null);
    requestAnimationFrame(() => focusField(field));
  }

  function config(): PublishedAppScheduleConfig | null {
    if (!isIanaTimeZone(draft.timezone)) {
      fail("invalidTimezone", "timezone");
      return null;
    }
    if (!cadence.success || nextFire === null) {
      const field = !cadence.success && cadence.error.issues[0]?.path[0];
      fail(
        custom ? "invalidCron" : "invalidTime",
        custom ? "cron" : hourly || field === "minute" ? "minute" : "hour",
      );
      return null;
    }
    return {
      cadence: cadence.data,
      timezone: draft.timezone,
      target: "default",
      updatePublishedResults: draft.updatePublishedResults,
      useCachedSqlResults: draft.useCachedSqlResults,
      recipients: draft.recipients,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const settings = config();
    if (settings === null) return;
    if (step === "notification") {
      if (member === null) {
        fail("invalidRecipient", "recipient");
        return;
      }
      settings.recipients = [
        ...settings.recipients.filter(
          ({ memberId }) => memberId !== member.memberId,
        ),
        { memberId: member.memberId, on: trigger },
      ];
      if (settings.recipients.length > 20) {
        fail("invalidRecipient", "recipient");
        return;
      }
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onSubmit(settings);
    } catch (failure) {
      const key = scheduleErrorKey(failure);
      fail(key, key === "invalidRecipient" ? "recipient" : undefined);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const periods = useMemo(() => {
    const formatter = getCachedDateTimeFormat(locale, {
      hour: "numeric",
      hour12: true,
      timeZone: "UTC",
    });
    return ["am", "pm"].map((value) => ({
      value,
      label:
        formatter
          .formatToParts(Date.UTC(2026, 0, 5, value === "am" ? 0 : 12))
          .find((part) => part.type === "dayPeriod")?.value ??
        value.toUpperCase(),
    }));
  }, [locale]);
  const ordinals = getCachedPluralRules(locale, { type: "ordinal" });
  const disabled = pending || !notificationsAvailable;
  const notificationStep = step === "notification";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] gap-0 p-0"
        closeLabel={t("publishedSchedule.close")}
        closeDisabled={pending}
        {...(notificationStep ? { "aria-describedby": undefined } : {})}
      >
        <DialogTitle className="border-b px-5 py-4 pe-11 text-base">
          {t(
            notificationStep
              ? "publishedSchedule.newNotification"
              : editing
                ? "publishedSchedule.edit"
                : "publishedSchedule.newRun",
          )}
        </DialogTitle>
        <form
          ref={form}
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex min-h-0 flex-col"
        >
          <fieldset
            disabled={pending}
            className="grid min-w-0 gap-3 overflow-auto px-5 py-4"
          >
            {notificationStep ? (
              <>
                <Label htmlFor={`${formId}-recipient`}>
                  {t("publishedSchedule.recipient")}
                </Label>
                <RecipientPicker
                  projectId={projectId}
                  id={`${formId}-recipient`}
                  invalid={error?.field === "recipient"}
                  onSelect={(selected) => {
                    setMember(selected);
                    setError(null);
                  }}
                  selected={member}
                />
                <Options
                  label={t("publishedSchedule.trigger")}
                  value={trigger}
                  options={triggers.map((value) => ({
                    value,
                    label: t(`publishedSchedule.when.${value}`),
                  }))}
                  onChange={setTrigger}
                />
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor={`${formId}-frequency`}>
                    {t("publishedSchedule.frequency")}
                  </Label>
                  <DialogDescription className="mt-1">
                    {t("publishedSchedule.frequencyQuestion")}
                  </DialogDescription>
                </div>
                <Options
                  id={`${formId}-frequency`}
                  label={t("publishedSchedule.frequency")}
                  value={draft.kind}
                  options={frequencies.map((value) => ({
                    value,
                    label: t(`publishedSchedule.cadence.${value}`),
                  }))}
                  onChange={(value) => set("kind", value)}
                />
                {draft.kind === "weekly" ? (
                  <Options
                    label={t("publishedSchedule.dayOfWeek")}
                    value={draft.weekday}
                    options={weekdays.map((day) => ({
                      value: String(day),
                      label: formatDate(Date.UTC(2026, 0, 4 + day), {
                        timeZone: "UTC",
                        weekday: "long",
                      }),
                    }))}
                    onChange={(value) => set("weekday", value)}
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  {custom ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Label htmlFor={`${formId}-cron`}>
                        {t("publishedSchedule.cron")}
                      </Label>
                      <Input
                        id={`${formId}-cron`}
                        className="h-11 min-w-0 sm:h-8"
                        aria-label={t("publishedSchedule.cronExpression")}
                        aria-invalid={error?.field === "cron" || undefined}
                        value={draft.cron}
                        maxLength={120}
                        onChange={(event) => set("cron", event.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      {!hourly ? (
                        <>
                          <Input
                            id={`${formId}-hour`}
                            className="h-11 w-14 px-2 text-center sm:h-8"
                            aria-label={t("publishedSchedule.hours")}
                            aria-invalid={error?.field === "hour" || undefined}
                            type="number"
                            min={1}
                            max={12}
                            value={draft.hour}
                            onChange={(event) =>
                              set("hour", event.target.value)
                            }
                          />
                          <span aria-hidden>:</span>
                        </>
                      ) : (
                        <Label htmlFor={`${formId}-minute`}>
                          {t("publishedSchedule.minute")}
                        </Label>
                      )}
                      <Input
                        id={`${formId}-minute`}
                        className="h-11 w-14 px-2 text-center sm:h-8"
                        aria-label={t(
                          hourly
                            ? "publishedSchedule.minute"
                            : "publishedSchedule.minutes",
                        )}
                        aria-invalid={error?.field === "minute" || undefined}
                        type="number"
                        min={0}
                        max={59}
                        value={draft.minute}
                        onChange={(event) => set("minute", event.target.value)}
                      />
                      {!hourly ? (
                        <Options
                          label={t("publishedSchedule.period")}
                          value={draft.period}
                          options={periods}
                          onChange={(value) => set("period", value)}
                        />
                      ) : null}
                    </div>
                  )}
                  <TimezonePicker
                    now={now}
                    timezone={draft.timezone}
                    id={`${formId}-timezone`}
                    invalid={error?.field === "timezone"}
                    onChange={(zone) => set("timezone", zone)}
                  />
                </div>
                {draft.kind === "monthly" ? (
                  <Options
                    label={t("publishedSchedule.dayOfMonth")}
                    value={draft.day}
                    options={monthDays.map((day) => ({
                      value: String(day),
                      label: t(
                        `publishedSchedule.dayOrdinal.${ordinals.select(day)}`,
                        {
                          day: formatNumber(day),
                        },
                      ),
                    }))}
                    onChange={(value) => set("day", value)}
                  />
                ) : null}
                {cronSummary ? (
                  <p className="text-sm text-muted-foreground">{cronSummary}</p>
                ) : null}
                {nextFire ? (
                  <p
                    className="text-xs text-muted-foreground"
                    title={t("publishedSchedule.utc", {
                      time: formatDate(nextFire, {
                        ...dateTime,
                        timeZone: "UTC",
                      }),
                    })}
                  >
                    {t("publishedSchedule.next", {
                      time: formatDate(nextFire, {
                        ...dateTime,
                        timeZone: draft.timezone,
                      }),
                      zone: draft.timezone,
                    })}
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-fit gap-1 px-0 text-muted-foreground sm:h-8"
                  aria-expanded={advanced}
                  aria-controls={`${formId}-advanced`}
                  aria-label={t("publishedSchedule.advancedLabel")}
                  onClick={() => setAdvanced(!advanced)}
                >
                  {advanced ? (
                    <IconChevronDown aria-hidden />
                  ) : (
                    <IconChevronRight aria-hidden />
                  )}
                  {t("publishedSchedule.advanced")}
                </Button>
                {advanced ? (
                  <div id={`${formId}-advanced`} className="grid gap-2">
                    <ScheduleSwitch
                      id={`${formId}-update`}
                      label={t("publishedSchedule.update")}
                      description={t("publishedSchedule.updateDescription")}
                      checked={draft.updatePublishedResults}
                      onChange={(checked) =>
                        set("updatePublishedResults", checked)
                      }
                    />
                    <ScheduleSwitch
                      id={`${formId}-cached`}
                      label={t("publishedSchedule.cached")}
                      description={t("publishedSchedule.cachedDescription")}
                      checked={draft.useCachedSqlResults}
                      onChange={(checked) =>
                        set("useCachedSqlResults", checked)
                      }
                    />
                  </div>
                ) : null}
                {draft.recipients.length ? (
                  <ul
                    aria-label={t("publishedSchedule.notifications")}
                    className="grid gap-1"
                  >
                    {draft.recipients.map((recipient) => (
                      <li
                        key={recipient.memberId}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">{recipient.memberId}</span>
                        <span className="text-muted-foreground">
                          {t(`publishedSchedule.when.${recipient.on}`)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("publishedSchedule.removeRecipient", {
                            recipient: recipient.memberId,
                          })}
                          onClick={() =>
                            set(
                              "recipients",
                              draft.recipients.filter(
                                ({ memberId }) =>
                                  memberId !== recipient.memberId,
                              ),
                            )
                          }
                        >
                          <IconX aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {t(`publishedSchedule.${error.key}`)}
              </p>
            ) : null}
          </fieldset>
          <div className="flex flex-wrap justify-end gap-2 border-t bg-background px-5 py-3">
            {notificationStep ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 sm:h-8"
                disabled={pending}
                onClick={() => showStep("cadence", "frequency")}
              >
                {t("publishedSchedule.back")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-11 sm:h-8"
                disabled={disabled}
                title={
                  notificationsAvailable
                    ? undefined
                    : t("publishedSchedule.notificationsUnavailable")
                }
                onClick={() => {
                  if (config()) showStep("notification", "recipient");
                }}
              >
                {t("publishedSchedule.saveAndNotify")}
              </Button>
            )}
            <Button
              type="submit"
              className="h-11 sm:h-8"
              disabled={pending}
              aria-label={
                notificationStep && !pending
                  ? t("publishedSchedule.saveNotification")
                  : undefined
              }
            >
              {pending ? (
                <span role="status">{t("publishedSchedule.saving")}</span>
              ) : (
                t(
                  notificationStep || editing
                    ? "publishedSchedule.save"
                    : "publishedSchedule.saveRun",
                )
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleSwitch({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Label htmlFor={id} className="flex-1 leading-normal">
        {label}
        <span
          id={`${id}-description`}
          className="block text-xs font-normal text-muted-foreground"
        >
          {description}
        </span>
      </Label>
      <Switch
        id={id}
        aria-label={label}
        aria-describedby={`${id}-description`}
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  );
}
