import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  useAgentSettingsTabs,
  useActionMutation,
  useActionQuery,
  useT,
  type SettingsSearchEntry,
  type SettingsTabItem,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
import {
  IconAdjustments,
  IconDeviceFloppy,
  IconFileText,
  IconGauge,
  IconMessageCircle,
  IconShieldCheck,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { EmptyActionState, PageHeader } from "@/components/brain/Surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type BrainSettings,
  type SettingsResponse,
  defaultSettings,
} from "@/lib/brain";
import {
  createSettingsSectionIds,
  resolveSettingsSection,
  withSettingsSection,
} from "@/lib/settings-navigation";

import changelog from "../../CHANGELOG.md?raw";

const toneValues = ["direct", "friendly", "formal", "technical"] as const;
const sourcePolicyValues = ["strict", "balanced", "exploratory"] as const;

type ToneValue = (typeof toneValues)[number];
type SourcePolicyValue = (typeof sourcePolicyValues)[number];
type ToneOption = {
  value: ToneValue;
  label: string;
  description: string;
};
type SourcePolicyOption = {
  value: SourcePolicyValue;
  label: string;
  description: string;
};

function toneOptions(t: ReturnType<typeof useT>): ToneOption[] {
  return toneValues.map((value) => ({
    value,
    label: t(`settings.tone.${value}.label`),
    description: t(`settings.tone.${value}.description`),
  }));
}

function sourcePolicyOptions(t: ReturnType<typeof useT>): SourcePolicyOption[] {
  return sourcePolicyValues.map((value) => ({
    value,
    label: t(`settings.sourcePolicy.${value}.label`),
    description: t(`settings.sourcePolicy.${value}.description`),
  }));
}

type UpdateBrainSettings = <K extends keyof BrainSettings>(
  key: K,
  value: BrainSettings[K],
) => void;

