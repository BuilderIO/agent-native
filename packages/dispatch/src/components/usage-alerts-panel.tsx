import type { UsageAlertRule } from "@agent-native/core";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { IconBell, IconMail, IconPencil, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { Switch } from "./ui/switch";

export interface UsageAlertAppOption {
  id: string;
  label: string;
}

interface UsageAlertsPanelProps {
  scope: "user" | "workspace";
  appOptions?: UsageAlertAppOption[];
}

type AlertUnit = "usd" | "builder-credits" | "tokens";
type AlertChannel = "in-app" | "email";

interface AlertDraft {
  ruleId?: string;
  appId: string;
  unit: AlertUnit;
  period: "day" | "month";
  limit: string;
  inApp: boolean;
  email: boolean;
}

function asRules(value: unknown): UsageAlertRule[] {
  if (Array.isArray(value)) return value as UsageAlertRule[];
  if (value && typeof value === "object") {
    const rules = (value as { rules?: unknown }).rules;
    if (Array.isArray(rules)) return rules as UsageAlertRule[];
  }
  return [];
}

function formatAlertValue(rule: UsageAlertRule, value: number): string {
  if (rule.unit === "usd") {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  }
  return (
    value.toLocaleString(undefined, {
      maximumFractionDigits: rule.unit === "builder-credits" ? 2 : 0,
    }) +
    " " +
    (rule.unit === "builder-credits" ? "credits" : "tokens")
  );
}

function draftFromRule(rule: UsageAlertRule): AlertDraft {
  return {
    ruleId: rule.id,
    appId: rule.appId ?? "",
    unit: rule.unit,
    period: rule.period,
    limit: String(rule.limit),
    inApp: rule.channels.includes("in-app"),
    email: rule.channels.includes("email"),
  };
}

function defaultDraft(): AlertDraft {
  return {
    appId: "",
    unit: "usd",
    period: "day",
    limit: "100",
    inApp: true,
    email: true,
  };
}

function AlertEditor({
  draft,
  appOptions,
  isExisting,
  onChange,
  onSave,
  onCancel,
  isPending,
}: {
  draft: AlertDraft;
  appOptions: UsageAlertAppOption[];
  isExisting: boolean;
  onChange: (patch: Partial<AlertDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-background/60 p-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="space-y-1.5 text-xs text-muted-foreground">
        <span>App</span>
        <Select
          value={draft.appId || "all"}
          onValueChange={(value) =>
            onChange({ appId: value === "all" ? "" : value })
          }
          disabled={isExisting}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All apps</SelectItem>
            {appOptions.map((app) => (
              <SelectItem key={app.id} value={app.id}>
                {app.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-1.5 text-xs text-muted-foreground">
        <span>Unit</span>
        <Select
          value={draft.unit}
          onValueChange={(value) => onChange({ unit: value as AlertUnit })}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="usd">Dollars</SelectItem>
            <SelectItem value="builder-credits">Credits</SelectItem>
            <SelectItem value="tokens">Tokens</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-1.5 text-xs text-muted-foreground">
        <span>Limit</span>
        <Input
          type="number"
          min="0.01"
          step={draft.unit === "tokens" ? "1" : "0.01"}
          value={draft.limit}
          onChange={(event) => onChange({ limit: event.target.value })}
          className="h-9 text-sm"
        />
      </label>
      <label className="space-y-1.5 text-xs text-muted-foreground">
        <span>Period</span>
        <Select
          value={draft.period}
          onValueChange={(value) =>
            onChange({ period: value as "day" | "month" })
          }
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Per day</SelectItem>
            <SelectItem value="month">Per month</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <div className="flex flex-wrap items-end gap-3 pb-1 text-xs text-muted-foreground">
        <label className="inline-flex items-center gap-2">
          <Checkbox
            checked={draft.inApp}
            onCheckedChange={(checked) => onChange({ inApp: checked === true })}
          />
          In app
        </label>
        <label className="inline-flex items-center gap-2">
          <Checkbox
            checked={draft.email}
            onCheckedChange={(checked) => onChange({ email: checked === true })}
          />
          Email
        </label>
        <Button
          type="button"
          size="sm"
          className="ms-auto h-8"
          onClick={onSave}
          disabled={isPending}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function UsageAlertsPanel({
  scope,
  appOptions = [],
}: UsageAlertsPanelProps) {
  const query = useActionQuery("get-usage-alerts", { scope });
  const mutation = useActionMutation("manage-usage-alert", {
    onSuccess: () => {
      setEditing(null);
      toast.success("Usage alert updated");
    },
    onError: (error) => toast.error(String(error)),
  });
  const [editing, setEditing] = useState<AlertDraft | null>(null);
  const rules = asRules(query.data);
  const appLabels = useMemo(
    () => new Map(appOptions.map((app) => [app.id, app.label])),
    [appOptions],
  );

  function saveDraft() {
    if (!editing) return;
    const limit = Number(editing.limit);
    const channels: AlertChannel[] = [];
    if (editing.inApp) channels.push("in-app");
    if (editing.email) channels.push("email");
    if (!Number.isFinite(limit) || limit <= 0) {
      toast.error("Enter a positive threshold.");
      return;
    }
    if (channels.length === 0) {
      toast.error("Choose at least one delivery channel.");
      return;
    }
    mutation.mutate({
      operation: "save",
      scope,
      ruleId: editing.ruleId,
      appId: editing.appId || null,
      unit: editing.unit,
      period: editing.period,
      limit,
      channels,
      enabled: true,
    });
  }

  return (
    <section className="rounded-lg bg-card">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Usage alerts
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Get a quiet in-app and email notice when usage crosses a daily or
            monthly limit.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(defaultDraft())}
          disabled={mutation.isPending}
        >
          Add alert
        </Button>
      </div>

      <div className="divide-y">
        {query.isLoading && rules.length === 0 ? (
          <div className="space-y-3 px-4 py-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-2/3 max-w-sm" />
                <Skeleton className="h-3 w-1/2 max-w-xs" />
              </div>
            ))}
          </div>
        ) : null}
        {query.isError ? (
          <div className="px-4 py-6 text-sm text-destructive">
            Usage alerts are unavailable for this scope.{" "}
            {query.error instanceof Error ? query.error.message : "Try again."}
          </div>
        ) : null}
        {!query.isLoading && !query.isError && rules.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No alerts yet. The recommended default is $100 per day across all
            apps.
          </div>
        ) : null}
        {rules.map((rule) => {
          const isEditing = editing?.ruleId === rule.id;
          const target = rule.appId
            ? appLabels.get(rule.appId) || rule.appId
            : "All apps";
          return (
            <div key={rule.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {target}
                    </span>
                    {rule.isDefault ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : null}
                    <Badge
                      variant={
                        rule.status === "triggered" ? "destructive" : "outline"
                      }
                    >
                      {rule.status === "triggered"
                        ? "Over limit"
                        : rule.status === "dismissed"
                          ? "Dismissed"
                          : "On track"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatAlertValue(rule, rule.current)} of{" "}
                    {formatAlertValue(rule, rule.limit)} · per {rule.period}
                    {rule.percent > 0 ? " · " + rule.percent + "%" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(checked) =>
                      mutation.mutate({
                        operation: "set-enabled",
                        scope,
                        ruleId: rule.id,
                        enabled: checked,
                      })
                    }
                    aria-label={
                      (rule.enabled ? "Disable " : "Enable ") +
                      target +
                      " usage alert"
                    }
                    disabled={mutation.isPending}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing(draftFromRule(rule))}
                    aria-label={"Edit " + target + " usage alert"}
                    disabled={mutation.isPending}
                  >
                    <IconPencil className="size-4" />
                  </Button>
                  {rule.status === "triggered" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        mutation.mutate({
                          operation: "dismiss",
                          scope,
                          ruleId: rule.id,
                        })
                      }
                      aria-label={"Dismiss " + target + " usage alert"}
                      disabled={mutation.isPending}
                    >
                      <IconX className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {rule.channels.includes("in-app") ? (
                  <span className="inline-flex items-center gap-1">
                    <IconBell className="size-3.5" /> In app
                  </span>
                ) : null}
                {rule.channels.includes("email") ? (
                  <span className="inline-flex items-center gap-1">
                    <IconMail className="size-3.5" /> Email
                  </span>
                ) : null}
              </div>
              {isEditing && editing ? (
                <div className="mt-4">
                  <AlertEditor
                    draft={editing}
                    appOptions={appOptions}
                    isExisting
                    onChange={(patch) =>
                      setEditing((current) =>
                        current ? { ...current, ...patch } : current,
                      )
                    }
                    onSave={saveDraft}
                    onCancel={() => setEditing(null)}
                    isPending={mutation.isPending}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
        {editing && !editing.ruleId ? (
          <div className="px-4 py-4">
            <AlertEditor
              draft={editing}
              appOptions={appOptions}
              isExisting={false}
              onChange={(patch) =>
                setEditing((current) =>
                  current ? { ...current, ...patch } : current,
                )
              }
              onSave={saveDraft}
              onCancel={() => setEditing(null)}
              isPending={mutation.isPending}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
