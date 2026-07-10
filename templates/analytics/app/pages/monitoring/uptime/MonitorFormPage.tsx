/**
 * Full-page create / edit form for an uptime monitor. Renders inside the
 * Monitoring → Uptime panel (not a modal), driven by query params so it is
 * deep-linkable and back-button friendly.
 *
 * Progressive disclosure: only Name, URL, and Check interval are always
 * visible. Response checks, Alerting, and Advanced live in collapsed sections
 * with smart defaults, so a working monitor needs just a name + URL.
 */
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconBell,
  IconChevronDown,
  IconLoader2,
  IconPlus,
  IconSettings,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { fmt, useUptimeT } from "./i18n";
import type {
  AssertionType,
  MonitorDetail,
  MonitorMethod,
  MonitorSeverity,
  MonitorSummary,
  SaveMonitorInput,
  StatusMatcher,
} from "./types";
import { deriveMonitorName, describeMatcher, isHttpUrl } from "./utils";

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
const DEFAULT_TIMEOUT_SECONDS = 10;
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
  slackWebhookUrl: string;
  webhookUrl: string;
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
    timeoutSeconds: Math.round(
      (monitor?.timeoutMs ?? DEFAULT_TIMEOUT_SECONDS * 1000) / 1000,
    ),
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
    slackWebhookUrl: monitor?.slackWebhookUrl ?? "",
    webhookUrl: monitor?.webhookUrl ?? "",
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

interface SectionState {
  response: boolean;
  alerting: boolean;
  advanced: boolean;
}

/** Open a section by default when the monitor already customized it. */
function initialSections(monitor: MonitorSummary | null): SectionState {
  if (!monitor) return { response: false, alerting: false, advanced: false };
  const matcher = monitor.expectedStatus;
  const isDefaultMatcher =
    matcher.mode === "class" &&
    matcher.classes.length === 1 &&
    matcher.classes[0] === "2xx";
  const isDefaultChannels =
    monitor.channels.length === 1 && monitor.channels[0] === "inbox";
  return {
    response: monitor.assertions.length > 0 || !isDefaultMatcher,
    alerting:
      !isDefaultChannels ||
      monitor.emailRecipients.length > 0 ||
      Boolean(monitor.slackWebhookUrl) ||
      Boolean(monitor.webhookUrl) ||
      monitor.severity !== "critical",
    advanced:
      monitor.method !== "GET" ||
      monitor.timeoutMs !== DEFAULT_TIMEOUT_SECONDS * 1000 ||
      monitor.cooldownMinutes !== 15 ||
      !monitor.followRedirects ||
      !monitor.enabled,
  };
}

