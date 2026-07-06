import {
  useActionMutation,
  useActionQuery,
  useSession,
  useT,
} from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconChevronLeft,
  IconFilter,
  IconPlus,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  normalizeReportFilterSnapshot,
  reportFilterSnapshotKey,
  savedReportFiltersForEdit,
} from "./report-filters";

type DashboardReportSubscription = {
  id: string;
  dashboardId: string;
  name: string;
  recipients: string[];
  filters: Record<string, string>;
  timeOfDay: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "success" | "error" | "running" | null;
  lastError: string | null;
};

type DialogView = "list" | "form";

interface EmailReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  dashboardName: string;
  filters: Record<string, string>;
}

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function splitRecipients(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
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

export function EmailReportDialog({
  open,
  onOpenChange,
  dashboardId,
  dashboardName,
  filters,
}: EmailReportDialogProps) {
  const t = useT();
  const { session } = useSession();
  const initialized = useRef(false);
  const defaultEmail = session?.email ?? "";
  const defaultName = `${dashboardName} daily email`;

  const [view, setView] = useState<DialogView>("form");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState(defaultName);
  const [recipientsText, setRecipientsText] = useState(defaultEmail);
  const [reportFilters, setReportFilters] = useState<Record<string, string>>(
    () => normalizeReportFilterSnapshot(filters),
  );
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [timezone, setTimezone] = useState(localTimezone());
  const [enabled, setEnabled] = useState(true);

  const { data, isLoading, refetch } = useActionQuery<
    DashboardReportSubscription[]
  >(
    "list-dashboard-report-subscriptions",
    dashboardId ? { dashboardId } : undefined,
    { enabled: open && !!dashboardId },
  );
  const saveSubscription = useActionMutation(
    "save-dashboard-report-subscription",
  );
  const deleteSubscription = useActionMutation(
    "delete-dashboard-report-subscription",
    { method: "DELETE" },
  );
  const sendNow = useActionMutation("send-dashboard-report-now");

  const subscriptions = useMemo(
    () => (Array.isArray(data) ? data : []),
    [data],
  );
  const selectedSubscription = subscriptions.find(
    (sub) => sub.id === selectedId,
  );
  const currentFilterSnapshot = useMemo(
    () => normalizeReportFilterSnapshot(filters),
    [filters],
  );
  const currentFilterSnapshotKey = useMemo(
    () => reportFilterSnapshotKey(currentFilterSnapshot),
    [currentFilterSnapshot],
  );
  const reportFilterKey = useMemo(
    () => reportFilterSnapshotKey(reportFilters),
    [reportFilters],
  );
  const reportFilterCount = Object.keys(reportFilters).length;
  const reportFiltersMatchCurrent =
    reportFilterKey === currentFilterSnapshotKey;

  const loadSubscription = (sub: DashboardReportSubscription) => {
    setSelectedId(sub.id);
    setName(sub.name);
    setRecipientsText(sub.recipients.join("\n"));
    setReportFilters(savedReportFiltersForEdit(sub.filters));
    setTimeOfDay(sub.timeOfDay);
    setTimezone(sub.timezone);
    setEnabled(sub.enabled);
    setView("form");
  };

  const resetForm = () => {
    setSelectedId(undefined);
    setName(defaultName);
    setRecipientsText(defaultEmail);
    setReportFilters(currentFilterSnapshot);
    setTimeOfDay("09:00");
    setTimezone(localTimezone());
    setEnabled(true);
  };

  const startNewSubscription = () => {
    resetForm();
    setView("form");
  };

  const returnToList = () => {
    resetForm();
    setView("list");
  };

  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (initialized.current || isLoading) return;
    if (subscriptions[0]) {
      resetForm();
      setView("list");
    } else {
      resetForm();
      setView("form");
    }
    initialized.current = true;
  }, [open, isLoading, subscriptions, defaultEmail, defaultName]);

  const handleSave = async () => {
    const recipients = splitRecipients(recipientsText);
    if (recipients.length === 0) {
      toast.error(t("sqlDashboard.reportRecipientsRequired"));
      return;
    }
    try {
      const saved = await saveSubscription.mutateAsync({
        id: selectedId,
        dashboardId,
        name: name.trim() || defaultName,
        recipients,
        filters: reportFilters,
        timeOfDay,
        timezone,
        enabled,
      });
      loadSubscription(saved as DashboardReportSubscription);
      await refetch();
      toast.success(t("sqlDashboard.reportSubscriptionSaved"));
    } catch (err: any) {
      toast.error(
        t("sqlDashboard.reportSubscriptionSaveFailed", {
          message: err?.message ?? String(err),
        }),
      );
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    try {
      const hasRemainingSubscriptions = subscriptions.some(
        (sub) => sub.id !== selectedId,
      );
      await deleteSubscription.mutateAsync({ id: selectedId });
      resetForm();
      setView(hasRemainingSubscriptions ? "list" : "form");
      await refetch();
      toast.success(t("sqlDashboard.reportSubscriptionDeleted"));
    } catch (err: any) {
      toast.error(
        t("sqlDashboard.reportSubscriptionDeleteFailed", {
          message: err?.message ?? String(err),
        }),
      );
    }
  };

  const handleSendNow = async () => {
    if (!selectedId) return;
    try {
      await sendNow.mutateAsync({ id: selectedId });
      await refetch();
      toast.success(t("sqlDashboard.reportQueued"));
    } catch (err: any) {
      toast.error(
        t("sqlDashboard.reportSendFailed", {
          message: err?.message ?? String(err),
        }),
      );
    }
  };

  const isListView = subscriptions.length > 0 && view === "list";
  const isFormView = !isListView;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("sqlDashboard.emailReports")}</DialogTitle>
          <DialogDescription>
            {t("sqlDashboard.emailReportsDescription", {
              name: dashboardName,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {isListView ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>{t("sqlDashboard.existingReportSubscriptions")}</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startNewSubscription}
                >
                  <IconPlus className="mr-1.5 h-3.5 w-3.5" />
                  {t("sqlDashboard.newSubscription")}
                </Button>
              </div>
              <div className="space-y-2">
                {subscriptions.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => loadSubscription(sub)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {sub.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {sub.recipients.join(", ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(sub.nextRunAt, t("sqlDashboard.never"))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {isFormView ? (
            <>
              <div className="flex items-center justify-between gap-3">
                {subscriptions.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2 px-2"
                    onClick={returnToList}
                  >
                    <IconChevronLeft className="mr-1.5 h-3.5 w-3.5" />
                    {t("sqlDashboard.existingReportSubscriptions")}
                  </Button>
                ) : null}
                <p className="text-sm font-medium">
                  {selectedId
                    ? t("sqlDashboard.updateSubscription")
                    : t("sqlDashboard.newSubscription")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="dashboard-report-name">
                    {t("sqlDashboard.reportName")}
                  </Label>
                  <Input
                    id="dashboard-report-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="dashboard-report-recipients">
                    {t("sqlDashboard.reportRecipients")}
                  </Label>
                  <Textarea
                    id="dashboard-report-recipients"
                    value={recipientsText}
                    onChange={(event) => setRecipientsText(event.target.value)}
                    placeholder={t("sqlDashboard.reportRecipientsPlaceholder")}
                    className="min-h-[76px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dashboard-report-time">
                    {t("sqlDashboard.reportSendTime")}
                  </Label>
                  <Input
                    id="dashboard-report-time"
                    type="time"
                    value={timeOfDay}
                    onChange={(event) => setTimeOfDay(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dashboard-report-timezone">
                    {t("sqlDashboard.reportTimezone")}
                  </Label>
                  <Input
                    id="dashboard-report-timezone"
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 sm:col-span-2">
                  <div className="min-w-0">
                    <Label>{t("sqlDashboard.reportEnabled")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("sqlDashboard.reportFilterSnapshot", {
                        count: reportFilterCount,
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setReportFilters(currentFilterSnapshot)}
                      disabled={reportFiltersMatchCurrent}
                    >
                      <IconFilter className="mr-1.5 h-3.5 w-3.5" />
                      {t("sqlDashboard.reportUseCurrentFilters")}
                    </Button>
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                  </div>
                </div>

                {selectedSubscription ? (
                  <div className="grid gap-2 text-xs text-muted-foreground sm:col-span-2 sm:grid-cols-2">
                    <div>
                      {t("sqlDashboard.reportLastRun")}:{" "}
                      {formatDate(
                        selectedSubscription.lastRunAt,
                        t("sqlDashboard.never"),
                      )}
                    </div>
                    <div>
                      {t("sqlDashboard.reportNextRun")}:{" "}
                      {formatDate(
                        selectedSubscription.nextRunAt,
                        t("sqlDashboard.never"),
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {isFormView ? (
          <DialogFooter className="gap-2 sm:gap-0">
            {selectedId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={deleteSubscription.isPending}
              >
                <IconTrash className="mr-1.5 h-3.5 w-3.5" />
                {t("sidebar.delete")}
              </Button>
            ) : null}
            {selectedId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSendNow}
                disabled={sendNow.isPending}
              >
                <IconSend className="mr-1.5 h-3.5 w-3.5" />
                {sendNow.isPending
                  ? t("sqlDashboard.reportSending")
                  : t("sqlDashboard.reportSendNow")}
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saveSubscription.isPending}
            >
              {saveSubscription.isPending
                ? t("sqlDashboard.saving")
                : selectedId
                  ? t("sqlDashboard.updateSubscription")
                  : t("sqlDashboard.saveSubscription")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
