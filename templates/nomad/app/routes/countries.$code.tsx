import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconDownload,
  IconId,
  IconMailFast,
  IconMapPinPlus,
  IconMessageCircle,
  IconPlus,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { Gauge } from "@/components/nomad/Gauge";
import { StayDialog } from "@/components/nomad/StayDialog";
import { VisaDialog } from "@/components/nomad/VisaDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  downloadPresenceCsv,
  formatShortDate,
  formatStayRange,
  severityBg,
  severityBorder,
  severityColor,
  statusLabelKey,
  stayLengthDays,
} from "@/lib/nomad";
import { useComplianceSnapshot } from "@/lib/use-compliance-snapshot";
import { cn } from "@/lib/utils";

import { visaAppliesToCountry } from "../../shared/compliance";
import { countryFlag, countryName, isSchengen } from "../../shared/countries";
import type { RuleComputation, Stay, Visa } from "../../shared/types";

export function meta({ params }: { params: { code?: string } }) {
  const name = params.code ? countryName(params.code) : "Country";
  return [{ title: `Nomad — ${name}` }];
}

export default function CountryRoute() {
  const t = useT();
  const { locale } = useLocale();
  const params = useParams();
  const code = (params.code ?? "").toUpperCase();
  const { data: snap, isDemo } = useComplianceSnapshot();
  const { data: stays } = useActionQuery("list-stays", { countryCode: code });
  const updateProfile = useActionMutation("update-profile");
  const [dialogStay, setDialogStay] = useState<Stay | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogVisa, setDialogVisa] = useState<Visa | null>(null);
  const [visaDialogOpen, setVisaDialogOpen] = useState(false);

  // In demo mode `list-stays` still returns real rows — derive the ledger
  // from the fabricated snapshot instead so this page never mixes real and
  // fabricated data.
  const ledger = useMemo(() => {
    if (isDemo) {
      return [...(snap?.trips ?? []), ...(snap?.pendingStays ?? [])]
        .filter((s) => s.countryCode === code)
        .sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
    }
    return (stays ?? []) as Stay[];
  }, [isDemo, snap, stays, code]);

  const country = snap?.countries.find((c) => c.countryCode === code);
  const applicableRules = useMemo(
    () =>
      (snap?.rules ?? []).filter((rc) =>
        country ? country.ruleIds.includes(rc.rule.id) : false,
      ),
    [snap, country],
  );
  const primaryRule: RuleComputation | undefined =
    applicableRules.find((rc) => rc.rule.id === country?.primaryRuleId) ??
    applicableRules[0];

  const applicableVisas = useMemo(
    () =>
      (snap?.visas ?? []).filter((vc) => visaAppliesToCountry(vc.visa, code)),
    [snap, code],
  );

  // The constraint that actually forces an exit here: a present max-rule's
  // mustExitBy (already visa-capped by the engine), plus the capping visa.
  const exitBound = Boolean(primaryRule?.present && primaryRule.mustExitBy);
  const bindingVisa = primaryRule?.cappedByVisaId
    ? (snap?.visas.find((vc) => vc.visa.id === primaryRule.cappedByVisaId) ??
      null)
    : null;
  const recTint =
    primaryRule && primaryRule.severity !== "safe"
      ? primaryRule.severity
      : ("info" as const);

  const safeDestinations = useMemo(() => {
    if (!snap || !primaryRule) return [];
    // When the binding constraint is zone-wide (a Schengen rule or a Schengen
    // visa), suggesting another member state changes nothing — exclude the
    // whole zone from escape suggestions.
    const constraintActive = primaryRule.severity !== "safe" || exitBound;
    const excludedZone = constraintActive
      ? (primaryRule.rule.zone ?? bindingVisa?.visa.zone ?? null)
      : null;
    return snap.countries
      .filter(
        (c) =>
          c.countryCode !== code &&
          c.severity === "safe" &&
          c.limitDays > 0 &&
          !(excludedZone === "schengen" && isSchengen(c.countryCode)),
      )
      .sort((a, b) => a.usedDays / a.limitDays - b.usedDays / b.limitDays)
      .slice(0, 3);
  }, [snap, code, primaryRule, exitBound, bindingVisa]);

  if (!snap) {
    return (
      <div className="mx-auto flex max-w-[980px] flex-col gap-4 p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  const flag = countryFlag(code);
  const name = countryName(code, locale);
  const here = country?.here ?? false;
  const tracked = snap.profile.trackedCountries.includes(code);
  const sortedExits = ledger
    .filter((s) => s.exitDate && s.status === "confirmed")
    .map((s) => s.exitDate as string)
    .sort();
  const lastExit = sortedExits[sortedExits.length - 1];

  const statusLine = here
    ? t("nomad.country.currentlyHere", {
        day: snap.currentLocation?.dayNumber ?? 1,
      })
    : lastExit
      ? t("nomad.country.currentlyOutside", { date: formatShortDate(lastExit) })
      : t("nomad.country.noVisits");

  return (
    <div className="min-h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] p-4 md:p-8">
        {/* Breadcrumb */}
        <div className="mb-5 flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            {t("nomad.country.breadcrumbMap")}
          </Link>
          <span>/</span>
          <span className="text-foreground">{name}</span>
          {country && (
            <span
              className="nomad-chip ml-3 inline-flex items-center gap-1.5 px-2.5 py-1"
              style={{ color: severityColor(country.severity) }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: severityColor(country.severity) }}
              />
              {t(statusLabelKey(country.statusKey))}
            </span>
          )}
        </div>

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start gap-4">
          <div className="text-5xl">{flag}</div>
          <div>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">
              {name}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{statusLine}</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isDemo}
              title={isDemo ? t("nomad.demo.disabledHint") : undefined}
              onClick={() => {
                setDialogStay(null);
                setDialogOpen(true);
              }}
            >
              <IconPlus className="size-4" />
              {t("nomad.cockpit.addTrip")}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                downloadPresenceCsv(
                  ledger,
                  isDemo
                    ? `nomad-demo-presence-log-${code}.csv`
                    : `presence-log-${code}.csv`,
                )
              }
            >
              <IconDownload className="size-4" />
              {t("nomad.country.export")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          {/* Primary rule gauge */}
          {primaryRule && (
            <div className="nomad-panel flex flex-col items-center justify-center gap-3 p-6 md:col-span-4">
              <>
                <div className="text-xs text-muted-foreground">
                  {primaryRule.rule.name}
                </div>
                <Gauge
                  pct={primaryRule.pct}
                  severity={primaryRule.severity}
                  centerTop={String(primaryRule.usedDays)}
                  centerBottom={t("nomad.country.ofDays", {
                    limit: primaryRule.limitDays,
                  })}
                />
                <div className="text-center">
                  <div
                    className="text-sm font-semibold"
                    style={{ color: severityColor(primaryRule.severity) }}
                  >
                    {primaryRule.rule.kind === "presence-minimum"
                      ? t("nomad.country.daysStillNeeded", {
                          days: primaryRule.remainingDays,
                        })
                      : t("nomad.country.daysFromLimit", {
                          days: primaryRule.remainingDays,
                        })}
                  </div>
                  {primaryRule.mustExitBy && (
                    <div className="text-xs text-muted-foreground">
                      {t("nomad.country.mustExitBy", {
                        date: formatShortDate(primaryRule.mustExitBy),
                      })}
                    </div>
                  )}
                </div>
              </>
            </div>
          )}

          {/* Applicable rules */}
          <div
            className={cn(
              "flex flex-col gap-4",
              primaryRule ? "md:col-span-8" : "md:col-span-12",
            )}
          >
            {applicableRules.map((rc) => (
              <div
                key={rc.rule.id}
                className="nomad-panel flex items-center gap-4 p-4"
              >
                <div
                  className="h-12 w-1.5 shrink-0 rounded-full"
                  style={{ background: severityColor(rc.severity) }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{rc.rule.name}</div>
                  {rc.rule.description && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {rc.rule.description}
                    </div>
                  )}
                </div>
                <div className="ml-auto shrink-0 text-right">
                  <div className="text-lg font-semibold">
                    {rc.usedDays}/{rc.limitDays}
                  </div>
                  <div
                    className="text-[11px]"
                    style={{ color: severityColor(rc.severity) }}
                  >
                    {t(statusLabelKey(rc.statusKey))}
                  </div>
                </div>
                <div className="nomad-track hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full sm:block">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${rc.pct}%`,
                      background: severityColor(rc.severity),
                    }}
                  />
                </div>
              </div>
            ))}
            {applicableRules.length === 0 && (
              <div className="nomad-panel flex flex-col items-start gap-3 p-6">
                <div className="text-sm text-muted-foreground">
                  {t("nomad.country.noRules")}
                </div>
                {!tracked && (
                  <Button
                    size="sm"
                    disabled={isDemo || updateProfile.isPending}
                    title={isDemo ? t("nomad.demo.disabledHint") : undefined}
                    onClick={() =>
                      updateProfile.mutate({
                        trackedCountries: [
                          ...snap.profile.trackedCountries,
                          code,
                        ],
                      })
                    }
                  >
                    <IconMapPinPlus className="size-4" />
                    {t("nomad.country.track", { name })}
                  </Button>
                )}
              </div>
            )}

            {/* Visas & permits with hard expiry windows */}
            {applicableVisas.map((vc) => (
              <button
                key={vc.visa.id}
                type="button"
                disabled={isDemo}
                title={isDemo ? t("nomad.demo.disabledHint") : undefined}
                onClick={() => {
                  setDialogVisa(vc.visa);
                  setVisaDialogOpen(true);
                }}
                className="nomad-panel flex cursor-pointer items-center gap-4 p-4 text-left transition-colors hover:border-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <IconId
                  className="size-6 shrink-0"
                  style={{ color: severityColor(vc.severity) }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{vc.visa.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {vc.daysUntilExpiry < 0
                      ? t("nomad.visa.expiredChip", {
                          date: formatShortDate(vc.visa.expiresOn),
                        })
                      : t("nomad.visa.validChip", {
                          date: formatShortDate(vc.visa.expiresOn),
                          days: vc.daysUntilExpiry,
                        })}
                  </div>
                </div>
                <span
                  className="nomad-chip ml-auto shrink-0 px-2 py-0.5 text-xs"
                  style={{ color: severityColor(vc.severity) }}
                >
                  {formatShortDate(vc.visa.expiresOn)}
                </span>
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={isDemo}
              title={isDemo ? t("nomad.demo.disabledHint") : undefined}
              onClick={() => {
                setDialogVisa(null);
                setVisaDialogOpen(true);
              }}
            >
              <IconId className="size-4" />
              {t("nomad.quick.addVisa")}
            </Button>
          </div>

          {/* Presence ledger */}
          <div className="nomad-panel p-5 md:col-span-7">
            <div className="mb-1 text-sm font-semibold">
              {t("nomad.country.ledgerTitle")}
            </div>
            <div className="mb-4 text-xs text-muted-foreground">
              {t("nomad.country.ledgerHint")}
            </div>
            <div className="space-y-3">
              {ledger.map((stay) => (
                <button
                  key={stay.id}
                  type="button"
                  disabled={isDemo}
                  title={isDemo ? t("nomad.demo.disabledHint") : undefined}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-md text-left text-sm hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => {
                    setDialogStay(stay);
                    setDialogOpen(true);
                  }}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background:
                        stay.status === "pending"
                          ? "hsl(var(--muted-foreground))"
                          : severityColor(country?.severity ?? "safe"),
                    }}
                  />
                  <span>
                    {formatStayRange(stay)}
                    {stay.city ? ` · ${stay.city}` : ""}
                  </span>
                  <span className="ml-auto font-medium">
                    {t("nomad.cockpit.days", {
                      count: stayLengthDays(stay, snap.today),
                    })}
                  </span>
                  {stay.source === "inbox" && (
                    <span className="nomad-chip inline-flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground">
                      <IconMailFast className="size-3" />
                      {t("nomad.country.inboxTag")}
                    </span>
                  )}
                </button>
              ))}
              {ledger.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  {t("nomad.country.noVisits")}
                </div>
              )}
            </div>
          </div>

          {/* Recommendation */}
          <div className="nomad-panel flex flex-col p-5 md:col-span-5">
            <div className="mb-2 text-sm font-semibold">
              {t("nomad.country.recommendationTitle")}
            </div>
            {primaryRule && (primaryRule.severity !== "safe" || exitBound) ? (
              // A binding exit date (rule limit OR visa expiry) always wins
              // over "you're in the clear" — even at safe severity.
              <div
                className="mb-3 rounded-lg p-4"
                style={{
                  background: severityBg(recTint),
                  border: `1px solid ${severityBorder(recTint)}`,
                }}
              >
                <div
                  className="text-sm font-semibold"
                  style={{ color: severityColor(recTint) }}
                >
                  {bindingVisa && primaryRule.mustExitBy
                    ? t("nomad.country.recVisaExit", {
                        date: formatShortDate(primaryRule.mustExitBy),
                      })
                    : recommendationTitle(primaryRule, snap.today, t)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {bindingVisa && primaryRule.mustExitBy
                    ? t("nomad.country.recVisaExitBody", {
                        label: bindingVisa.visa.label,
                        date: formatShortDate(bindingVisa.visa.expiresOn),
                      })
                    : t("nomad.country.recBody", {
                        days: primaryRule.remainingDays,
                        rule: primaryRule.rule.name,
                      })}
                </div>
              </div>
            ) : (
              <div
                className="mb-3 rounded-lg p-4"
                style={{
                  background: severityBg("safe"),
                  border: `1px solid ${severityBorder("safe")}`,
                }}
              >
                <div
                  className="text-sm font-semibold"
                  style={{ color: severityColor("safe") }}
                >
                  {t("nomad.country.recSafeTitle")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("nomad.country.recSafeBody")}
                </div>
              </div>
            )}
            {safeDestinations.length > 0 && (
              <>
                <div className="text-xs text-muted-foreground">
                  {t("nomad.country.safeDestinations")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {safeDestinations.map((c) => (
                    <Link
                      key={c.countryCode}
                      to={`/countries/${c.countryCode}`}
                      className="nomad-chip px-2.5 py-1 text-xs hover:border-ring"
                    >
                      {countryFlag(c.countryCode)} {countryName(c.countryCode)}{" "}
                      · {c.usedDays}/{c.limitDays}
                    </Link>
                  ))}
                </div>
              </>
            )}
            <Button
              className="mt-4 md:mt-auto"
              variant="outline"
              onClick={() =>
                sendToAgentChat({
                  message: t("nomad.country.askAgentPrompt", {
                    rule: primaryRule?.rule.name ?? name,
                    country: name,
                  }),
                  submit: false,
                  openSidebar: true,
                })
              }
            >
              <IconMessageCircle className="size-4" />
              {t("nomad.country.askAgent")}
            </Button>
          </div>
        </div>
      </div>

      <StayDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        stay={dialogStay}
        defaultCountryCode={code}
      />
      <VisaDialog
        open={visaDialogOpen}
        onOpenChange={setVisaDialogOpen}
        visa={dialogVisa}
        defaultCountryCode={code}
      />
    </div>
  );
}

function recommendationTitle(
  rule: RuleComputation,
  today: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (rule.present && rule.mustExitBy) {
    return t("nomad.country.recExit", {
      date: formatShortDate(rule.mustExitBy),
    });
  }
  if (rule.remainingDays === 0) {
    return t("nomad.country.recAvoid", {
      date: rule.reEnterOn
        ? formatShortDate(rule.reEnterOn)
        : String(Number(today.slice(0, 4)) + 1),
    });
  }
  if (rule.rule.kind === "calendar-year") {
    return t("nomad.country.recAvoidYear", {
      days: rule.remainingDays,
      year: Number(today.slice(0, 4)) + 1,
    });
  }
  return t("nomad.country.recWatch", { days: rule.remainingDays });
}
