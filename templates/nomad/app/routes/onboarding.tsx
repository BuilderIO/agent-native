import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconCheck,
  IconEPassport,
  IconId,
  IconMailFast,
  IconMapPin,
  IconNotebook,
  IconPlaneDeparture,
  IconReceipt2,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { CountryPicker } from "@/components/nomad/CountryPicker";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  countryFlag,
  countryName,
  presetsForCountry,
} from "../../shared/countries";
import type { ComplianceSnapshot, ImmigrationStatus } from "../../shared/types";

export function meta() {
  return [{ title: "Nomad — Welcome" }];
}

const TOTAL_STEPS = 6;
const GOALS = ["schengen", "tax", "pr", "log"] as const;

/**
 * Onboarding built on the Wispr Flow playbook: open by building a mental
 * model ("what brings you here?"), make every step impossible to fail (all
 * countries searchable, everything skippable, Continue never blocked), pace
 * psychologically ("almost done… one last thing"), and end with a real,
 * low-stakes win — the presence counter starts running on their actual
 * location before they ever reach the cockpit.
 */
export default function OnboardingRoute() {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const updateProfile = useActionMutation("update-profile");
  const upsertStay = useActionMutation("upsert-stay");
  const { data: snapshot } = useActionQuery("compliance-status", {});
  const snap = snapshot as ComplianceSnapshot | undefined;
  const existingLocation = snap?.currentLocation ?? null;

  const [step, setStep] = useState(1);
  const [goals, setGoals] = useState<string[]>([]);
  const [fiscal, setFiscal] = useState<string | null>(null);
  const [status, setStatus] = useState<ImmigrationStatus | "none" | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [locationCode, setLocationCode] = useState<string | null>(null);
  const [mail, setMail] = useState(true);
  const [finishing, setFinishing] = useState(false);

  // Re-running onboarding edits the existing profile instead of resetting it.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!snap || hydrated.current) return;
    hydrated.current = true;
    const p = snap.profile;
    if (p.goals.length > 0) setGoals(p.goals);
    if (p.fiscalHomeCountry) setFiscal(p.fiscalHomeCountry);
    if (p.immigrationStatus) setStatus(p.immigrationStatus);
    if (p.trackedCountries.length > 0) setPicked(p.trackedCountries);
    setMail(p.onboardingCompleted ? p.mailScanEnabled : true);
  }, [snap]);

  const location = locationCode ?? existingLocation?.countryCode ?? null;

  const armedRules = useMemo(() => {
    const names = new Map<string, string>();
    const codes = [...picked, ...(fiscal ? [fiscal] : [])];
    for (const code of codes) {
      for (const preset of presetsForCountry(code)) {
        if (preset.fiscalHomeOnly && fiscal !== code) continue;
        if (preset.prOnly && (fiscal !== code || status !== "pr")) continue;
        names.set(preset.slug, preset.name);
      }
    }
    return [...names.values()];
  }, [picked, fiscal, status]);

  const stepHasInput =
    (step === 1 && goals.length > 0) ||
    (step === 2 && fiscal !== null) ||
    (step === 3 && status !== null) ||
    (step === 4 && picked.length > 0) ||
    (step === 5 && location !== null) ||
    step === 6;

  function toggleGoal(goal: string) {
    setGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal],
    );
  }

  function toggleDestination(code: string) {
    setPicked((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function finish() {
    setFinishing(true);
    try {
      await updateProfile.mutateAsync({
        fiscalHomeCountry: fiscal,
        immigrationStatus: status === "none" ? null : status,
        goals,
        trackedCountries: [
          ...new Set([
            ...(snap?.profile.trackedCountries ?? []),
            ...picked,
            ...(location ? [location] : []),
          ]),
        ],
        mailScanEnabled: mail,
        onboardingCompleted: true,
      });
      const needsStay =
        locationCode &&
        (!existingLocation || existingLocation.countryCode !== locationCode);
      if (needsStay) {
        await upsertStay.mutateAsync({
          countryCode: locationCode,
          entryDate: todayISODate(),
          source: "manual",
        });
      }
      toast.success(t("nomad.wizard.doneToast"));
      navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setFinishing(false);
    }
  }

  const goalMeta: Record<
    (typeof GOALS)[number],
    { icon: typeof IconId; name: string; note: string }
  > = {
    schengen: {
      icon: IconPlaneDeparture,
      name: t("nomad.wizard.goalSchengen"),
      note: t("nomad.wizard.goalSchengenNote"),
    },
    tax: {
      icon: IconReceipt2,
      name: t("nomad.wizard.goalTax"),
      note: t("nomad.wizard.goalTaxNote"),
    },
    pr: {
      icon: IconId,
      name: t("nomad.wizard.goalPr"),
      note: t("nomad.wizard.goalPrNote"),
    },
    log: {
      icon: IconNotebook,
      name: t("nomad.wizard.goalLog"),
      note: t("nomad.wizard.goalLogNote"),
    },
  };

  const statuses: Array<{
    id: ImmigrationStatus | "none";
    icon: typeof IconId;
    name: string;
    note: string;
  }> = [
    {
      id: "pr",
      icon: IconId,
      name: t("nomad.wizard.statusPr"),
      note: t("nomad.wizard.statusPrNote"),
    },
    {
      id: "citizen",
      icon: IconEPassport,
      name: t("nomad.wizard.statusCitizen"),
      note: t("nomad.wizard.statusCitizenNote"),
    },
    {
      id: "visa",
      icon: IconPlaneDeparture,
      name: t("nomad.wizard.statusVisa"),
      note: t("nomad.wizard.statusVisaNote"),
    },
    {
      id: "none",
      icon: IconSparkles,
      name: t("nomad.wizard.statusNone"),
      note: t("nomad.wizard.statusNoneNote"),
    },
  ];

  const paceLabel =
    step === 5
      ? t("nomad.wizard.paceAlmost")
      : step === 6
        ? t("nomad.wizard.paceLast")
        : t("nomad.wizard.stepOf", { step, total: TOTAL_STEPS });

  return (
    <div className="flex min-h-full items-center justify-center overflow-y-auto p-4 md:p-8">
      <div className="w-full max-w-[860px]">
        {/* Header + progress */}
        <div className="mb-6 flex items-center gap-3">
          <div
            className="grid h-10 w-10 place-items-center rounded-xl font-bold"
            style={{
              background: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            N
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("nomad.wizard.welcome")}
            </div>
            <div className="text-lg font-semibold leading-tight">
              {t("nomad.wizard.title")}
            </div>
          </div>
          <div className="nomad-chip ml-auto px-3 py-1.5 text-xs">
            {paceLabel}
          </div>
        </div>

        <div className="mb-6 flex gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className="nomad-track h-1.5 flex-1 overflow-hidden rounded-full"
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: i < step ? "100%" : "0%",
                  background: "hsl(var(--primary))",
                }}
              />
            </div>
          ))}
        </div>

        <div className="nomad-panel nomad-glow flex min-h-[440px] flex-col p-5 md:p-8">
          {/* Step 1: what brings you here (mental model) */}
          {step === 1 && (
            <StepShell
              title={t("nomad.wizard.goalsTitle")}
              subtitle={t("nomad.wizard.goalsSubtitle")}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {GOALS.map((goal) => {
                  const meta = goalMeta[goal];
                  const Icon = meta.icon;
                  const selected = goals.includes(goal);
                  return (
                    <OptionCard
                      key={goal}
                      selected={selected}
                      onClick={() => toggleGoal(goal)}
                    >
                      <Icon className="size-6 shrink-0 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-semibold">{meta.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {meta.note}
                        </div>
                      </div>
                      {selected && (
                        <IconCheck className="ml-auto size-4 shrink-0 text-primary" />
                      )}
                    </OptionCard>
                  );
                })}
              </div>
            </StepShell>
          )}

          {/* Step 2: fiscal home — any country on Earth */}
          {step === 2 && (
            <StepShell
              title={t("nomad.wizard.fiscalTitle")}
              subtitle={t("nomad.wizard.fiscalSubtitle")}
            >
              <CountryPicker
                selected={fiscal ? [fiscal] : []}
                onToggle={(code) =>
                  setFiscal((prev) => (prev === code ? null : code))
                }
                subtitleFor={(code) =>
                  presetsForCountry(code).find((p) => !p.zone)?.name ?? null
                }
              />
              {fiscal && (
                <WinNote
                  text={t("nomad.wizard.fiscalWin", {
                    name: countryName(fiscal, locale),
                  })}
                />
              )}
            </StepShell>
          )}

          {/* Step 3: immigration status */}
          {step === 3 && (
            <StepShell
              title={t("nomad.wizard.statusTitle")}
              subtitle={t("nomad.wizard.statusSubtitle")}
            >
              <div className="space-y-3">
                {statuses.map((s) => {
                  const selected = status === s.id;
                  const Icon = s.icon;
                  return (
                    <OptionCard
                      key={s.id}
                      selected={selected}
                      onClick={() => setStatus(s.id)}
                    >
                      <Icon className="size-6 shrink-0 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-semibold">{s.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.note}
                        </div>
                      </div>
                      {selected && (
                        <IconCheck className="ml-auto size-4 shrink-0 text-primary" />
                      )}
                    </OptionCard>
                  );
                })}
              </div>
            </StepShell>
          )}

          {/* Step 4: destinations — rules arm live as you pick */}
          {step === 4 && (
            <StepShell
              title={t("nomad.wizard.destinationsTitle")}
              subtitle={t("nomad.wizard.destinationsSubtitle")}
            >
              <CountryPicker
                multi
                selected={picked}
                onToggle={toggleDestination}
                subtitleFor={(code) =>
                  presetsForCountry(code)
                    .map((p) => p.name)
                    .join(" · ")
                }
              />
              {armedRules.length > 0 && (
                <div className="nomad-panel mt-4 p-4">
                  <div className="mb-2 text-xs text-muted-foreground">
                    {t("nomad.wizard.detectedRules")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {armedRules.map((name) => (
                      <span
                        key={name}
                        className="nomad-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-xs"
                      >
                        <IconCheck
                          className="size-3.5"
                          style={{ color: "hsl(var(--safe))" }}
                        />
                        {t("nomad.wizard.ruleArmed", { rule: name })}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </StepShell>
          )}

          {/* Step 5: where are you right now — the first real data point */}
          {step === 5 && (
            <StepShell
              title={t("nomad.wizard.locationTitle")}
              subtitle={t("nomad.wizard.locationSubtitle")}
            >
              {existingLocation && !locationCode ? (
                <div className="nomad-chip mb-3 inline-flex items-center gap-2 px-3 py-2 text-sm">
                  <IconMapPin className="size-4 text-muted-foreground" />
                  {t("nomad.wizard.locationAlready", {
                    day: existingLocation.dayNumber,
                    place: countryName(existingLocation.countryCode, locale),
                  })}
                </div>
              ) : null}
              <CountryPicker
                selected={location ? [location] : []}
                onToggle={(code) =>
                  setLocationCode((prev) => (prev === code ? null : code))
                }
              />
              {locationCode && (
                <WinNote
                  text={t("nomad.wizard.locationWin", {
                    place: countryName(locationCode, locale),
                  })}
                />
              )}
            </StepShell>
          )}

          {/* Step 6: optional inbox scan + summary */}
          {step === 6 && (
            <StepShell
              title={t("nomad.wizard.mailTitle")}
              subtitle={t("nomad.wizard.mailSubtitle")}
            >
              <OptionCard selected={mail} onClick={() => setMail(!mail)}>
                <IconMailFast className="size-8 shrink-0 text-muted-foreground" />
                <div>
                  <div className="font-semibold">
                    {t("nomad.wizard.mailOption")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("nomad.wizard.mailOptionNote")}
                  </div>
                </div>
                <span className="ml-auto">
                  <Switch checked={mail} onCheckedChange={setMail} />
                </span>
              </OptionCard>
              <div className="mt-3 text-xs text-muted-foreground">
                {t("nomad.wizard.mailOptional")}
              </div>
              <div className="nomad-panel mt-6 p-4">
                <div className="mb-1 text-sm font-semibold">
                  {t("nomad.wizard.summaryTitle")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("nomad.wizard.summaryBody", {
                    home: fiscal
                      ? `${countryFlag(fiscal)} ${countryName(fiscal, locale)}`
                      : t("nomad.wizard.summaryNoHome"),
                    count: picked.length,
                    scan: mail
                      ? t("nomad.wizard.summaryScanOn")
                      : t("nomad.wizard.summaryScanOff"),
                  })}
                </div>
              </div>
            </StepShell>
          )}

          {/* Footer nav — Continue is never blocked */}
          <div className="mt-6 flex items-center gap-3 border-t border-border pt-6">
            {step > 1 && (
              <Button
                variant="outline"
                disabled={finishing}
                onClick={() => setStep(step - 1)}
              >
                {t("nomad.wizard.back")}
              </Button>
            )}
            <div className="ml-auto">
              {step < TOTAL_STEPS ? (
                <Button
                  variant={stepHasInput ? "default" : "outline"}
                  onClick={() => setStep(step + 1)}
                >
                  {stepHasInput
                    ? t("nomad.wizard.continue")
                    : t("nomad.wizard.skipForNow")}
                </Button>
              ) : (
                <Button disabled={finishing} onClick={() => void finish()}>
                  {t("nomad.wizard.enterCockpit")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function todayISODate(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function StepShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1">
      <h2 className="mb-1 text-2xl font-bold">{title}</h2>
      <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p>
      {children}
    </div>
  );
}

function WinNote({ text }: { text: string }) {
  return (
    <div className="mt-4 flex items-center gap-2 text-sm">
      <IconCheck className="size-4" style={{ color: "hsl(var(--safe))" }} />
      <span>{text}</span>
    </div>
  );
}

function OptionCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-popover p-4 text-left transition-all",
        selected
          ? "border-primary shadow-[inset_0_0_0_1px_hsl(var(--primary))]"
          : "border-border hover:border-ring",
      )}
    >
      {children}
    </button>
  );
}
