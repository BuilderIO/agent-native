/**
 * Create / edit dialog for an uptime monitor. Uses react-hook-form for field
 * state + validation and maps to the save-monitor action payload.
 */
import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { useUptimeT } from "./i18n";
import type {
  AssertionType,
  MonitorMethod,
  MonitorSeverity,
  MonitorSummary,
  SaveMonitorInput,
  StatusMatcher,
} from "./types";
import { isHttpUrl } from "./utils";

const METHODS: MonitorMethod[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

const INTERVAL_OPTIONS = [
  30, 60, 300, 600, 900, 1800, 3600, 21600, 86400,
] as const;

const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const;
const KNOWN_CHANNELS = ["inbox", "email", "slack", "webhook"] as const;
const ASSERTION_TYPES: AssertionType[] = [
  "body_contains",
  "body_absent",
  "header_contains",
  "header_equals",
  "max_latency_ms",
];

interface AssertionFieldValue {
  type: AssertionType;
  value: string;
  header: string;
}

interface MonitorFormValues {
  name: string;
  url: string;
  method: MonitorMethod;
  intervalSeconds: number;
  timeoutSeconds: number;
  matcherMode: "class" | "list" | "range";
  classes: Record<(typeof STATUS_CLASSES)[number], boolean>;
  codes: string;
  rangeMin: number;
  rangeMax: number;
  assertions: AssertionFieldValue[];
  followRedirects: boolean;
  severity: MonitorSeverity;
  channels: Record<(typeof KNOWN_CHANNELS)[number], boolean>;
  emailRecipients: string;
  cooldownMinutes: number;
  enabled: boolean;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultValues(monitor: MonitorSummary | null): MonitorFormValues {
  const matcher = monitor?.expectedStatus ?? {
    mode: "class",
    classes: ["2xx"],
  };
  const classFlags = {
    "2xx": false,
    "3xx": false,
    "4xx": false,
    "5xx": false,
  } as Record<(typeof STATUS_CLASSES)[number], boolean>;
  if (matcher.mode === "class") {
    for (const cls of matcher.classes) {
      if (cls in classFlags) {
        classFlags[cls as (typeof STATUS_CLASSES)[number]] = true;
      }
    }
  } else {
    classFlags["2xx"] = true;
  }

  const channelSet = new Set(monitor?.channels ?? ["inbox"]);

  return {
    name: monitor?.name ?? "",
    url: monitor?.url ?? "",
    method: monitor?.method ?? "GET",
    intervalSeconds: monitor?.intervalSeconds ?? 300,
    timeoutSeconds: Math.round((monitor?.timeoutMs ?? 15000) / 1000),
    matcherMode: matcher.mode,
    classes: classFlags,
    codes: matcher.mode === "list" ? matcher.codes.join(", ") : "200",
    rangeMin: matcher.mode === "range" ? matcher.min : 200,
    rangeMax: matcher.mode === "range" ? matcher.max : 299,
    assertions: (monitor?.assertions ?? []).map((assertion) => ({
      type: assertion.type,
      value: String(assertion.value),
      header: assertion.header ?? "",
    })),
    followRedirects: monitor?.followRedirects ?? true,
    severity: monitor?.severity ?? "critical",
    channels: {
      inbox: channelSet.has("inbox"),
      email: channelSet.has("email"),
      slack: channelSet.has("slack"),
      webhook: channelSet.has("webhook"),
    },
    emailRecipients: (monitor?.emailRecipients ?? []).join(", "),
    cooldownMinutes: monitor?.cooldownMinutes ?? 15,
    enabled: monitor?.enabled ?? true,
  };
}

function buildMatcher(values: MonitorFormValues): StatusMatcher | undefined {
  if (values.matcherMode === "class") {
    const classes = STATUS_CLASSES.filter((cls) => values.classes[cls]);
    if (classes.length === 0) return undefined;
    return { mode: "class", classes };
  }
  if (values.matcherMode === "list") {
    const codes = splitList(values.codes)
      .map((code) => Number.parseInt(code, 10))
      .filter((code) => Number.isFinite(code));
    if (codes.length === 0) return undefined;
    return { mode: "list", codes };
  }
  return {
    mode: "range",
    min: Math.round(values.rangeMin),
    max: Math.round(values.rangeMax),
  };
}

export function MonitorFormDialog({
  open,
  onOpenChange,
  monitor,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor: MonitorSummary | null;
  onSubmit: (input: SaveMonitorInput) => Promise<void>;
  saving: boolean;
}) {
  const t = useUptimeT();
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors },
  } = useForm<MonitorFormValues>({
    defaultValues: defaultValues(monitor),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "assertions",
  });

  useEffect(() => {
    if (open) reset(defaultValues(monitor));
  }, [open, monitor, reset]);

  const matcherMode = watch("matcherMode");

  const submit = handleSubmit(async (values) => {
    const matcher = buildMatcher(values);
    if (!matcher) {
      if (values.matcherMode === "class") {
        setError("classes", { message: t.classRequired });
      } else {
        setError("codes", { message: t.codesRequired });
      }
      return;
    }

    const channels = KNOWN_CHANNELS.filter((c) => values.channels[c]);
    if (channels.length === 0) {
      setError("channels", { message: t.channelRequired });
      return;
    }

    const assertions = values.assertions
      .map((assertion) => {
        if (assertion.type === "max_latency_ms") {
          const num = Number.parseInt(assertion.value, 10);
          if (!Number.isFinite(num) || num <= 0) return null;
          return { type: assertion.type, value: num };
        }
        const value = assertion.value.trim();
        if (!value) return null;
        if (
          assertion.type === "header_contains" ||
          assertion.type === "header_equals"
        ) {
          const header = assertion.header.trim();
          if (!header) return null;
          return { type: assertion.type, value, header };
        }
        return { type: assertion.type, value };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    const payload: SaveMonitorInput = {
      id: monitor?.id,
      name: values.name.trim(),
      url: values.url.trim(),
      method: values.method,
      intervalSeconds: values.intervalSeconds,
      timeoutMs: Math.max(1000, Math.round(values.timeoutSeconds * 1000)),
      expectedStatus: matcher,
      assertions,
      followRedirects: values.followRedirects,
      severity: values.severity,
      channels,
      emailRecipients: splitList(values.emailRecipients),
      cooldownMinutes: values.cooldownMinutes,
      enabled: values.enabled,
    };

    await onSubmit(payload);
  });

  const assertionTypeLabel = (type: AssertionType): string => {
    switch (type) {
      case "body_contains":
        return t.typeBodyContains;
      case "body_absent":
        return t.typeBodyAbsent;
      case "header_contains":
        return t.typeHeaderContains;
      case "header_equals":
        return t.typeHeaderEquals;
      case "max_latency_ms":
        return t.typeMaxLatency;
      default:
        return type;
    }
  };

  const classLabel = (cls: (typeof STATUS_CLASSES)[number]): string => {
    switch (cls) {
      case "2xx":
        return t.classLabel2xx;
      case "3xx":
        return t.classLabel3xx;
      case "4xx":
        return t.classLabel4xx;
      case "5xx":
        return t.classLabel5xx;
    }
  };

  const channelLabel = (channel: (typeof KNOWN_CHANNELS)[number]): string => {
    switch (channel) {
      case "inbox":
        return t.channelInbox;
      case "email":
        return t.channelEmail;
      case "slack":
        return t.channelSlack;
      case "webhook":
        return t.channelWebhook;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {monitor ? t.dialogEditTitle : t.dialogCreateTitle}
          </DialogTitle>
          <DialogDescription>{t.dialogDescription}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="monitor-name">{t.fieldName}</Label>
              <Input
                id="monitor-name"
                placeholder={t.fieldNamePlaceholder}
                {...register("name", {
                  validate: (value) =>
                    value.trim().length > 0 || t.nameRequired,
                })}
              />
              {errors.name ? (
                <p className="text-xs text-destructive">
                  {errors.name.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="monitor-url">{t.fieldUrl}</Label>
              <Input
                id="monitor-url"
                placeholder={t.fieldUrlPlaceholder}
                {...register("url", {
                  validate: (value) => {
                    if (!value.trim()) return t.urlRequired;
                    return isHttpUrl(value.trim()) || t.urlInvalid;
                  },
                })}
              />
              {errors.url ? (
                <p className="text-xs text-destructive">{errors.url.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="monitor-method">{t.fieldMethod}</Label>
              <Controller
                control={control}
                name="method"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) =>
                      field.onChange(value as MonitorMethod)
                    }
                  >
                    <SelectTrigger id="monitor-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {method}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="monitor-interval">{t.fieldInterval}</Label>
              <Controller
                control={control}
                name="intervalSeconds"
                render={({ field }) => (
                  <Select
                    value={String(field.value)}
                    onValueChange={(value) =>
                      field.onChange(Number.parseInt(value, 10))
                    }
                  >
                    <SelectTrigger id="monitor-interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVAL_OPTIONS.map((seconds) => (
                        <SelectItem key={seconds} value={String(seconds)}>
                          {t.intervals[String(seconds)] ?? `${seconds}s`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="monitor-timeout">{t.fieldTimeout}</Label>
              <Input
                id="monitor-timeout"
                type="number"
                min={1}
                max={120}
                {...register("timeoutSeconds", { valueAsNumber: true })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="monitor-cooldown">{t.fieldCooldown}</Label>
              <Input
                id="monitor-cooldown"
                type="number"
                min={0}
                max={1440}
                {...register("cooldownMinutes", { valueAsNumber: true })}
              />
            </div>
          </div>

          {/* Expected status */}
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label>{t.fieldExpectedStatus}</Label>
              <Controller
                control={control}
                name="matcherMode"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) =>
                      field.onChange(value as MonitorFormValues["matcherMode"])
                    }
                  >
                    <SelectTrigger className="sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="class">
                        {t.matcherModeClass}
                      </SelectItem>
                      <SelectItem value="list">{t.matcherModeList}</SelectItem>
                      <SelectItem value="range">
                        {t.matcherModeRange}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {matcherMode === "class" ? (
              <Controller
                control={control}
                name="classes"
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {STATUS_CLASSES.map((cls) => (
                      <label
                        key={cls}
                        className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
                      >
                        <Checkbox
                          checked={field.value[cls]}
                          onCheckedChange={(checked) =>
                            field.onChange({
                              ...field.value,
                              [cls]: checked === true,
                            })
                          }
                        />
                        {classLabel(cls)}
                      </label>
                    ))}
                  </div>
                )}
              />
            ) : matcherMode === "list" ? (
              <div className="space-y-1.5">
                <Label htmlFor="monitor-codes" className="text-xs">
                  {t.fieldCodes}
                </Label>
                <Input
                  id="monitor-codes"
                  placeholder={t.fieldCodesPlaceholder}
                  {...register("codes")}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="monitor-range-min" className="text-xs">
                    {t.fieldRangeMin}
                  </Label>
                  <Input
                    id="monitor-range-min"
                    type="number"
                    {...register("rangeMin", { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="monitor-range-max" className="text-xs">
                    {t.fieldRangeMax}
                  </Label>
                  <Input
                    id="monitor-range-max"
                    type="number"
                    {...register("rangeMax", { valueAsNumber: true })}
                  />
                </div>
              </div>
            )}
            {errors.classes ? (
              <p className="text-xs text-destructive">
                {errors.classes.message}
              </p>
            ) : null}
            {errors.codes ? (
              <p className="text-xs text-destructive">{errors.codes.message}</p>
            ) : null}
          </div>

          {/* Assertions */}
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between">
              <Label>{t.fieldAssertions}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({ type: "body_contains", value: "", header: "" })
                }
              >
                <IconPlus className="size-3.5" />
                {t.addAssertion}
              </Button>
            </div>
            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t.assertionsHint}
              </p>
            ) : (
              <div className="space-y-2">
                {fields.map((fieldItem, index) => {
                  const type = watch(`assertions.${index}.type`);
                  const needsHeader =
                    type === "header_contains" || type === "header_equals";
                  return (
                    <div
                      key={fieldItem.id}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,150px)_minmax(0,120px)_1fr_auto]"
                    >
                      <Controller
                        control={control}
                        name={`assertions.${index}.type`}
                        render={({ field }) => (
                          <Select
                            value={field.value}
                            onValueChange={(value) =>
                              field.onChange(value as AssertionType)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ASSERTION_TYPES.map((assertionType) => (
                                <SelectItem
                                  key={assertionType}
                                  value={assertionType}
                                >
                                  {assertionTypeLabel(assertionType)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      {needsHeader ? (
                        <Input
                          placeholder={t.assertionHeader}
                          {...register(`assertions.${index}.header`)}
                        />
                      ) : (
                        <div className="hidden sm:block" />
                      )}
                      <Input
                        placeholder={t.assertionValue}
                        inputMode={
                          type === "max_latency_ms" ? "numeric" : undefined
                        }
                        {...register(`assertions.${index}.value`)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => remove(index)}
                        aria-label={t.removeAssertion}
                      >
                        <IconTrash className="size-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Alerting */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="monitor-severity">{t.fieldSeverity}</Label>
              <Controller
                control={control}
                name="severity"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) =>
                      field.onChange(value as MonitorSeverity)
                    }
                  >
                    <SelectTrigger id="monitor-severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warning">
                        {t.severityWarning}
                      </SelectItem>
                      <SelectItem value="critical">
                        {t.severityCritical}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t.fieldChannels}</Label>
              <Controller
                control={control}
                name="channels"
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-2">
                    {KNOWN_CHANNELS.map((channel) => (
                      <label
                        key={channel}
                        className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                      >
                        <Checkbox
                          checked={field.value[channel]}
                          onCheckedChange={(checked) =>
                            field.onChange({
                              ...field.value,
                              [channel]: checked === true,
                            })
                          }
                        />
                        {channelLabel(channel)}
                      </label>
                    ))}
                  </div>
                )}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="monitor-emails">{t.fieldEmailRecipients}</Label>
              <Textarea
                id="monitor-emails"
                className="min-h-[64px]"
                placeholder={t.fieldEmailRecipientsPlaceholder}
                {...register("emailRecipients")}
              />
              {errors.channels ? (
                <p className="text-xs text-destructive">
                  {errors.channels.message}
                </p>
              ) : null}
            </div>
          </div>

          {/* Toggles */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Controller
              control={control}
              name="followRedirects"
              render={({ field }) => (
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <Label>{t.fieldFollowRedirects}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t.fieldFollowRedirectsHint}
                    </p>
                  </div>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
            <Controller
              control={control}
              name="enabled"
              render={({ field }) => (
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <Label>{t.fieldEnabled}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t.fieldEnabledHint}
                    </p>
                  </div>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : null}
              {monitor ? t.save : t.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