export function MonitorFormPage({
  monitorId,
  initialMonitor,
  onCancel,
  onSaved,
}: {
  monitorId: string | null;
  initialMonitor?: MonitorSummary | null;
  onCancel: () => void;
  onSaved: (monitor: MonitorSummary) => void;
}) {
  const t = useUptimeT();
  const isEdit = monitorId != null;

  const { data: detail, isLoading } = useActionQuery<MonitorDetail>(
    "get-monitor",
    { id: monitorId ?? "" },
    { enabled: isEdit && !initialMonitor, staleTime: 5_000 },
  );

  const resolved: MonitorSummary | null = isEdit
    ? (initialMonitor ?? detail?.monitor ?? null)
    : null;

  const saveMonitor = useActionMutation<MonitorSummary, SaveMonitorInput>(
    "save-monitor",
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<MonitorFormValues>({
    defaultValues: defaultValues(initialMonitor ?? null),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "assertions",
  });

  const [sections, setSections] = useState<SectionState>(() =>
    initialSections(initialMonitor ?? null),
  );

  // Name auto-fills from the URL until the user edits it. In edit mode an
  // existing name counts as "touched" so we never clobber it.
  const nameTouchedRef = useRef<boolean>(Boolean(initialMonitor?.name?.trim()));

  // Prefill exactly once per resolved monitor id so a late get-monitor refetch
  // never clobbers in-progress edits.
  const initedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isEdit) {
      if (initedRef.current !== "new") {
        reset(defaultValues(null));
        setSections(initialSections(null));
        nameTouchedRef.current = false;
        initedRef.current = "new";
      }
      return;
    }
    if (resolved && initedRef.current !== resolved.id) {
      reset(defaultValues(resolved));
      setSections(initialSections(resolved));
      nameTouchedRef.current = Boolean(resolved.name?.trim());
      initedRef.current = resolved.id;
    }
  }, [isEdit, resolved, reset]);

  const values = watch();

  const responseSummary = useMemo(() => {
    const matcher = buildMatcher(values);
    const matcherText = matcher ? describeMatcher(matcher, t) : t.classRequired;
    const count = values.assertions.length;
    const assertionsText =
      count === 0
        ? t.noAssertionsSummary
        : count === 1
          ? t.oneAssertionSummary
          : fmt(t.assertionsCountSummary, { count });
    return `${matcherText} · ${assertionsText}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    values.matcherMode,
    values.classes,
    values.codes,
    values.rangeMin,
    values.rangeMax,
    values.assertions.length,
    t,
  ]);

  const alertingSummary = useMemo(() => {
    const selected = KNOWN_CHANNELS.filter((c) => values.channels[c]).map((c) =>
      channelLabel(c, t),
    );
    const channelsText =
      selected.length > 0 ? selected.join(", ") : t.channelsNoneSummary;
    const severityText =
      values.severity === "critical" ? t.severityCritical : t.severityWarning;
    return `${channelsText} · ${severityText}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.channels, values.severity, t]);

  const advancedSummary = useMemo(() => {
    const parts = [
      values.method,
      `${values.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS}s`,
      `${values.cooldownMinutes ?? 15}m`,
    ];
    if (!values.enabled) parts.push(t.pausedBadge);
    return parts.join(" · ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    values.method,
    values.timeoutSeconds,
    values.cooldownMinutes,
    values.enabled,
    t,
  ]);

  const submit = handleSubmit(async (formValues) => {
    const matcher = buildMatcher(formValues);
    if (!matcher) {
      setSections((prev) => ({ ...prev, response: true }));
      if (formValues.matcherMode === "class") {
        setError("classes", { message: t.classRequired });
      } else {
        setError("codes", { message: t.codesRequired });
      }
      return;
    }

    const channels = KNOWN_CHANNELS.filter((c) => formValues.channels[c]);
    if (channels.length === 0) {
      setSections((prev) => ({ ...prev, alerting: true }));
      setError("channels", { message: t.channelRequired });
      return;
    }
    if (
      formValues.channels.email &&
      !splitList(formValues.emailRecipients).length
    ) {
      setSections((prev) => ({ ...prev, alerting: true }));
      setError("emailRecipients", { message: t.emailRecipientsRequired });
      return;
    }
    if (formValues.channels.slack) {
      const slackUrl = formValues.slackWebhookUrl.trim();
      if (slackUrl && !isHttpUrl(slackUrl)) {
        setSections((prev) => ({ ...prev, alerting: true }));
        setError("slackWebhookUrl", { message: t.slackWebhookUrlInvalid });
        return;
      }
    }
    if (formValues.channels.webhook) {
      const hookUrl = formValues.webhookUrl.trim();
      if (hookUrl && !isHttpUrl(hookUrl)) {
        setSections((prev) => ({ ...prev, alerting: true }));
        setError("webhookUrl", { message: t.webhookUrlInvalid });
        return;
      }
    }

    const assertions = formValues.assertions
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

    const url = formValues.url.trim();
    const payload: SaveMonitorInput = {
      id: monitorId ?? undefined,
      name: formValues.name.trim() || deriveMonitorName(url),
      url,
      method: formValues.method,
      requestHeaders: resolved?.requestHeaders,
      requestBody: resolved?.requestBody,
      intervalSeconds: formValues.intervalSeconds,
      timeoutMs: Math.max(1000, Math.round(formValues.timeoutSeconds * 1000)),
      expectedStatus: matcher,
      assertions,
      followRedirects: formValues.followRedirects,
      severity: formValues.severity,
      channels,
      emailRecipients: formValues.channels.email
        ? splitList(formValues.emailRecipients)
        : [],
      slackWebhookUrl: formValues.channels.slack
        ? formValues.slackWebhookUrl.trim()
        : null,
      webhookUrl: formValues.channels.webhook
        ? formValues.webhookUrl.trim()
        : null,
      cooldownMinutes: formValues.cooldownMinutes,
      enabled: formValues.enabled,
    };

    try {
      const saved = await saveMonitor.mutateAsync(payload);
      toast.success(t.saved);
      onSaved(saved);
    } catch (err) {
      toast.error(
        fmt(t.saveFailed, {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  // Edit deep-link before the monitor resolves.
  if (isEdit && !resolved && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const matcherMode = values.matcherMode;
  const saving = saveMonitor.isPending;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2 mb-2 text-muted-foreground"
          onClick={onCancel}
        >
          <IconArrowLeft className="size-3.5" />
          {t.back}
        </Button>
        <h2 className="text-lg font-semibold">
          {isEdit ? t.formEditTitle : t.formCreateTitle}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {isEdit ? t.formEditSubtitle : t.formCreateSubtitle}
        </p>
      </div>

      <form id="monitor-form" onSubmit={submit} className="space-y-5">
        {/* Essentials — always visible */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="monitor-url">{t.fieldUrl}</Label>
            <Input
              id="monitor-url"
              placeholder={t.fieldUrlPlaceholder}
              inputMode="url"
              autoFocus
              {...register("url", {
                validate: (value) => {
                  if (!value.trim()) return t.urlRequired;
                  return isHttpUrl(value.trim()) || t.urlInvalid;
                },
                onChange: (event) => {
                  // Auto-fill the name from the URL until the user edits it.
                  if (!nameTouchedRef.current) {
                    setValue("name", deriveMonitorName(event.target.value), {
                      shouldDirty: false,
                    });
                  }
                },
              })}
            />
            {errors.url ? (
              <p className="text-xs text-destructive">{errors.url.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="monitor-name">{t.fieldName}</Label>
            <Input
              id="monitor-name"
              placeholder={t.fieldNamePlaceholder}
              {...register("name", {
                onChange: () => {
                  nameTouchedRef.current = true;
                },
              })}
            />
            <p className="text-xs text-muted-foreground">{t.fieldNameHint}</p>
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
        </div>

        {/* Response checks */}
        <Section
          icon={<IconShieldCheck className="size-4 text-muted-foreground" />}
          title={t.sectionResponseChecks}
          hint={t.sectionResponseChecksHint}
          summary={responseSummary}
          open={sections.response}
          onOpenChange={(open) =>
            setSections((prev) => ({ ...prev, response: open }))
          }
        >
          <div className="space-y-2">
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
                        {classLabel(cls, t)}
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

          <div className="space-y-2 border-t border-border/60 pt-4">
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
                                  {assertionTypeLabel(assertionType, t)}
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
        </Section>

        {/* Alerting */}
        <Section
          icon={<IconBell className="size-4 text-muted-foreground" />}
          title={t.sectionAlerting}
          hint={t.sectionAlertingHint}
          summary={alertingSummary}
          open={sections.alerting}
          onOpenChange={(open) =>
            setSections((prev) => ({ ...prev, alerting: open }))
          }
        >
          <div className="space-y-4">
            <div className="space-y-1.5 sm:max-w-xs">
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

            <div className="space-y-2">
              <Label>{t.fieldChannels}</Label>
              <Controller
                control={control}
                name="channels"
                render={({ field }) => (
                  <div className="space-y-2">
                    {KNOWN_CHANNELS.map((channel) => {
                      const checked = field.value[channel];
                      return (
                        <div
                          key={channel}
                          className="rounded-md border border-border/60"
                        >
                          <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5">
                            <Checkbox
                              className="mt-0.5"
                              checked={checked}
                              onCheckedChange={(next) =>
                                field.onChange({
                                  ...field.value,
                                  [channel]: next === true,
                                })
                              }
                            />
                            <span className="min-w-0">
                              <span className="block text-sm">
                                {channelLabel(channel, t)}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {channelHint(channel, t)}
                              </span>
                            </span>
                          </label>
                          {channel === "email" && checked ? (
                            <div className="space-y-1.5 border-t border-border/60 px-3 py-2.5">
                              <Label htmlFor="monitor-emails">
                                {t.fieldEmailRecipients}
                              </Label>
                              <Textarea
                                id="monitor-emails"
                                className="min-h-[64px]"
                                placeholder={t.fieldEmailRecipientsPlaceholder}
                                {...register("emailRecipients")}
                              />
                              {errors.emailRecipients ? (
                                <p className="text-xs text-destructive">
                                  {errors.emailRecipients.message}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          {channel === "slack" && checked ? (
                            <div className="space-y-1.5 border-t border-border/60 px-3 py-2.5">
                              <Label htmlFor="monitor-slack-url">
                                {t.fieldSlackWebhookUrl}
                              </Label>
                              <Input
                                id="monitor-slack-url"
                                type="url"
                                placeholder={t.fieldSlackWebhookUrlPlaceholder}
                                {...register("slackWebhookUrl")}
                              />
                              {errors.slackWebhookUrl ? (
                                <p className="text-xs text-destructive">
                                  {errors.slackWebhookUrl.message}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  {t.fieldSlackWebhookUrlHint}
                                </p>
                              )}
                            </div>
                          ) : null}
                          {channel === "webhook" && checked ? (
                            <div className="space-y-1.5 border-t border-border/60 px-3 py-2.5">
                              <Label htmlFor="monitor-webhook-url">
                                {t.fieldWebhookUrl}
                              </Label>
                              <Input
                                id="monitor-webhook-url"
                                type="url"
                                placeholder={t.fieldWebhookUrlPlaceholder}
                                {...register("webhookUrl")}
                              />
                              {errors.webhookUrl ? (
                                <p className="text-xs text-destructive">
                                  {errors.webhookUrl.message}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  {t.fieldWebhookUrlHint}
                                </p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              />
              {errors.channels ? (
                <p className="text-xs text-destructive">
                  {errors.channels.message}
                </p>
              ) : null}
            </div>
          </div>
        </Section>

        {/* Advanced */}
        <Section
          icon={<IconSettings className="size-4 text-muted-foreground" />}
          title={t.sectionAdvanced}
          hint={t.sectionAdvancedHint}
          summary={advancedSummary}
          open={sections.advanced}
          onOpenChange={(open) =>
            setSections((prev) => ({ ...prev, advanced: open }))
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
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
        </Section>
      </form>

      {/* Sticky action bar — pinned to the content column, not over the sidebar */}
      <div className="sticky bottom-0 z-10 mt-6 flex items-center justify-end gap-2 border-t border-border/60 bg-background/80 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" form="monitor-form" disabled={saving}>
          {saving ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
          {isEdit ? t.save : t.create}
        </Button>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  hint,
  summary,
  open,
  onOpenChange,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-lg border border-border/60"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-start transition-colors hover:bg-muted/30">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {open ? hint : summary}
          </div>
        </div>
        <IconChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t border-border/60 px-4 py-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function assertionTypeLabel(
  type: AssertionType,
  t: ReturnType<typeof useUptimeT>,
): string {
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
}

function classLabel(
  cls: (typeof STATUS_CLASSES)[number],
  t: ReturnType<typeof useUptimeT>,
): string {
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
}

function channelLabel(
  channel: (typeof KNOWN_CHANNELS)[number],
  t: ReturnType<typeof useUptimeT>,
): string {
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
}

function channelHint(
  channel: (typeof KNOWN_CHANNELS)[number],
  t: ReturnType<typeof useUptimeT>,
): string {
  switch (channel) {
    case "inbox":
      return t.channelInboxHint;
    case "email":
      return t.channelEmailHint;
    case "slack":
      return t.channelSlackHint;
    case "webhook":
      return t.channelWebhookHint;
  }
}
