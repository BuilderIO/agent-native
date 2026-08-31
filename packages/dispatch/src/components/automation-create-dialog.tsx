import {
  DEFAULT_AUTOMATION_SCHEDULE_DRAFT,
  AUTOMATION_WEEKDAYS,
  automationScheduleToCron,
  formatAutomationTime,
  type AutomationScheduleDraft,
  type AutomationSchedulePreset,
  type AutomationScheduleUnit,
} from "@agent-native/core/client/agent-page/automation-schedule";
import {
  TimezoneSelect,
  browserTimezone,
} from "@agent-native/core/client/agent-page/timezone-select";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  IconBolt,
  IconCalendarEvent,
  IconClock,
  IconCode,
  IconLoader2,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

type TriggerType = "schedule" | "event" | "webhook";

interface AutomationEvent {
  name: string;
  description?: string;
}

interface CreateAutomationInput {
  operation: "create";
  name: string;
  scope: "personal" | "organization";
  triggerType: TriggerType;
  body: string;
  schedule?: string;
  timezone?: string;
  event?: string;
}

interface CreateAutomationResult {
  created: true;
  name: string;
  triggerType: TriggerType;
  webhookPath: string | null;
}

const PRESETS: {
  value: AutomationSchedulePreset;
  label: string;
  detail: string;
  draft: Partial<AutomationScheduleDraft>;
}[] = [
  {
    value: "hourly",
    label: "Every hour",
    detail: "At the top of the hour",
    draft: { preset: "hourly" },
  },
  {
    value: "daily-midnight",
    label: "Every day at midnight",
    detail: "12:00 AM",
    draft: { preset: "daily-midnight" },
  },
  {
    value: "daily-noon",
    label: "Every day at noon",
    detail: "12:00 PM",
    draft: { preset: "daily-noon" },
  },
  {
    value: "weekdays",
    label: "Every weekday",
    detail: "Monday to Friday at 9:00 AM",
    draft: { preset: "weekdays", time: "09:00" },
  },
  {
    value: "weekly",
    label: "Every week",
    detail: "Sunday at 9:00 AM",
    draft: { preset: "weekly", weekday: 0, time: "09:00" },
  },
];

function presetClass(selected: boolean): string {
  return (
    "rounded-lg border px-3 py-2 text-left transition-colors " +
    (selected
      ? "border-primary bg-primary/5 text-foreground"
      : "border-border/70 bg-background hover:bg-muted/50")
  );
}

function scheduleIsValid(value: string): boolean {
  return value.trim().split(/\s+/).length === 5;
}

function ScheduleFields({
  draft,
  saving,
  onChange,
}: {
  draft: AutomationScheduleDraft;
  saving: boolean;
  onChange: (patch: Partial<AutomationScheduleDraft>) => void;
}) {
  const customMinute = Number(draft.time.split(":")[1] ?? 0);
  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <label className="space-y-1.5 text-xs text-muted-foreground">
          <span>Repeat every</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={draft.interval}
            disabled={saving}
            onChange={(event) =>
              onChange({
                interval: Math.max(1, Number(event.target.value) || 1),
              })
            }
            className="h-9 bg-background text-sm"
          />
        </label>
        <label className="space-y-1.5 text-xs text-muted-foreground">
          <span>Unit</span>
          <Select
            value={draft.unit}
            disabled={saving}
            onValueChange={(value) =>
              onChange({ unit: value as AutomationScheduleUnit })
            }
          >
            <SelectTrigger className="h-9 bg-background text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hour">hour(s)</SelectItem>
              <SelectItem value="day">day(s)</SelectItem>
              <SelectItem value="week">week(s)</SelectItem>
              <SelectItem value="month">month(s)</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {draft.unit === "hour" ? (
        <label className="block space-y-1.5 text-xs text-muted-foreground">
          <span>At minute</span>
          <Input
            type="number"
            min={0}
            max={59}
            value={customMinute}
            disabled={saving}
            onChange={(event) =>
              onChange({
                time:
                  "00:" +
                  String(
                    Math.min(59, Math.max(0, Number(event.target.value) || 0)),
                  ).padStart(2, "0"),
              })
            }
            className="h-9 bg-background text-sm"
          />
        </label>
      ) : null}

      {draft.unit === "week" ? (
        <label className="block space-y-1.5 text-xs text-muted-foreground">
          <span>On</span>
          <Select
            value={String(draft.weekday)}
            disabled={saving}
            onValueChange={(value) => onChange({ weekday: Number(value) })}
          >
            <SelectTrigger className="h-9 bg-background text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTOMATION_WEEKDAYS.map((day) => (
                <SelectItem key={day.value} value={String(day.value)}>
                  {day.short}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}

      {draft.unit === "month" ? (
        <label className="block space-y-1.5 text-xs text-muted-foreground">
          <span>Day of month</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={draft.monthDay}
            disabled={saving}
            onChange={(event) =>
              onChange({
                monthDay: Math.min(
                  31,
                  Math.max(1, Number(event.target.value) || 1),
                ),
              })
            }
            className="h-9 bg-background text-sm"
          />
        </label>
      ) : null}

      {draft.unit !== "hour" ? (
        <label className="block space-y-1.5 text-xs text-muted-foreground">
          <span>At</span>
          <Input
            type="time"
            value={draft.time}
            disabled={saving}
            onChange={(event) => onChange({ time: event.target.value })}
            className="h-9 bg-background text-sm"
          />
        </label>
      ) : null}
    </div>
  );
}