function AssistantBehaviorSettings({
  settings,
  update,
  toneOptions,
  sourcePolicyOptions,
}: {
  settings: BrainSettings;
  update: UpdateBrainSettings;
  toneOptions: ToneOption[];
  sourcePolicyOptions: SourcePolicyOption[];
}) {
  const t = useT();
  const toneDescription =
    toneOptions.find((option) => option.value === settings.assistantTone)
      ?.description ?? toneOptions[0].description;
  const sourcePolicyDescription =
    sourcePolicyOptions.find((option) => option.value === settings.sourcePolicy)
      ?.description ?? sourcePolicyOptions[1].description;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card id="assistant-behavior" className="scroll-mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconMessageCircle className="size-4 text-primary" />
            {t("settings.assistantBehaviorTitle")}
          </CardTitle>
          <CardDescription>
            {t("settings.assistantBehaviorDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-5 md:grid-cols-2">
            <SelectField
              id="assistant-tone"
              label={t("settings.toneLabel")}
              value={(settings.assistantTone ?? "direct") as ToneValue}
              options={toneOptions}
              onChange={(value) => update("assistantTone", value)}
            />
            <SelectField
              id="source-policy"
              label={t("settings.sourcePolicyLabel")}
              value={(settings.sourcePolicy ?? "balanced") as SourcePolicyValue}
              options={sourcePolicyOptions}
              onChange={(value) => update("sourcePolicy", value)}
            />
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <p className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              {toneDescription}
            </p>
            <p className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              {sourcePolicyDescription}
            </p>
          </div>
          <Separator />
          <div className="grid gap-2">
            <Label htmlFor="distillation-instructions">
              {t("settings.coreInstructions")}
            </Label>
            <Textarea
              id="distillation-instructions"
              value={settings.distillationInstructions ?? ""}
              onChange={(event) =>
                update("distillationInstructions", event.target.value)
              }
              className="min-h-36 resize-y leading-6"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.coreInstructionsDescription")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PublishingReviewSettings({
  settings,
  update,
}: {
  settings: BrainSettings;
  update: UpdateBrainSettings;
}) {
  const t = useT();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card id="publishing-review" className="scroll-mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconAdjustments className="size-4 text-primary" />
            {t("settings.publishingReviewTitle")}
          </CardTitle>
          <CardDescription>
            {t("settings.publishingReviewDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="publish-tier">
                {t("settings.defaultPublishTier")}
              </Label>
              <Select
                value={settings.defaultPublishTier}
                onValueChange={(value) =>
                  update(
                    "defaultPublishTier",
                    value as BrainSettings["defaultPublishTier"],
                  )
                }
              >
                <SelectTrigger id="publish-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="private">
                      {t("settings.publishTier.private")}
                    </SelectItem>
                    <SelectItem value="team">
                      {t("settings.publishTier.team")}
                    </SelectItem>
                    <SelectItem value="company">
                      {t("settings.publishTier.company")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("settings.defaultPublishTierDescription")}
              </p>
            </div>
            <NumberField
              id="connector-poll-minutes"
              label={t("settings.connectorPollInterval")}
              value={settings.connectorPollMinutes ?? 60}
              min={5}
              max={1440}
              suffix="min"
              t={t}
              onChange={(value) => update("connectorPollMinutes", value)}
            />
          </div>
          <Separator />
          <div className="grid gap-4">
            <SettingSwitch
              label={t("settings.requireApproval")}
              description={t("settings.requireApprovalDescription")}
              checked={Boolean(settings.requireApprovalForCompanyKnowledge)}
              onChange={(checked) =>
                update("requireApprovalForCompanyKnowledge", checked)
              }
            />
            <SettingSwitch
              label={t("settings.autoArchiveResolved")}
              description={t("settings.autoArchiveResolvedDescription")}
              checked={Boolean(settings.autoArchiveResolved)}
              onChange={(checked) => update("autoArchiveResolved", checked)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SafetyEvidenceSettings({
  settings,
  update,
}: {
  settings: BrainSettings;
  update: UpdateBrainSettings;
}) {
  const t = useT();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card id="safety-evidence" className="scroll-mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconShieldCheck className="size-4 text-primary" />
            {t("settings.safetyEvidenceTitle")}
          </CardTitle>
          <CardDescription>
            {t("settings.safetyEvidenceDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <SettingSwitch
            label={t("settings.sanitizeCaptures")}
            description={t("settings.sanitizeCapturesDescription")}
            checked={settings.captureSanitizationEnabled !== false}
            onChange={(checked) =>
              update("captureSanitizationEnabled", checked)
            }
          />
          {settings.captureSanitizationEnabled !== false ? (
            <div className="grid gap-4 rounded-md border border-border p-4">
              <div className="grid gap-2">
                <Label htmlFor="capture-sanitization-model">
                  {t("settings.sanitizationModel")}
                </Label>
                <Input
                  id="capture-sanitization-model"
                  value={settings.captureSanitizationModel ?? ""}
                  placeholder={t("settings.sanitizationModelPlaceholder")}
                  onChange={(event) =>
                    update("captureSanitizationModel", event.target.value)
                  }
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("settings.sanitizationModelDescription")}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="capture-sanitization-instructions">
                  {t("settings.sanitizationInstructions")}
                </Label>
                <Textarea
                  id="capture-sanitization-instructions"
                  value={settings.captureSanitizationInstructions ?? ""}
                  onChange={(event) =>
                    update(
                      "captureSanitizationInstructions",
                      event.target.value,
                    )
                  }
                  className="min-h-24 resize-y leading-6"
                />
              </div>
            </div>
          ) : null}
          <SettingSwitch
            label={t("settings.autoRedactEmails")}
            description={t("settings.autoRedactEmailsDescription")}
            checked={Boolean(settings.autoRedactEmails)}
            onChange={(checked) => update("autoRedactEmails", checked)}
          />
          <SettingSwitch
            label={t("settings.requireCitations")}
            description={t("settings.requireCitationsDescription")}
            checked={Boolean(settings.requireCitations)}
            onChange={(checked) => update("requireCitations", checked)}
          />
          <SettingSwitch
            label={t("settings.notifySourceErrors")}
            description={t("settings.notifySourceErrorsDescription")}
            checked={Boolean(settings.notifyOnSourceErrors)}
            onChange={(checked) => update("notifyOnSourceErrors", checked)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState("general");
  const localizedToneOptions = useMemo(() => toneOptions(t), [t]);
  const localizedSourcePolicyOptions = useMemo(
    () => sourcePolicyOptions(t),
    [t],
  );
  const settingsQuery = useActionQuery<SettingsResponse>(
    "get-brain-settings" as any,
    {} as any,
  );
  const saveSettings = useActionMutation<unknown, BrainSettings>(
    "update-brain-settings" as any,
  );

  const loaded = useMemo(
    () => ({ ...defaultSettings, ...(settingsQuery.data?.settings ?? {}) }),
    [settingsQuery.data],
  );
  const [settings, setSettings] = useState<BrainSettings>(loaded);

  useEffect(() => {
    setSettings(loaded);
  }, [loaded]);

  const isDirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(loaded),
    [loaded, settings],
  );

  function update<K extends keyof BrainSettings>(
    key: K,
    value: BrainSettings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "brain-identity",
        label: t("settings.identityTitle"),
        keywords: "identity company name assistant name",
        hash: "identity",
      },
      {
        id: "brain-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
    ],
    [t],
  );
  const appSettingsTabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: "assistant-behavior",
        label: t("settings.assistantBehaviorTitle"),
        icon: IconMessageCircle,
        keywords: "assistant behavior tone source policy instructions",
        searchEntries: [
          {
            id: "brain-behavior",
            label: t("settings.assistantBehaviorTitle"),
            keywords: "assistant behavior tone source policy instructions",
            hash: "assistant-behavior",
          },
        ],
        content: (
          <AssistantBehaviorSettings
            settings={settings}
            update={update}
            toneOptions={localizedToneOptions}
            sourcePolicyOptions={localizedSourcePolicyOptions}
          />
        ),
      },
      {
        id: "publishing-review",
        label: t("settings.publishingReviewTitle"),
        icon: IconAdjustments,
        keywords: "publishing review publish tier approval connector poll",
        searchEntries: [
          {
            id: "brain-publishing",
            label: t("settings.publishingReviewTitle"),
            keywords: "publishing review publish tier approval connector poll",
            hash: "publishing-review",
          },
        ],
        content: (
          <PublishingReviewSettings settings={settings} update={update} />
        ),
      },
      {
        id: "safety-evidence",
        label: t("settings.safetyEvidenceTitle"),
        icon: IconShieldCheck,
        keywords: "safety evidence sanitize redact citations sources",
        searchEntries: [
          {
            id: "brain-safety",
            label: t("settings.safetyEvidenceTitle"),
            keywords: "safety evidence sanitize redact citations sources",
            hash: "safety-evidence",
          },
        ],
        content: <SafetyEvidenceSettings settings={settings} update={update} />,
      },
    ],
    [localizedSourcePolicyOptions, localizedToneOptions, settings, t, update],
  );
  const settingsTabs = useMemo<SettingsTabItem[]>(
    () => [...appSettingsTabs, ...agentSettingsTabs],
    [agentSettingsTabs, appSettingsTabs],
  );
  const validSectionIds = useMemo(
    () => createSettingsSectionIds(settingsTabs.map((tab) => tab.id)),
    [settingsTabs],
  );

  useEffect(() => {
    const section = searchParams.get("section");
    if (!section) return;
    setActiveSection(resolveSettingsSection(section, validSectionIds));
  }, [searchParams, validSectionIds]);

  const handleSectionChange = (section: string) => {
    setActiveSection(section);
    setSearchParams(
      (current) => {
        return withSettingsSection(current, section);
      },
      { replace: true },
    );
  };

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.title")}
        description={t("settings.description")}
        actions={
          <Button
            size="sm"
            className="w-full sm:w-auto"
            disabled={saveSettings.isPending || !isDirty}
            onClick={() => saveSettings.mutate(settings)}
          >
            <IconDeviceFloppy className="size-4" />
            {saveSettings.isPending
              ? t("common.saving")
              : isDirty
                ? t("common.saveChanges")
                : t("common.saved")}
          </Button>
        }
      />

      <SettingsTabsPage
        teamLabel={t("team.title")}
        extraTabs={settingsTabs}
        generalSearchEntries={generalSearchEntries}
        value={activeSection}
        onValueChange={handleSectionChange}
        general={
          <div className="brain-settings-general-grid grid gap-5">
            <main className="grid gap-5">
              <Card id="identity" className="scroll-mt-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <IconUsersGroup className="size-4 text-primary" />
                    {t("settings.identityTitle")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.identityDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5 md:grid-cols-2">
                  <TextField
                    id="company-name"
                    label={t("settings.companyName")}
                    value={settings.companyName ?? ""}
                    placeholder="Acme"
                    onChange={(value) => update("companyName", value)}
                  />
                  <TextField
                    id="assistant-name"
                    label={t("settings.assistantName")}
                    value={settings.assistantName ?? ""}
                    placeholder="Brain"
                    onChange={(value) => update("assistantName", value)}
                  />
                </CardContent>
              </Card>
            </main>

            <aside className="grid content-start gap-5">
              <Card id="language" className="scroll-mt-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <IconAdjustments className="size-4 text-primary" />
                    {t("settings.languageTitle")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.languageDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  <Label>{t("settings.languageLabel")}</Label>
                  <LanguagePicker label={t("settings.languageLabel")} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <IconFileText className="size-4 text-primary" />
                    {t("settings.currentPolicy")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.currentPolicyDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <PolicyRow
                    label={t("settings.policy.assistant")}
                    value={settings.assistantName || "Brain"}
                  />
                  <PolicyRow
                    label={t("settings.policy.company")}
                    value={settings.companyName || t("settings.notSet")}
                  />
                  <PolicyRow
                    label={t("settings.policy.tone")}
                    value={t(
                      `settings.tone.${settings.assistantTone ?? "direct"}.label`,
                    )}
                  />
                  <PolicyRow
                    label={t("settings.policy.sources")}
                    value={t(
                      `settings.sourcePolicy.${settings.sourcePolicy ?? "balanced"}.label`,
                    )}
                  />
                  <PolicyRow
                    label={t("settings.policy.publishTier")}
                    value={t(
                      `settings.publishTier.${settings.defaultPublishTier ?? "team"}`,
                    )}
                  />
                  <PolicyRow
                    label={t("settings.policy.approval")}
                    value={
                      settings.requireApprovalForCompanyKnowledge
                        ? t("settings.required")
                        : t("settings.notRequired")
                    }
                  />
                  <PolicyRow
                    label={t("settings.policy.redaction")}
                    value={
                      settings.autoRedactEmails
                        ? t("settings.enabled")
                        : t("settings.disabled")
                    }
                  />
                  <PolicyRow
                    label={t("settings.policy.preSaveFilter")}
                    value={
                      settings.captureSanitizationEnabled === false
                        ? t("settings.disabled")
                        : t("settings.enabled")
                    }
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <IconGauge className="size-4 text-primary" />
                    {t("settings.autoPublishGateTitle")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.autoPublishGateDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      {t("settings.confidenceThreshold")}
                    </span>
                    <Badge variant="secondary">90%+</Badge>
                  </div>
                  <Progress value={90} className="h-2" />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("settings.autoPublishGateDetail")}
                  </p>
                </CardContent>
              </Card>

              {settingsQuery.isError || saveSettings.isError ? (
                <EmptyActionState
                  title={t("settings.actionsUnavailableTitle")}
                  detail={t("settings.actionsUnavailableDetail")}
                />
              ) : null}
            </aside>
          </div>
        }
        team={
          <div className="mx-auto w-full max-w-3xl">
            <TeamPage
              showTitle={false}
              createOrgDescription={t("team.createOrgDescription")}
            />
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-3xl">
            <ChangelogSettingsCard markdown={changelog} />
          </div>
        }
      />
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SelectField<TValue extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: TValue;
  options: ReadonlyArray<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as TValue)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  suffix,
  t,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  t: ReturnType<typeof useT>;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="rounded-e-none"
        />
        <div className="flex min-w-20 items-center justify-center rounded-e-md border border-s-0 border-input bg-muted px-3 text-sm text-muted-foreground">
          {suffix}
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {t("settings.numberFieldRange", { min, max })}
      </p>
    </div>
  );
}

function SettingSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex flex-col items-start justify-between gap-4 rounded-md border border-border p-4 sm:flex-row sm:items-center">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
      <Switch
        className="shrink-0"
        checked={checked}
        onCheckedChange={onChange}
      />
    </label>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className="max-w-40 truncate text-end font-medium">{value}</span>
    </div>
  );
}
