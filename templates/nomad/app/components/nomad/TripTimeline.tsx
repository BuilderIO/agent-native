import { useT } from "@agent-native/core/client";
import { useDemoModeStatus } from "@agent-native/core/client/hooks";
import { IconMailFast } from "@tabler/icons-react";

import { formatStayRange, severityColor, stayLengthDays } from "@/lib/nomad";

import { countryFlag, countryName } from "../../../shared/countries";
import type { ComplianceSnapshot, Stay } from "../../../shared/types";

function stayPlace(stay: Stay, demo: boolean): string {
  const name = countryName(stay.countryCode);
  // Demo mode: keep the country (the structure) but drop the identifying city.
  return stay.city && !demo ? `${stay.city}, ${stay.countryCode}` : name;
}

/**
 * Horizontal strip of recent + upcoming stays. Confirmed trips are colored by
 * their country's traffic-light status; pending inbox-detected trips render
 * dashed with confirm/discard handled in the alerts rail.
 */
export function TripTimeline({
  snapshot,
  onEdit,
}: {
  snapshot: ComplianceSnapshot;
  onEdit: (stay: Stay) => void;
}) {
  const t = useT();
  const { enabled: demoMode } = useDemoModeStatus();
  const severityByCountry = new Map(
    snapshot.countries.map((c) => [c.countryCode, c.severity]),
  );
  // Show the most recent trips plus anything pending, oldest → newest.
  const recent = [...snapshot.trips.slice(0, 6)].reverse();
  const pending = snapshot.pendingStays;

  return (
    <div className="nomad-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          {t("nomad.cockpit.timelineTitle")}
        </div>
        <div className="text-xs text-muted-foreground sm:pr-24">
          {t("nomad.cockpit.timelineHint")}
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {recent.map((trip) => (
          <button
            key={trip.id}
            type="button"
            onClick={() => onEdit(trip)}
            className="w-[150px] shrink-0 cursor-pointer rounded-xl border border-border bg-popover p-3 text-left transition-colors hover:border-ring"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: severityColor(
                    severityByCountry.get(trip.countryCode) ?? "safe",
                  ),
                }}
              />
              <span className="truncate">{formatStayRange(trip)}</span>
            </div>
            <div className="mt-1 truncate font-semibold">
              {countryFlag(trip.countryCode)} {stayPlace(trip, demoMode)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t("nomad.cockpit.days", {
                count: stayLengthDays(trip, snapshot.today),
              })}
            </div>
            {trip.source === "inbox" && (
              <div className="nomad-chip mt-2 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] text-muted-foreground">
                <IconMailFast className="size-3" />
                {t("nomad.cockpit.fromInbox")}
              </div>
            )}
          </button>
        ))}
        {pending.map((trip) => (
          <button
            key={trip.id}
            type="button"
            onClick={() => onEdit(trip)}
            className="w-[150px] shrink-0 cursor-pointer rounded-xl border border-dashed border-ring/50 bg-popover/50 p-3 text-left transition-colors hover:border-ring"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-muted-foreground" />
              <span className="truncate">{formatStayRange(trip)}</span>
            </div>
            <div className="mt-1 truncate font-semibold">
              {countryFlag(trip.countryCode)} {stayPlace(trip, demoMode)}
            </div>
            <div className="nomad-chip mt-2 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] text-muted-foreground">
              <IconMailFast className="size-3" />
              {t("nomad.cockpit.pendingConfirmation")}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
