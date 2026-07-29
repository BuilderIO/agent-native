import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconArrowRight,
  IconId,
  IconMapPin,
  IconMapPinPlus,
  IconMessageCircle,
  IconPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatShortDate, severityColor, statusLabelKey } from "@/lib/nomad";

import { visaAppliesToCountry } from "../../../shared/compliance";
import { countryFlag, countryName } from "../../../shared/countries";
import type { ComplianceSnapshot } from "../../../shared/types";

/**
 * In-map quick actions for a clicked country: log presence, trips, and
 * visas without leaving the cockpit.
 */
export function CountryQuickActions({
  code,
  snapshot,
  onLogTrip,
  onAddVisa,
  onDetails,
  close,
  disabled,
}: {
  code: string;
  snapshot: ComplianceSnapshot;
  onLogTrip: (code: string) => void;
  onAddVisa: (code: string) => void;
  onDetails: (code: string) => void;
  close: () => void;
  /** Fabricated demo data — every mutating/agent action here is disabled. */
  disabled?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const upsertStay = useActionMutation("upsert-stay");
  const updateProfile = useActionMutation("update-profile");

  const country = snapshot.countries.find((c) => c.countryCode === code);
  const ruleById = new Map(snapshot.rules.map((rc) => [rc.rule.id, rc]));
  const countryRules = (country?.ruleIds ?? []).flatMap((id) => {
    const rc = ruleById.get(id);
    return rc ? [rc] : [];
  });
  const here = snapshot.currentLocation?.countryCode === code;
  const tracked = snapshot.profile.trackedCountries.includes(code);
  const visa = snapshot.visas.find((vc) => visaAppliesToCountry(vc.visa, code));

  /**
   * Fire the agent immediately with this country's live numbers attached as
   * hidden context — one tap from map to answer.
   */
  function askAgent() {
    const name = countryName(code, locale);
    const applicableRules = snapshot.rules.filter((rc) =>
      country ? country.ruleIds.includes(rc.rule.id) : false,
    );
    const p = snapshot.profile;
    const context = [
      `Country in focus: ${name} (${code})`,
      `Today: ${snapshot.today}`,
      ...(p.citizenshipCountry
        ? [
            `Passport / citizenship: ${countryName(p.citizenshipCountry, "en")} (${p.citizenshipCountry}) — reason about visa-free access and entry requirements from this`,
          ]
        : []),
      ...(p.fiscalHomeCountry
        ? [
            `Fiscal home: ${countryName(p.fiscalHomeCountry, "en")}${p.immigrationStatus ? ` (status: ${p.immigrationStatus})` : ""}`,
          ]
        : []),
      snapshot.currentLocation
        ? `Currently in ${snapshot.currentLocation.countryCode}, day ${snapshot.currentLocation.dayNumber}`
        : "No current open stay",
      ...applicableRules.map(
        (rc) =>
          `Rule ${rc.rule.name}: ${rc.usedDays}/${rc.limitDays} days used, status ${rc.statusKey}` +
          (rc.mustExitBy ? `, must exit by ${rc.mustExitBy}` : "") +
          (rc.reEnterOn ? `, re-entry possible ${rc.reEnterOn}` : ""),
      ),
      ...(visa
        ? [
            `Visa: ${visa.visa.label}${visa.visa.validFrom ? `, valid from ${visa.visa.validFrom}` : ""}, expires ${visa.visa.expiresOn} (${visa.daysUntilExpiry} days${visa.active ? "" : ", NOT yet valid"})`,
          ]
        : []),
      ...(tracked ? [] : ["Country is not tracked yet (no rules armed)"]),
    ].join("\n");

    sendToAgentChat({
      message: t("nomad.quick.askAgentPrompt", { country: name }),
      context,
      submit: true,
      openSidebar: true,
    });
    close();
  }

  async function moveHere() {
    try {
      // Close only the stay we're actually in — not future open-ended
      // bookings (e.g. an upcoming inbox-detected trip).
      const openStay = snapshot.trips.find(
        (s) => s.exitDate === null && s.entryDate <= snapshot.today,
      );
      if (openStay) {
        await upsertStay.mutateAsync({
          id: openStay.id,
          exitDate: snapshot.today,
        });
      }
      await upsertStay.mutateAsync({
        countryCode: code,
        entryDate: snapshot.today,
      });
      toast.success(
        t("nomad.quick.hereNowDone", { place: countryName(code, locale) }),
      );
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xl">{countryFlag(code)}</span>
        <span className="min-w-0 truncate font-semibold">
          {countryName(code, locale)}
        </span>
        {country && (
          <span
            className="nomad-chip ml-auto shrink-0 px-2 py-0.5 text-[11px]"
            style={{ color: severityColor(country.severity) }}
          >
            {t(statusLabelKey(country.statusKey))}
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {here && (
          <span className="block">
            {t("nomad.quick.hereAlready", {
              day: snapshot.currentLocation?.dayNumber ?? 1,
            })}
          </span>
        )}
        {countryRules.length > 0
          ? countryRules.slice(0, 4).map((rc) => (
              <span key={rc.rule.id} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: severityColor(rc.severity) }}
                />
                <span className="min-w-0 truncate">
                  {rc.usedDays}/{rc.limitDays} · {rc.rule.name}
                </span>
              </span>
            ))
          : !here && (
              <span className="block">{t("nomad.cockpit.untracked")}</span>
            )}
        {visa && (
          <span className="block">
            {t("nomad.visa.expiresChip", {
              label: visa.visa.label,
              date: formatShortDate(visa.visa.expiresOn),
            })}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-8 w-full justify-start gap-2 rounded-lg text-xs"
          disabled={disabled}
          title={disabled ? t("nomad.demo.disabledHint") : undefined}
          onClick={askAgent}
        >
          <IconMessageCircle className="size-4" />
          {t("nomad.quick.askAgent", { name: countryName(code, locale) })}
        </Button>
        {!here && (
          <QuickButton
            icon={<IconMapPin className="size-4" />}
            label={t("nomad.quick.hereNow")}
            disabled={disabled || upsertStay.isPending}
            title={disabled ? t("nomad.demo.disabledHint") : undefined}
            onClick={() => void moveHere()}
          />
        )}
        <QuickButton
          icon={<IconPlus className="size-4" />}
          label={t("nomad.quick.logTrip")}
          disabled={disabled}
          title={disabled ? t("nomad.demo.disabledHint") : undefined}
          onClick={() => {
            onLogTrip(code);
            close();
          }}
        />
        <QuickButton
          icon={<IconId className="size-4" />}
          label={t("nomad.quick.addVisa")}
          disabled={disabled}
          title={disabled ? t("nomad.demo.disabledHint") : undefined}
          onClick={() => {
            onAddVisa(code);
            close();
          }}
        />
        {!tracked && (
          <QuickButton
            icon={<IconMapPinPlus className="size-4" />}
            label={t("nomad.quick.track")}
            disabled={disabled || updateProfile.isPending}
            title={disabled ? t("nomad.demo.disabledHint") : undefined}
            onClick={() =>
              updateProfile.mutate(
                {
                  trackedCountries: [
                    ...snapshot.profile.trackedCountries,
                    code,
                  ],
                },
                { onSuccess: close },
              )
            }
          />
        )}
        <QuickButton
          icon={<IconArrowRight className="size-4" />}
          label={t("nomad.quick.details")}
          onClick={() => {
            onDetails(code);
            close();
          }}
        />
      </div>
    </div>
  );
}

function QuickButton({
  icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:border-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </button>
  );
}
