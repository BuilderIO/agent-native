import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  type ModelRow,
  type RowAttributes,
  rowAttributes,
  rowIdSegment,
} from "@agent-native/design-system/model";
import { Skeleton } from "@agent-native/toolkit/design-system";
import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { cn } from "@agent-native/toolkit/utils";
import { IconAlertCircle } from "@tabler/icons-react";
import { useId, useState, type ReactNode } from "react";

import { UsageGroup } from "./UsageGroup.js";

type AlertUnit = "usd" | "builder-credits" | "tokens";
type AlertPeriod = "day" | "month";
type AlertChannel = "in-app" | "email";

interface UsageAlertRule {
  id: string;
  appId: string | null;
  unit: AlertUnit;
  period: AlertPeriod;
  limit: number;
  channels: AlertChannel[];
  enabled: boolean;
  isDefault: boolean;
  status: "ok" | "triggered" | "dismissed";
  current: number;
}

interface AlertMutationInput {
  operation: "save" | "set-enabled" | "dismiss";
  scope: "user";
  ruleId: string;
  appId?: string | null;
  unit?: AlertUnit;
  period?: AlertPeriod;
  limit?: number;
  channels?: AlertChannel[];
  enabled?: boolean;
}

/** The default rule's limit as `alerts-store` seeds it: 20 USD a month. */
const DEFAULT_LIMIT: Partial<Record<AlertUnit, number>> = {
  usd: 20,
  "builder-credits": 500,
};

type Translation = ReturnType<typeof useT>;
type Formatters = ReturnType<typeof useFormatters>;

function ruleName(t: Translation, rule: UsageAlertRule): string {
  const tokens = rule.unit === "tokens";
  if (rule.period === "month") {
    return t(
      tokens
        ? "agentChat.settings.usage.alertMonthlyTokens"
        : "agentChat.settings.usage.alertMonthlySpend",
    );
  }
  return t(
    tokens
      ? "agentChat.settings.usage.alertDailyTokens"
      : "agentChat.settings.usage.alertDailySpend",
  );
}