function ScheduleBuilder({
  saving,
  timezone,
  onTimezoneChange,
  onChange,
}: {
  saving: boolean;
  timezone: string;
  onTimezoneChange: (value: string) => void;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<AutomationScheduleDraft>(
    DEFAULT_AUTOMATION_SCHEDULE_DRAFT,
  );
  const [advanced, setAdvanced] = useState(false);
  const [advancedValue, setAdvancedValue] = useState("0 * * * *");
  const friendly = automationScheduleToCron(draft);
  const activeSchedule = advanced
    ? advancedValue.trim()
    : (friendly.schedule ?? "");
  const valid =
    scheduleIsValid(activeSchedule) && (!friendly.error || advanced);

  useEffect(() => {
    onChange(valid ? activeSchedule : "");
  }, [activeSchedule, onChange, valid]);

  function choosePreset(
    value: AutomationSchedulePreset,
    presetDraft: Partial<AutomationScheduleDraft>,
  ) {
    setDraft((current) => ({ ...current, ...presetDraft, preset: value }));
    setAdvanced(false);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="text-xs font-medium text-foreground">Repeat</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              aria-pressed={!advanced && draft.preset === preset.value}
              disabled={saving}
              className={presetClass(
                !advanced && draft.preset === preset.value,
              )}
              onClick={() => choosePreset(preset.value, preset.draft)}
            >
              <span className="block text-sm font-medium">{preset.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {preset.detail}
              </span>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={!advanced && draft.preset === "custom"}
            disabled={saving}
            className={presetClass(!advanced && draft.preset === "custom")}
            onClick={() =>
              choosePreset("custom", {
                preset: "custom",
                unit: draft.unit || "day",
              })
            }
          >
            <span className="block text-sm font-medium">Custom</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Set your own repeat pattern
            </span>
          </button>
        </div>
      </div>

      {!advanced && draft.preset === "custom" ? (
        <ScheduleFields
          draft={draft}
          saving={saving}
          onChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
        />
      ) : null}

      {!advanced && friendly.schedule ? (
        <p className="text-xs text-muted-foreground">
          Runs{" "}
          {draft.preset === "hourly"
            ? "at the start of every hour"
            : draft.preset === "daily-midnight"
              ? "every day at midnight"
              : draft.preset === "daily-noon"
                ? "every day at noon"
                : "at " + formatAutomationTime(draft.time)}
          .
        </p>
      ) : null}
      {!advanced && friendly.error ? (
        <p className="text-xs text-destructive">
          Custom weekly intervals beyond one week are available under Advanced.
        </p>
      ) : null}

      <div>
        <label className="text-xs font-medium text-foreground">Timezone</label>
        <div className="mt-1">
          <TimezoneSelect
            value={timezone}
            disabled={saving}
            onChange={onTimezoneChange}
            suggested={[browserTimezone()]}
          />
        </div>
      </div>

      <details
        className="group rounded-lg border border-border/70 bg-muted/20"
        open={advanced}
        onToggle={(event) => {
          const next = event.currentTarget.open;
          if (next && !advanced && friendly.schedule) {
            setAdvancedValue(friendly.schedule);
          }
          setAdvanced(next);
        }}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium text-foreground [&::-webkit-details-marker]:hidden">
          <IconCode className="size-4 text-muted-foreground" />
          Advanced - cron expression
          <span className="ms-auto text-muted-foreground group-open:hidden">
            Show
          </span>
          <span className="ms-auto hidden text-muted-foreground group-open:inline">
            Hide
          </span>
        </summary>
        <div className="border-t border-border/60 px-3 pb-3 pt-2.5">
          <Input
            className="font-mono text-sm"
            value={advancedValue}
            spellCheck={false}
            autoComplete="off"
            disabled={saving}
            onFocus={() => setAdvanced(true)}
            onChange={(event) => {
              setAdvanced(true);
              setAdvancedValue(event.target.value);
            }}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            minute hour day-of-month month day-of-week
          </p>
        </div>
      </details>

      {activeSchedule && !valid ? (
        <p className="text-xs text-destructive">
          A cron expression needs exactly 5 fields.
        </p>
      ) : null}
    </div>
  );
}

function EventFields({
  open,
  event,
  onChange,
}: {
  open: boolean;
  event: string;
  onChange: (value: string) => void;
}) {
  const eventsQuery = useActionQuery<AutomationEvent[]>(
    "list-automation-events",
    {},
    { enabled: open, staleTime: 60_000 },
  );

  return (
    <>
      <label className="space-y-1.5 text-xs text-muted-foreground">
        <span>Start when</span>
        <Select value={event} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue
              placeholder={
                eventsQuery.isLoading
                  ? "Loading event types..."
                  : "Choose an app event"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {(eventsQuery.data ?? []).map((item) => (
              <SelectItem key={item.name} value={item.name}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {eventsQuery.data?.find((item) => item.name === event)?.description ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {eventsQuery.data.find((item) => item.name === event)?.description}
        </p>
      ) : null}
      {eventsQuery.error ? (
        <p className="mt-2 text-xs text-destructive">
          Could not load event types.
        </p>
      ) : null}
    </>
  );
}

export interface AutomationCreateDialogProps {
  open: boolean;
  initialScope?: "personal" | "organization";
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreateAutomationResult) => void;
}

export function AutomationCreateDialog({
  open,
  initialScope = "personal",
  onOpenChange,
  onCreated,
}: AutomationCreateDialogProps) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"personal" | "organization">(initialScope);
  const [triggerType, setTriggerType] = useState<TriggerType>("schedule");
  const [schedule, setSchedule] = useState("0 * * * *");
  const [timezone, setTimezone] = useState(browserTimezone());
  const [event, setEvent] = useState("");
  const [body, setBody] = useState("");
  const create = useActionMutation<
    CreateAutomationResult,
    CreateAutomationInput
  >("manage-automation", {
    onSuccess: onCreated,
  });

  const resetCreate = create.reset;

  useEffect(() => {
    if (!open) return;
    setName("");
    setScope(initialScope);
    setTriggerType("schedule");
    setSchedule("0 * * * *");
    setTimezone(browserTimezone());
    setEvent("");
    setBody("");
    resetCreate();
  }, [initialScope, open, resetCreate]);

  const canSubmit =
    name.trim().length > 0 &&
    body.trim().length > 0 &&
    (triggerType !== "event" || event.length > 0) &&
    (triggerType !== "schedule" || scheduleIsValid(schedule));

  function submit() {
    if (!canSubmit) return;
    create.mutate({
      operation: "create",
      name: name.trim(),
      scope,
      triggerType,
      body: body.trim(),
      ...(triggerType === "schedule"
        ? { schedule, timezone }
        : triggerType === "event"
          ? { event }
          : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New automation</DialogTitle>
          <DialogDescription>
            Choose what starts it, then describe the work in plain language.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <label className="space-y-1.5 text-xs text-muted-foreground">
              <span>Name</span>
              <Input
                value={name}
                disabled={create.isPending}
                placeholder="morning-digest"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="space-y-1.5 text-xs text-muted-foreground">
              <span>Scope</span>
              <Select
                value={scope}
                disabled={create.isPending}
                onValueChange={(value) =>
                  setScope(value as "personal" | "organization")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="organization">Organization</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <Tabs
            value={triggerType}
            onValueChange={(value) => setTriggerType(value as TriggerType)}
          >
            <TabsList className="grid h-auto w-full grid-cols-3">
              <TabsTrigger value="schedule" className="gap-2 py-2 text-xs">
                <IconClock className="size-3.5" /> Schedule
              </TabsTrigger>
              <TabsTrigger value="webhook" className="gap-2 py-2 text-xs">
                <IconBolt className="size-3.5" /> Webhook
              </TabsTrigger>
              <TabsTrigger value="event" className="gap-2 py-2 text-xs">
                <IconCalendarEvent className="size-3.5" /> App event
              </TabsTrigger>
            </TabsList>
            <TabsContent value="schedule" className="mt-3">
              <ScheduleBuilder
                key={open ? "schedule-open" : "schedule-closed"}
                saving={create.isPending}
                timezone={timezone}
                onTimezoneChange={setTimezone}
                onChange={setSchedule}
              />
            </TabsContent>
            <TabsContent value="webhook" className="mt-3">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-start gap-2">
                  <IconBolt className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Run when a service sends an HTTP POST
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      After you save, Dispatch gives you a private URL to paste
                      into GitHub, Stripe, or another webhook provider.
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="event" className="mt-3">
              <EventFields open={open} event={event} onChange={setEvent} />
            </TabsContent>
          </Tabs>

          <label className="space-y-1.5 text-xs text-muted-foreground">
            <span>What should it do?</span>
            <Textarea
              value={body}
              disabled={create.isPending}
              placeholder="Review new support requests and summarize anything urgent in a shared note."
              rows={5}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>

          {create.error ? (
            <p className="text-xs text-destructive">{create.error.message}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={create.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || create.isPending}
            onClick={submit}
          >
            {create.isPending ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : null}
            Create automation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
