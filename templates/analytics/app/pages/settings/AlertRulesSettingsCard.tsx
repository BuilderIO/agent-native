import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  IconBell,
  IconChevronDown,
  IconLoader2,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { cn } from "@/lib/utils";

type AlertFilterOp = "equals" | "not_equals" | "contains" | "in" | "exists";

interface AnalyticsAlertFilter {
  field: string;
  op?: AlertFilterOp;
  value?: unknown;
}

type AlertThresholdMode = "event_count" | "distinct_count";
type AlertSeverity = "warning" | "critical";
type AlertStatus = "ok" | "triggered" | "cooldown" | "error" | "running";
type KnownChannel = "inbox" | "email" | "slack" | "webhook";

interface AnalyticsAlertRule {
  id: string;
  name: string;
  description: string;
  eventName: string | null;
  filters: AnalyticsAlertFilter[];
  thresholdMode: AlertThresholdMode;
  distinctBy: string | null;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
  severity: AlertSeverity;
  channels: string[];
  emailRecipients: string[];
  slackWebhookUrl: string | null;
  webhookUrl: string | null;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  lastStatus: AlertStatus | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RunAlertsResult {
  processed: number;
  triggered: number;
  failed: number;
  remaining: number;
}

interface AlertRuleDefaults {
  emailRecipients: string[];
}

interface AlertRuleFormState {
  id?: string;
  name: string;
  description: string;
  eventName: string;
  filtersJson: string;
  thresholdMode: AlertThresholdMode;
  distinctBy: string;
  threshold: string;
  windowMinutes: string;
  cooldownMinutes: string;
  severity: AlertSeverity;
  enabled: boolean;
  channels: Record<KnownChannel, boolean>;
  customChannels: string;
  emailRecipients: string;
  slackWebhookUrl: string;
  webhookUrl: string;
}

const KNOWN_CHANNELS = ["inbox", "email", "slack", "webhook"] as const;

function emptyAlertForm(
  defaults?: AlertRuleDefaults | null,
): AlertRuleFormState {
  const emailRecipients = defaults?.emailRecipients ?? [];
  return {
    name: "",
    description: "",
    eventName: "",
    filtersJson: "[]",
    thresholdMode: "event_count",
    distinctBy: "user_key",
    threshold: "5",
    windowMinutes: "10",
    cooldownMinutes: "30",
    severity: "warning",
    enabled: true,
    channels: {
      inbox: true,
      email: emailRecipients.length > 0,
      slack: false,
      webhook: false,
    },
    customChannels: "",
    emailRecipients: emailRecipients.join("\n"),
    slackWebhookUrl: "",
    webhookUrl: "",
  };
}

function formFromRule(rule: AnalyticsAlertRule): AlertRuleFormState {
  const channelSet = new Set(rule.channels);
  const customChannels = rule.channels.filter(
    (channel): channel is string =>
      !KNOWN_CHANNELS.includes(channel as KnownChannel),
  );

  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    eventName: rule.eventName ?? "",
    filtersJson: JSON.stringify(rule.filters ?? [], null, 2),
    thresholdMode: rule.thresholdMode,
    distinctBy: rule.distinctBy ?? "user_key",
    threshold: String(rule.threshold),
    windowMinutes: String(rule.windowMinutes),
    cooldownMinutes: String(rule.cooldownMinutes),
    severity: rule.severity,
    enabled: rule.enabled,
    channels: {
      inbox: channelSet.has("inbox"),
      email: channelSet.has("email"),
      slack: channelSet.has("slack"),
      webhook: channelSet.has("webhook"),
    },
    customChannels: customChannels.join(", "),
    emailRecipients: rule.emailRecipients.join("\n"),
    slackWebhookUrl: rule.slackWebhookUrl ?? "",
    webhookUrl: rule.webhookUrl ?? "",
  };
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatWindow(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function channelsFromForm(form: AlertRuleFormState): string[] {
  const selected = KNOWN_CHANNELS.filter((channel) => form.channels[channel]);
  const custom = splitList(form.customChannels);
  return [...selected, ...custom];
}

function payloadFromRule(
  rule: AnalyticsAlertRule,
  overrides: Partial<AnalyticsAlertRule> = {},
) {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    eventName: rule.eventName,
    filters: rule.filters,
    thresholdMode: rule.thresholdMode,
    distinctBy: rule.distinctBy,
    threshold: rule.threshold,
    windowMinutes: rule.windowMinutes,
    cooldownMinutes: rule.cooldownMinutes,
    severity: rule.severity,
    channels: rule.channels,
    emailRecipients: rule.emailRecipients,
    slackWebhookUrl: rule.slackWebhookUrl,
    webhookUrl: rule.webhookUrl,
    enabled: rule.enabled,
    ...overrides,
  };
}

function parseFilters(filtersJson: string): AnalyticsAlertFilter[] {
  const trimmed = filtersJson.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("filters must be a JSON array");
  }
  return parsed as AnalyticsAlertFilter[];
}

