import { useT } from "@agent-native/core/client/i18n";

import { formatShortDate, severityColor } from "@/lib/nomad";

import type { RuleComputation } from "../../../shared/types";

/**
 * The hero countdown overlaid on the map: days remaining under the tightest
 * rule at the current location, with a progress bar and hard exit date.
 */
export function CountdownCard({
  rule,
  capLabel,
}: {
  rule: RuleComputation;
  /** Visa label when a document expiry (not day counts) forces the exit. */
  capLabel?: string | null;
}) {
  const t = useT();
  const color = severityColor(rule.severity);
  const daysLeft = rule.daysUntilExit ?? rule.remainingDays;

  return (
    <div className="nomad-panel absolute bottom-4 left-4 z-10 w-[260px] px-4 py-3">
      <div className="text-xs text-muted-foreground">
        {t("nomad.cockpit.countdownContext", { rule: rule.rule.name })}
      </div>
      <div className="mt-1 flex items-end gap-2">
        <div className="text-4xl font-bold" style={{ color }}>
          {daysLeft}
        </div>
        <div className="pb-1 text-sm text-muted-foreground">
          {t("nomad.cockpit.daysRemaining")}
        </div>
      </div>
      <div className="nomad-track mt-2 h-2 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full"
          style={{
            width: `${rule.pct}%`,
            background:
              rule.severity === "safe"
                ? color
                : `linear-gradient(90deg, hsl(var(--warn)), hsl(var(--danger)))`,
          }}
        />
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {rule.mustExitBy
          ? t("nomad.cockpit.usedOfLimitExit", {
              used: rule.usedDays,
              limit: rule.limitDays,
              date: formatShortDate(rule.mustExitBy),
            })
          : t("nomad.cockpit.usedOfLimitNoExit", {
              used: rule.usedDays,
              limit: rule.limitDays,
            })}
      </div>
      {capLabel && (
        <div className="mt-1 text-[11px]" style={{ color }}>
          {t("nomad.visa.cappedNote", { label: capLabel })}
        </div>
      )}
    </div>
  );
}