export function formatAlertValue(
  t: Translation,
  format: Formatters,
  unit: AlertUnit,
  value: number,
): string {
  if (unit === "usd") {
    return format.formatNumber(value, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  const amount = format.formatNumber(value, {
    notation: unit === "tokens" && value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: unit === "tokens" ? 1 : 2,
  });
  return t(
    unit === "tokens"
      ? "agentChat.settings.usage.tokenAmount"
      : "agentChat.settings.usage.creditAmount",
    { count: value, amount },
  );
}

function channelsLabel(t: Translation, channels: AlertChannel[]): string {
  const inApp = channels.includes("in-app");
  const email = channels.includes("email");
  if (inApp && email) return t("agentChat.settings.usage.alertChannelsBoth");
  return t(
    inApp
      ? "agentChat.settings.usage.alertChannelInApp"
      : "agentChat.settings.usage.alertChannelEmail",
  );
}

function statusLabel(t: Translation, rule: UsageAlertRule): string {
  if (!rule.enabled) return t("agentChat.settings.usage.alertOff");
  if (rule.status === "triggered") {
    return t("agentChat.settings.usage.alertOverLimit");
  }
  if (rule.status === "dismissed") {
    return t("agentChat.settings.usage.alertDismissed");
  }
  return t("agentChat.settings.usage.alertOnTrack");
}

function AlertsSkeleton({ attributes }: { attributes: RowAttributes }) {
  return (
    <div {...attributes} aria-hidden="true" className="px-5 py-4 sm:px-6">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-2 h-3 w-72 max-w-full" />
    </div>
  );
}

/** Your alert rules across every app, each edited in a dialog. */
export function UsageAlertsGroup({
  appName,
}: {
  appName: (key: string) => string;
}) {
  const t = useT();
  const format = useFormatters();
  const query = useActionQuery<UsageAlertRule[]>("get-usage-alerts", {
    scope: "user",
    appId: null,
  });
  const mutation = useActionMutation<unknown, AlertMutationInput>(
    "manage-usage-alert",
  );
  const [editing, setEditing] = useState<UsageAlertRule | null>(null);
  const rules = query.data ?? [];

  const rows: ModelRow[] = [];
  const slots: Record<string, ReactNode | ((row: ModelRow) => ReactNode)> = {};
  const actions: Record<string, () => void> = {};
  if (query.isLoading) {
    rows.push({
      id: "settings.usage.alerts.loading",
      part: "settings.content",
      label: t("agentChat.common.loading"),
      slot: "alerts-loading",
    });
    slots["alerts-loading"] = (row) => (
      <AlertsSkeleton attributes={rowAttributes(row)} />
    );
  }
  if (query.isError) {
    rows.push({
      id: "settings.usage.alerts.load-error",
      part: "settings.row",
      label: t("agentChat.settings.usage.alertsLoadError"),
      rows: [
        {
          id: "settings.usage.alerts.load-error.retry",
          part: "button",
          kind: "action",
          label: t("agentChat.common.retry"),
          state: { disabled: query.isFetching },
          effect: { kind: "action", effectId: "retry-alerts" },
        },
      ],
    });
    actions["retry-alerts"] = () => void query.refetch();
  }
  for (const rule of rules) {
    const progress = t(
      rule.period === "month"
        ? "agentChat.settings.usage.alertProgressMonth"
        : "agentChat.settings.usage.alertProgressDay",
      {
        current: formatAlertValue(t, format, rule.unit, rule.current),
        limit: formatAlertValue(t, format, rule.unit, rule.limit),
      },
    );
    const id = `settings.usage.alerts.${rowIdSegment(rule.id)}`;
    const badge = rule.isDefault
      ? t("agentChat.settings.usage.alertDefault")
      : rule.appId
        ? appName(rule.appId)
        : null;
    rows.push({
      id,
      part: "settings.row",
      label: ruleName(t, rule),
      description: [
        statusLabel(t, rule),
        progress,
        channelsLabel(t, rule.channels),
      ].join(" · "),
      anchor: `usage-alert-${rule.id}`,
      ...(badge
        ? { state: { badge: { kind: "label" as const, value: badge } } }
        : {}),
      slot: `${id}:controls`,
    });
    slots[`${id}:controls`] = (
      <div className="flex items-center gap-2">
        {rule.enabled && rule.status === "triggered" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                operation: "dismiss",
                scope: "user",
                ruleId: rule.id,
              })
            }
          >
            {t("agentChat.common.dismiss")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(rule)}
        >
          {t("agentChat.settings.usage.alertEdit")}
        </Button>
      </div>
    );
  }

  return (
    <UsageGroup
      id="usage-alerts"
      title={t("agentChat.settings.usage.yourAlerts")}
      rows={rows}
      actions={actions}
      slots={slots}
    >
      {editing ? (
        <AlertDialog
          rule={editing}
          appName={appName}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </UsageGroup>
  );
}

function AlertDialog({
  rule,
  appName,
  onClose,
}: {
  rule: UsageAlertRule;
  appName: (key: string) => string;
  onClose: () => void;
}) {
  const t = useT();
  const inputId = useId();
  const switchId = useId();
  const [limit, setLimit] = useState(String(rule.limit));
  const [channels, setChannels] = useState<AlertChannel[]>(rule.channels);
  const [enabled, setEnabled] = useState(rule.enabled);
  const mutation = useActionMutation<unknown, AlertMutationInput>(
    "manage-usage-alert",
    { errorNotification: "caller" },
  );

  const name = ruleName(t, rule);
  const resetLimit = rule.isDefault ? DEFAULT_LIMIT[rule.unit] : undefined;
  const hint = rule.appId
    ? t(
        rule.period === "month"
          ? "agentChat.settings.usage.alertHintMonthApp"
          : "agentChat.settings.usage.alertHintDayApp",
        { app: appName(rule.appId) },
      )
    : t(
        rule.period === "month"
          ? "agentChat.settings.usage.alertHintMonthAll"
          : "agentChat.settings.usage.alertHintDayAll",
      );
  const unitLabel = t(
    rule.unit === "usd"
      ? "agentChat.settings.usage.unitUsd"
      : rule.unit === "tokens"
        ? "agentChat.settings.usage.unitTokens"
        : "agentChat.settings.usage.unitCredits",
  );
  const parsedLimit = Number(limit);
  const limitValid =
    limit.trim() !== "" && Number.isFinite(parsedLimit) && parsedLimit > 0;
  const limitInvalid = limit.trim() !== "" && !limitValid;
  const channelsValid = channels.length > 0;

  function save(next: {
    limit: number;
    period?: AlertPeriod;
    channels: AlertChannel[];
    enabled: boolean;
  }) {
    if (mutation.isPending) return;
    mutation.mutate(
      {
        operation: "save",
        scope: "user",
        ruleId: rule.id,
        // `save` rewrites app_id from the payload, so omitting it would
        // turn an app's rule into one that counts every app.
        appId: rule.appId,
        unit: rule.unit,
        period: next.period ?? rule.period,
        limit: next.limit,
        channels: next.channels,
        enabled: next.enabled,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!limitValid || !channelsValid) return;
            save({ limit: parsedLimit, channels, enabled });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("agentChat.settings.usage.alertDialogTitle", { name })}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>
              {t("agentChat.settings.usage.alertThreshold")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={inputId}
                type="number"
                inputMode="decimal"
                min="0"
                step={rule.unit === "tokens" ? "1" : "0.01"}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                aria-invalid={limitInvalid ? true : undefined}
                aria-describedby={`${inputId}-hint`}
                autoFocus
              />
              <span className="shrink-0 text-sm text-muted-foreground">
                {unitLabel}
              </span>
            </div>
            <p
              id={`${inputId}-hint`}
              className={cn(
                "text-sm",
                limitInvalid ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {limitInvalid
                ? t("agentChat.settings.usage.alertInvalidLimit")
                : hint}
            </p>
          </div>
          <fieldset
            className="grid gap-2"
            aria-describedby={`${inputId}-channels`}
          >
            <legend className="mb-2 text-sm font-medium">
              {t("agentChat.settings.usage.alertNotify")}
            </legend>
            <div className="flex flex-wrap items-center gap-5">
              {(
                [
                  ["in-app", "agentChat.settings.usage.alertChannelInApp"],
                  ["email", "agentChat.settings.usage.alertChannelEmail"],
                ] as const
              ).map(([channel, key]) => (
                <Label
                  key={channel}
                  className="flex items-center gap-2 font-normal"
                >
                  <Checkbox
                    checked={channels.includes(channel)}
                    aria-invalid={channelsValid ? undefined : true}
                    onCheckedChange={(checked) =>
                      setChannels((current) =>
                        checked === true
                          ? [...new Set([...current, channel])]
                          : current.filter((value) => value !== channel),
                      )
                    }
                  />
                  {t(key)}
                </Label>
              ))}
            </div>
            <p
              id={`${inputId}-channels`}
              className="min-h-5 text-sm text-destructive"
            >
              {channelsValid
                ? null
                : t("agentChat.settings.usage.alertNoChannel")}
            </p>
          </fieldset>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={switchId}>
              {t("agentChat.settings.usage.alertEnabled")}
            </Label>
            <Switch
              id={switchId}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
          {mutation.error ? (
            <Alert variant="destructive">
              <IconAlertCircle aria-hidden="true" />
              <AlertDescription>
                {mutation.error.message ||
                  t("agentChat.settings.usage.alertSaveError")}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter className="gap-2 sm:space-x-0">
            {resetLimit !== undefined ? (
              <Button
                type="button"
                variant="ghost"
                className="sm:me-auto"
                disabled={mutation.isPending}
                onClick={() => {
                  const reset = {
                    limit: resetLimit,
                    period: "month" as const,
                    channels: ["in-app", "email"] as AlertChannel[],
                    enabled: true,
                  };
                  setLimit(String(reset.limit));
                  setChannels(reset.channels);
                  setEnabled(true);
                  save(reset);
                }}
              >
                {t("agentChat.settings.usage.alertReset")}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("agentChat.common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!limitValid || !channelsValid || mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Spinner aria-hidden="true" />
                  {t("agentChat.common.saving")}
                </>
              ) : (
                t("agentChat.common.save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