export function AlertRulesSettingsCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AlertRuleFormState | null>(null);
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [ruleToDelete, setRuleToDelete] = useState<AnalyticsAlertRule | null>(
    null,
  );

  const { data, isLoading, refetch } = useActionQuery<AnalyticsAlertRule[]>(
    "list-analytics-alert-rules",
    undefined,
    { staleTime: 10_000 },
  );
  const { data: alertDefaults } = useActionQuery<AlertRuleDefaults>(
    "get-analytics-alert-rule-defaults",
    undefined,
    { staleTime: 10_000 },
  );
  const saveRule = useActionMutation("save-analytics-alert-rule");
  const deleteRule = useActionMutation("delete-analytics-alert-rule");
  const runAlerts = useActionMutation("run-analytics-alerts");

  const rules = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const enabledCount = rules.filter((rule) => rule.enabled).length;

  async function refreshAlerts() {
    await queryClient.invalidateQueries({
      queryKey: ["action", "list-analytics-alert-rules"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["action", "get-analytics-alert-rule-defaults"],
    });
    await refetch();
  }

  function startCreateAlert() {
    setEditing(emptyAlertForm(alertDefaults));
  }

  function setRuleExpanded(ruleId: string, expanded: boolean) {
    setExpandedRuleIds((current) => {
      const next = new Set(current);
      if (expanded) {
        next.add(ruleId);
      } else {
        next.delete(ruleId);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!editing) return;
    let filters: AnalyticsAlertFilter[];
    try {
      filters = parseFilters(editing.filtersJson);
    } catch (err) {
      toast.error(
        t("settings.alertFiltersInvalid", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return;
    }

    const name = editing.name.trim();
    if (!name) {
      toast.error(t("settings.alertNameRequired"));
      return;
    }

    const channels = channelsFromForm(editing);
    if (channels.length === 0) {
      toast.error(t("settings.alertChannelRequired"));
      return;
    }
    if (
      editing.channels.slack &&
      editing.slackWebhookUrl.trim() &&
      !isHttpUrl(editing.slackWebhookUrl.trim())
    ) {
      toast.error(t("settings.alertSlackWebhookUrlInvalid"));
      return;
    }
    if (
      editing.channels.webhook &&
      editing.webhookUrl.trim() &&
      !isHttpUrl(editing.webhookUrl.trim())
    ) {
      toast.error(t("settings.alertWebhookUrlInvalid"));
      return;
    }

    try {
      await saveRule.mutateAsync({
        id: editing.id,
        name,
        description: editing.description.trim(),
        eventName: editing.eventName.trim() || null,
        filters,
        thresholdMode: editing.thresholdMode,
        distinctBy:
          editing.thresholdMode === "distinct_count"
            ? editing.distinctBy.trim() || "user_key"
            : editing.distinctBy.trim() || null,
        threshold: parseInteger(editing.threshold, 1),
        windowMinutes: parseInteger(editing.windowMinutes, 10),
        cooldownMinutes: parseInteger(editing.cooldownMinutes, 30),
        severity: editing.severity,
        channels,
        emailRecipients: splitList(editing.emailRecipients),
        slackWebhookUrl: editing.channels.slack
          ? editing.slackWebhookUrl.trim()
          : null,
        webhookUrl: editing.channels.webhook ? editing.webhookUrl.trim() : null,
        enabled: editing.enabled,
      });
      setEditing(null);
      await refreshAlerts();
      toast.success(t("settings.alertSaved"));
    } catch (err) {
      toast.error(
        t("settings.alertSaveFailed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async function handleToggle(rule: AnalyticsAlertRule, enabled: boolean) {
    try {
      await saveRule.mutateAsync(payloadFromRule(rule, { enabled }));
      await refreshAlerts();
      toast.success(
        enabled
          ? t("settings.alertEnabledToast")
          : t("settings.alertDisabledToast"),
      );
    } catch (err) {
      toast.error(
        t("settings.alertSaveFailed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async function handleDelete() {
    if (!ruleToDelete) return;
    try {
      await deleteRule.mutateAsync({ id: ruleToDelete.id });
      setRuleToDelete(null);
      await refreshAlerts();
      toast.success(t("settings.alertDeleted"));
    } catch (err) {
      toast.error(
        t("settings.alertDeleteFailed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async function handleRunAlerts() {
    try {
      const result = (await runAlerts.mutateAsync({
        limit: 200,
      })) as RunAlertsResult;
      await refreshAlerts();
      toast.success(
        t("settings.alertRunComplete", {
          processed: result.processed,
          triggered: result.triggered,
          failed: result.failed,
        }),
      );
    } catch (err) {
      toast.error(
        t("settings.alertRunFailed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return (
    <>
      <Card id="alert-rules" className="bg-card border-border/50 scroll-mt-16">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconBell className="size-4 text-primary" />
                {t("settings.alertsTitle")}
              </CardTitle>
              <CardDescription>
                {t("settings.alertsDescription")}
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRunAlerts}
                disabled={runAlerts.isPending || enabledCount === 0}
              >
                {runAlerts.isPending ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconPlayerPlay className="size-3.5" />
                )}
                {t("settings.alertRunNow")}
              </Button>
              <Button type="button" size="sm" onClick={startCreateAlert}>
                <IconPlus className="size-3.5" />
                {t("settings.alertNew")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-14 rounded-md border border-border bg-muted/30"
                />
              ))}
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-6 text-center">
              <p className="text-sm font-medium">
                {t("settings.alertsEmptyTitle")}
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {t("settings.alertsEmptyDescription")}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-4"
                onClick={startCreateAlert}
              >
                <IconPlus className="size-3.5" />
                {t("settings.alertNew")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => {
                const expanded = expandedRuleIds.has(rule.id);
                return (
                  <Collapsible
                    key={rule.id}
                    open={expanded}
                    onOpenChange={(open) => setRuleExpanded(rule.id, open)}
                    className="rounded-lg border border-border/60 bg-background/40"
                  >
                    <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(enabled) =>
                            void handleToggle(rule, enabled)
                          }
                          aria-label={t("settings.alertToggleLabel", {
                            name: rule.name,
                          })}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {rule.name}
                            </span>
                            <Badge
                              variant={
                                rule.severity === "critical"
                                  ? "destructive"
                                  : "outline"
                              }
                              className="shrink-0 text-[10px]"
                            >
                              {rule.severity === "critical"
                                ? t("settings.alertSeverityCritical")
                                : t("settings.alertSeverityWarning")}
                            </Badge>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {rule.description || formatScope(rule, t)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                        <div className="min-w-0 text-xs sm:w-40">
                          <div className="truncate font-medium">
                            {formatThreshold(rule, t)}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
                            <span
                              className={cn(
                                "size-1.5 rounded-full",
                                statusDotClass(rule.lastStatus),
                              )}
                            />
                            <span>{statusLabel(rule.lastStatus, t)}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditing(formFromRule(rule))}
                            aria-label={t("settings.alertEditLabel", {
                              name: rule.name,
                            })}
                          >
                            <IconPencil className="size-3.5" />
                            {t("sidebar.edit")}
                          </Button>
                          <CollapsibleTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={t("sessions.devtoolsToggleDetails")}
                            >
                              {t("sqlDashboard.details")}
                              <IconChevronDown
                                className={cn(
                                  "size-3.5 transition-transform",
                                  expanded && "rotate-180",
                                )}
                              />
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                      </div>
                    </div>

                    <CollapsibleContent className="border-t border-border/60 px-3 py-3">
                      <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                        <AlertRuleDetail
                          label={t("settings.alertConditionColumn")}
                          value={formatThreshold(rule, t)}
                          detail={formatScope(rule, t)}
                        />
                        <AlertRuleDetail
                          label={t("settings.alertDeliveryColumn")}
                          value={rule.channels
                            .map((channel) => knownChannelLabel(channel, t))
                            .join(", ")}
                          detail={
                            rule.emailRecipients.length > 0
                              ? rule.emailRecipients.join(", ")
                              : undefined
                          }
                        />
                        <AlertRuleDetail
                          label={t("settings.alertStatusColumn")}
                          value={statusLabel(rule.lastStatus, t)}
                          detail={t("settings.alertLastChecked", {
                            date: formatDate(
                              rule.lastEvaluatedAt,
                              t("settings.alertNever"),
                            ),
                          })}
                        />
                        <AlertRuleDetail
                          label={t("settings.alertEventName")}
                          value={rule.eventName || t("settings.alertAllEvents")}
                        />
                        <AlertRuleDetail
                          label={t("settings.alertFilters")}
                          value={
                            rule.filters.length > 0
                              ? JSON.stringify(rule.filters)
                              : "[]"
                          }
                        />
                        <AlertRuleDetail
                          label={t("settings.alertStatusTriggered")}
                          value={formatDate(
                            rule.lastTriggeredAt,
                            t("settings.alertNever"),
                          )}
                        />
                      </div>
                      {rule.lastError ? (
                        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                          {rule.lastError}
                        </div>
                      ) : null}
                      <div className="mt-3 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRuleToDelete(rule)}
                          aria-label={t("settings.alertDeleteLabel", {
                            name: rule.name,
                          })}
                        >
                          <IconTrash className="size-3.5" />
                          {t("sidebar.delete")}
                        </Button>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertRuleDialog
        form={editing}
        setForm={setEditing}
        onSave={handleSave}
        saving={saveRule.isPending}
      />

      <AlertDialog
        open={!!ruleToDelete}
        onOpenChange={(open) => !open && setRuleToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.alertDeleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.alertDeleteDescription", {
                name: ruleToDelete?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteRule.isPending}
            >
              {deleteRule.isPending && (
                <IconLoader2 className="size-3.5 animate-spin" />
              )}
              {t("sidebar.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AlertRuleDetail({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/25 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-medium">{value}</div>
      {detail ? (
        <div className="mt-0.5 truncate text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function AlertRuleDialog({
  form,
  setForm,
  onSave,
  saving,
}: {
  form: AlertRuleFormState | null;
  setForm: (form: AlertRuleFormState | null) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const t = useT();

  if (!form) return null;

  const setField = <K extends keyof AlertRuleFormState>(
    key: K,
    value: AlertRuleFormState[K],
  ) => {
    setForm({ ...form, [key]: value });
  };

  const setChannel = (channel: KnownChannel, checked: boolean) => {
    setField("channels", {
      ...form.channels,
      [channel]: checked,
    });
  };

  return (
    <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>
            {form.id ? t("settings.alertEdit") : t("settings.alertCreate")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.alertDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alert-name">{t("settings.alertName")}</Label>
            <Input
              id="alert-name"
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              placeholder={t("settings.alertNamePlaceholder")}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alert-description">
              {t("settings.alertDescription")}
            </Label>
            <Textarea
              id="alert-description"
              value={form.description}
              onChange={(event) => setField("description", event.target.value)}
              className="min-h-[72px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alert-event-name">
              {t("settings.alertEventName")}
            </Label>
            <Input
              id="alert-event-name"
              value={form.eventName}
              onChange={(event) => setField("eventName", event.target.value)}
              placeholder={t("settings.alertEventNamePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alert-severity">
              {t("settings.alertSeverity")}
            </Label>
            <Select
              value={form.severity}
              onValueChange={(value) =>
                setField("severity", value as AlertSeverity)
              }
            >
              <SelectTrigger id="alert-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warning">
                  {t("settings.alertSeverityWarning")}
                </SelectItem>
                <SelectItem value="critical">
                  {t("settings.alertSeverityCritical")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alert-threshold-mode">
              {t("settings.alertThresholdMode")}
            </Label>
            <Select
              value={form.thresholdMode}
              onValueChange={(value) =>
                setField("thresholdMode", value as AlertThresholdMode)
              }
            >
              <SelectTrigger id="alert-threshold-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="event_count">
                  {t("settings.alertModeEventCount")}
                </SelectItem>
                <SelectItem value="distinct_count">
                  {t("settings.alertModeDistinctCount")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alert-threshold">
              {t("settings.alertThreshold")}
            </Label>
            <Input
              id="alert-threshold"
              inputMode="numeric"
              value={form.threshold}
              onChange={(event) => setField("threshold", event.target.value)}
            />
          </div>

          {form.thresholdMode === "distinct_count" ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="alert-distinct-by">
                {t("settings.alertDistinctBy")}
              </Label>
              <Input
                id="alert-distinct-by"
                value={form.distinctBy}
                onChange={(event) => setField("distinctBy", event.target.value)}
                placeholder="user_key"
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="alert-window">
              {t("settings.alertWindowMinutes")}
            </Label>
            <Input
              id="alert-window"
              inputMode="numeric"
              value={form.windowMinutes}
              onChange={(event) =>
                setField("windowMinutes", event.target.value)
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alert-cooldown">
              {t("settings.alertCooldownMinutes")}
            </Label>
            <Input
              id="alert-cooldown"
              inputMode="numeric"
              value={form.cooldownMinutes}
              onChange={(event) =>
                setField("cooldownMinutes", event.target.value)
              }
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alert-filters-json">
              {t("settings.alertFilters")}
            </Label>
            <Textarea
              id="alert-filters-json"
              value={form.filtersJson}
              onChange={(event) => setField("filtersJson", event.target.value)}
              className="min-h-[104px] font-mono text-xs"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>{t("settings.alertChannels")}</Label>
            <div className="grid gap-2 sm:grid-cols-4">
              {KNOWN_CHANNELS.map((channel) => (
                <label
                  key={channel}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={form.channels[channel]}
                    onCheckedChange={(checked) =>
                      setChannel(channel, checked === true)
                    }
                  />
                  {knownChannelLabel(channel, t)}
                </label>
              ))}
            </div>
          </div>

          {form.channels.slack ? (
            <div className="space-y-1.5">
              <Label htmlFor="alert-slack-webhook-url">
                {t("settings.alertSlackWebhookUrl")}
              </Label>
              <Input
                id="alert-slack-webhook-url"
                type="url"
                value={form.slackWebhookUrl}
                onChange={(event) =>
                  setField("slackWebhookUrl", event.target.value)
                }
                placeholder={t("settings.alertSlackWebhookUrlPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.alertSlackWebhookUrlHint")}
              </p>
            </div>
          ) : null}

          {form.channels.webhook ? (
            <div className="space-y-1.5">
              <Label htmlFor="alert-webhook-url">
                {t("settings.alertWebhookUrl")}
              </Label>
              <Input
                id="alert-webhook-url"
                type="url"
                value={form.webhookUrl}
                onChange={(event) => setField("webhookUrl", event.target.value)}
                placeholder={t("settings.alertWebhookUrlPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.alertWebhookUrlHint")}
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="alert-custom-channels">
              {t("settings.alertCustomChannels")}
            </Label>
            <Input
              id="alert-custom-channels"
              value={form.customChannels}
              onChange={(event) =>
                setField("customChannels", event.target.value)
              }
              placeholder={t("settings.alertCustomChannelsPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alert-email-recipients">
              {t("settings.alertEmailRecipients")}
            </Label>
            <Textarea
              id="alert-email-recipients"
              value={form.emailRecipients}
              onChange={(event) =>
                setField("emailRecipients", event.target.value)
              }
              className="min-h-[72px]"
              placeholder={t("settings.alertEmailRecipientsPlaceholder")}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 sm:col-span-2">
            <div className="min-w-0">
              <Label>{t("settings.alertEnabled")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.alertEnabledDescription")}
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(checked) => setField("enabled", checked)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setForm(null)}>
            {t("sidebar.cancel")}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <IconLoader2 className="size-3.5 animate-spin" />}
            {form.id ? t("settings.alertUpdate") : t("settings.alertSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function knownChannelLabel(
  channel: string,
  t: ReturnType<typeof useT>,
): string {
  if (channel === "inbox") return t("settings.alertChannelInbox");
  if (channel === "email") return t("settings.alertChannelEmail");
  if (channel === "slack") return t("settings.alertChannelSlack");
  if (channel === "webhook") return t("settings.alertChannelWebhook");
  return channel;
}

function statusLabel(
  status: AlertStatus | null,
  t: ReturnType<typeof useT>,
): string {
  if (status === "ok") return t("settings.alertStatusOk");
  if (status === "triggered") return t("settings.alertStatusTriggered");
  if (status === "cooldown") return t("settings.alertStatusCooldown");
  if (status === "error") return t("settings.alertStatusError");
  if (status === "running") return t("settings.alertStatusRunning");
  return t("settings.alertStatusNever");
}

function statusDotClass(status: AlertStatus | null): string {
  if (status === "triggered") return "bg-destructive";
  if (status === "error") return "bg-destructive";
  if (status === "running") return "bg-primary animate-pulse";
  if (status === "cooldown") return "bg-amber-500";
  if (status === "ok") return "bg-emerald-500";
  return "bg-muted-foreground/40";
}

function formatScope(
  rule: AnalyticsAlertRule,
  t: ReturnType<typeof useT>,
): string {
  const filterCount = rule.filters.length;
  const base = rule.eventName || t("settings.alertAllEvents");
  if (filterCount === 0) return base;
  return t("settings.alertScopeWithFilters", {
    scope: base,
    count: filterCount,
  });
}

function formatThreshold(
  rule: AnalyticsAlertRule,
  t: ReturnType<typeof useT>,
): string {
  const window = formatWindow(rule.windowMinutes);
  if (rule.thresholdMode === "distinct_count") {
    return t("settings.alertDistinctThresholdSummary", {
      count: rule.threshold,
      field: rule.distinctBy || "user_key",
      window,
    });
  }
  return t("settings.alertEventThresholdSummary", {
    count: rule.threshold,
    window,
  });
}
