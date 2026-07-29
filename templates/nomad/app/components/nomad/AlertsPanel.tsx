import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconMailFast,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  formatShortDate,
  severityBg,
  severityBorder,
  severityColor,
} from "@/lib/nomad";

import { countryFlag, countryName } from "../../../shared/countries";
import type { ComplianceAlert } from "../../../shared/types";

export function alertTitle(
  alert: ComplianceAlert,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (alert.kind === "pending-stay") {
    return t("nomad.alerts.pendingTitle");
  }
  if (alert.kind === "visa-expiry") {
    return String(alert.data.label ?? "");
  }
  return String(alert.data.ruleName ?? "");
}

export function alertBody(
  alert: ComplianceAlert,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const d = alert.data;
  if (alert.kind === "visa-expiry") {
    return Number(d.daysUntilExpiry) < 0
      ? t("nomad.alerts.visaExpiredBody", {
          date: formatShortDate(String(d.expiresOn)),
        })
      : t("nomad.alerts.visaBody", {
          date: formatShortDate(String(d.expiresOn)),
          days: d.daysUntilExpiry,
        });
  }
  if (alert.kind === "pending-stay") {
    const place = d.city
      ? `${d.city}, ${countryName(String(d.countryCode))}`
      : countryName(String(d.countryCode));
    return t("nomad.alerts.pendingBody", {
      place,
      date: formatShortDate(String(d.entryDate)),
    });
  }
  if (d.minimum) {
    return t("nomad.alerts.minBody", {
      used: d.usedDays,
      limit: d.limitDays,
      needed: d.remainingDays,
    });
  }
  if (d.reEnterOn) {
    return t("nomad.alerts.overBody", {
      used: d.usedDays,
      limit: d.limitDays,
      date: formatShortDate(String(d.reEnterOn)),
    });
  }
  if (d.mustExitBy) {
    return t("nomad.alerts.exitBody", {
      days: d.daysUntilExit,
      date: formatShortDate(String(d.mustExitBy)),
    });
  }
  return t("nomad.alerts.nearLimitBody", {
    used: d.usedDays,
    limit: d.limitDays,
    remaining: d.remainingDays,
  });
}

/**
 * Right-rail alert stack: rule warnings ranked by severity, then pending
 * inbox-detected trips with one-tap confirm/discard.
 */
export function AlertsPanel({
  alerts,
  disabled,
}: {
  alerts: ComplianceAlert[];
  /** Fabricated demo alerts don't back a real stay — confirm/discard is disabled. */
  disabled?: boolean;
}) {
  const t = useT();
  const confirmStay = useActionMutation("upsert-stay");
  const discardStay = useActionMutation("delete-stay");

  return (
    <div className="nomad-panel p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {t("nomad.cockpit.alertsTitle")}
        <span className="nomad-chip px-2 py-0.5 text-[11px]">
          {alerts.length}
        </span>
      </div>
      {alerts.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconCircleCheck
            className="size-4"
            style={{ color: "hsl(var(--safe))" }}
          />
          {t("nomad.cockpit.noAlerts")}
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex gap-2.5 rounded-lg p-3 text-sm"
              style={{
                background: severityBg(alert.severity),
                border: `1px solid ${severityBorder(alert.severity)}`,
              }}
            >
              <span className="mt-0.5 shrink-0">
                {alert.kind === "pending-stay" ? (
                  <IconMailFast
                    className="size-4"
                    style={{ color: "hsl(var(--info))" }}
                  />
                ) : (
                  <IconAlertTriangle
                    className="size-4"
                    style={{ color: severityColor(alert.severity) }}
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {alert.countryCode
                    ? `${countryFlag(alert.countryCode)} `
                    : ""}
                  {alertTitle(alert, t)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {alertBody(alert, t)}
                </div>
                {alert.kind === "pending-stay" && alert.stayId && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={disabled || confirmStay.isPending}
                      title={
                        disabled ? t("nomad.demo.disabledHint") : undefined
                      }
                      onClick={() =>
                        alert.stayId &&
                        confirmStay.mutate({
                          id: alert.stayId,
                          status: "confirmed",
                        })
                      }
                    >
                      {t("nomad.cockpit.confirm")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2.5 text-xs text-muted-foreground"
                      disabled={disabled || discardStay.isPending}
                      title={
                        disabled ? t("nomad.demo.disabledHint") : undefined
                      }
                      onClick={() =>
                        alert.stayId && discardStay.mutate({ id: alert.stayId })
                      }
                    >
                      {t("nomad.cockpit.discard")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
