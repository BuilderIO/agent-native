import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { IconMapPin, IconPlus, IconRadar2, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import {
  AlertsPanel,
  alertBody,
  alertTitle,
} from "@/components/nomad/AlertsPanel";
import { CountdownCard } from "@/components/nomad/CountdownCard";
import { CountryQuickActions } from "@/components/nomad/CountryQuickActions";
import { PassportChip } from "@/components/nomad/PassportChip";
import { RuleCards } from "@/components/nomad/RuleCards";
import { StayDialog } from "@/components/nomad/StayDialog";
import { TripTimeline } from "@/components/nomad/TripTimeline";
import { VisaDialog } from "@/components/nomad/VisaDialog";
import { WorldMap, type MapCountryStatus } from "@/components/nomad/WorldMap";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  downloadPresenceCsv,
  severityBg,
  severityBorder,
  severityColor,
} from "@/lib/nomad";

import { countryFlag, countryName } from "../../shared/countries";
import type { ComplianceSnapshot, Stay } from "../../shared/types";

const SEO_TITLE = "Nomad — Presence Cockpit";
const SEO_DESCRIPTION =
  "Residency and tax compliance cockpit for digital nomads: traffic-light presence map, Schengen 90/180 countdowns, tax-day counters, and inbox-scanned trips.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function CockpitRoute() {
  const t = useT();
  const navigate = useNavigate();
  const { data: snapshot } = useActionQuery("compliance-status", {});
  const scan = useActionMutation("scan-inbox");
  const [dismissedAlertId, setDismissedAlertId] = useState<string | null>(null);
  const [dialogStay, setDialogStay] = useState<Stay | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCountry, setDialogCountry] = useState<string | undefined>();
  const [visaDialogOpen, setVisaDialogOpen] = useState(false);
  const [visaCountry, setVisaCountry] = useState<string | undefined>();

  const snap = snapshot as ComplianceSnapshot | undefined;

  const mapStatuses = useMemo<MapCountryStatus[]>(() => {
    if (!snap) return [];
    const ruleById = new Map(snap.rules.map((rc) => [rc.rule.id, rc]));
    return snap.countries.map((c) => ({
      code: c.countryCode,
      severity: c.severity,
      here: c.here,
      usedDays: c.usedDays,
      limitDays: c.limitDays,
      ruleName: c.primaryRuleId
        ? (ruleById.get(c.primaryRuleId)?.rule.name ?? null)
        : null,
      // ruleIds arrive actionability-ranked (primary first) from the engine.
      rules: c.ruleIds.flatMap((id) => {
        const rc = ruleById.get(id);
        return rc
          ? [
              {
                name: rc.rule.name,
                usedDays: rc.usedDays,
                limitDays: rc.limitDays,
                severity: rc.severity,
              },
            ]
          : [];
      }),
    }));
  }, [snap]);

  // Hero countdown: the tightest max-rule at the current location.
  const countdownRule = useMemo(() => {
    if (!snap) return null;
    const present = snap.rules.filter(
      (rc) => rc.present && rc.rule.kind !== "presence-minimum",
    );
    if (present.length === 0) return null;
    const withExit = present.filter((rc) => rc.daysUntilExit !== null);
    if (withExit.length > 0) {
      return withExit.reduce((a, b) =>
        (a.daysUntilExit ?? Infinity) <= (b.daysUntilExit ?? Infinity) ? a : b,
      );
    }
    return present.reduce((a, b) => (a.pct >= b.pct ? a : b));
  }, [snap]);

  const bannerAlert = useMemo(() => {
    if (!snap) return null;
    return (
      snap.alerts.find(
        (a) =>
          a.id !== dismissedAlertId &&
          (a.severity === "danger" || a.severity === "warn"),
      ) ?? null
    );
  }, [snap, dismissedAlertId]);

  if (!snap) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <Skeleton className="h-14 w-full" />
        <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-12">
          <Skeleton className="lg:col-span-8" />
          <Skeleton className="lg:col-span-4" />
        </div>
      </div>
    );
  }

  if (!snap.profile.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  const lastScan = snap.profile.lastScanAt
    ? relativeDays(snap.profile.lastScanAt, t)
    : t("nomad.cockpit.scanNever");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top status bar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 md:px-6 md:py-4">
        <div className="mr-1">
          <div className="text-xs text-muted-foreground">
            {t("nomad.cockpit.title")}
          </div>
          <div className="text-lg font-semibold leading-tight">
            {t("nomad.cockpit.subtitle")}
          </div>
        </div>
        {snap.profile.fiscalHomeCountry && (
          <div className="nomad-chip hidden items-center gap-2 px-3 py-1.5 text-xs sm:flex">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "hsl(var(--primary))" }}
            />
            {t("nomad.cockpit.fiscalHome")}
            <b className="text-foreground">
              {countryFlag(snap.profile.fiscalHomeCountry)}{" "}
              {countryName(snap.profile.fiscalHomeCountry)}
              {snap.profile.immigrationStatus === "pr"
                ? ` · ${t("nomad.cockpit.prBadge")}`
                : ""}
            </b>
          </div>
        )}
        <PassportChip citizenshipCountry={snap.profile.citizenshipCountry} />
        {snap.currentLocation && (
          <div className="nomad-chip hidden items-center gap-1.5 px-3 py-1.5 text-xs md:flex">
            <IconMapPin className="size-3.5 text-muted-foreground" />
            {t("nomad.cockpit.nowIn")}
            <b className="text-foreground">
              {snap.currentLocation.city
                ? `${snap.currentLocation.city}, ${snap.currentLocation.countryCode}`
                : countryName(snap.currentLocation.countryCode)}
            </b>
            · {t("nomad.cockpit.dayN", { day: snap.currentLocation.dayNumber })}
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          {snap.profile.mailScanEnabled && (
            <div
              className="nomad-chip hidden items-center gap-2 px-3 py-1.5 text-xs lg:flex"
              title={t("nomad.cockpit.lastScan", { time: lastScan })}
            >
              <span
                className="nomad-pulse inline-block h-2 w-2 rounded-full"
                style={{ background: "hsl(var(--safe))" }}
              />
              {t("nomad.cockpit.inboxScan")} · {lastScan}
            </div>
          )}
          <Button
            size="sm"
            className="rounded-lg text-xs font-medium"
            disabled={scan.isPending}
            onClick={() => scan.mutate({})}
          >
            <IconRadar2 className="size-3.5" />
            {scan.isPending
              ? t("nomad.cockpit.scanning")
              : t("nomad.cockpit.scanNow")}
          </Button>
        </div>
      </header>

      {/* Alert banner */}
      {bannerAlert && (
        <div
          className="mx-4 mt-4 flex items-center gap-3 rounded-xl px-4 py-3 text-sm md:mx-6"
          style={{
            background: severityBg(bannerAlert.severity),
            border: `1px solid ${severityBorder(bannerAlert.severity)}`,
          }}
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: severityColor(bannerAlert.severity) }}
          />
          <span className="min-w-0">
            <b>{alertTitle(bannerAlert, t)}</b> — {alertBody(bannerAlert, t)}
          </span>
          <button
            type="button"
            onClick={() => setDismissedAlertId(bannerAlert.id)}
            className="ml-auto cursor-pointer text-muted-foreground hover:text-foreground"
            aria-label={t("nomad.cockpit.dismiss")}
          >
            <IconX className="size-4" />
          </button>
        </div>
      )}

      {/* Body grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-4 md:p-6 lg:grid-cols-12 lg:overflow-hidden">
        <section className="flex min-h-[480px] flex-col gap-5 lg:col-span-8 lg:min-h-0">
          <WorldMap
            statuses={mapStatuses}
            onSelect={(code) => navigate(`/countries/${code}`)}
            quickActions={(code, close) => (
              <CountryQuickActions
                code={code}
                snapshot={snap}
                close={close}
                onLogTrip={(c) => {
                  setDialogStay(null);
                  setDialogCountry(c);
                  setDialogOpen(true);
                }}
                onAddVisa={(c) => {
                  setVisaCountry(c);
                  setVisaDialogOpen(true);
                }}
                onDetails={(c) => navigate(`/countries/${c}`)}
              />
            )}
            overlay={
              countdownRule ? (
                <CountdownCard
                  rule={countdownRule}
                  capLabel={
                    countdownRule.cappedByVisaId
                      ? (snap.visas.find(
                          (vc) => vc.visa.id === countdownRule.cappedByVisaId,
                        )?.visa.label ?? null)
                      : null
                  }
                />
              ) : null
            }
          />
          <div className="relative">
            <TripTimeline
              snapshot={snap}
              onEdit={(stay) => {
                setDialogStay(stay);
                setDialogOpen(true);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="absolute right-3 top-3 hidden h-7 rounded-lg text-xs sm:inline-flex"
              onClick={() => {
                setDialogStay(null);
                setDialogOpen(true);
              }}
            >
              <IconPlus className="size-3.5" />
              {t("nomad.cockpit.addTrip")}
            </Button>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-4 lg:col-span-4 lg:overflow-y-auto lg:pr-1">
          <AlertsPanel alerts={snap.alerts} />
          <RuleCards
            rules={snap.rules}
            onExport={() =>
              downloadPresenceCsv(
                [...snap.trips, ...snap.pendingStays],
                "presence-log.csv",
              )
            }
          />
        </aside>
      </div>

      <StayDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setDialogCountry(undefined);
        }}
        stay={dialogStay}
        defaultCountryCode={dialogCountry}
      />
      <VisaDialog
        open={visaDialogOpen}
        onOpenChange={setVisaDialogOpen}
        visa={null}
        defaultCountryCode={visaCountry}
      />
    </div>
  );
}

function relativeDays(
  iso: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000),
  );
  if (days === 0) return t("nomad.cockpit.today");
  return t("nomad.cockpit.daysAgo", { count: days });
}
