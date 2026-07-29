import { useT } from "@agent-native/core/client/i18n";
import { IconDownload } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { severityColor, statusLabelKey } from "@/lib/nomad";

import type { RuleComputation } from "../../../shared/types";

/**
 * "Your rule thresholds" cards: one progress card per compliance rule, with
 * a traffic-light status chip and used/limit footer.
 */
export function RuleCards({
  rules,
  onExport,
}: {
  rules: RuleComputation[];
  onExport?: () => void;
}) {
  const t = useT();

  return (
    <div className="nomad-panel p-4">
      <div className="mb-3 text-sm font-semibold">
        {t("nomad.cockpit.rulesTitle")}
      </div>
      <div className="space-y-3">
        {rules.map((rc) => {
          const color = severityColor(rc.severity);
          return (
            <div
              key={rc.rule.id}
              className="rounded-xl border border-border bg-popover p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-medium">
                  {rc.rule.name}
                </div>
                <div
                  className="nomad-chip shrink-0 px-2 py-0.5 text-xs"
                  style={{ color }}
                >
                  {t(statusLabelKey(rc.statusKey))}
                </div>
              </div>
              {rc.rule.description && (
                <div className="mb-2 mt-0.5 text-xs text-muted-foreground">
                  {rc.rule.description}
                </div>
              )}
              <div className="nomad-track h-2 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${rc.pct}%`, background: color }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{t("nomad.cockpit.used", { days: rc.usedDays })}</span>
                <span>{t("nomad.cockpit.limit", { days: rc.limitDays })}</span>
              </div>
            </div>
          );
        })}
      </div>
      {onExport && (
        <Button
          variant="outline"
          className="mt-3 w-full rounded-lg text-xs font-medium"
          onClick={onExport}
        >
          <IconDownload className="size-3.5" />
          {t("nomad.cockpit.export")}
        </Button>
      )}
    </div>
  );
}
