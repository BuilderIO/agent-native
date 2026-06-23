import { useEffect, useMemo, useState } from "react";
import {
  ChangelogSettingsCard,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import changelog from "../../CHANGELOG.md?raw";
import {
  IconAdjustments,
  IconBuilding,
  IconDeviceFloppy,
  IconFileText,
  IconGauge,
  IconMessageCircle,
  IconShieldCheck,
} from "@tabler/icons-react";
import {
  type BrainSettings,
  type SettingsResponse,
  defaultSettings,
} from "@/lib/brain";
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
import { EmptyActionState, PageHeader } from "@/components/brain/Surface";

const toneOptions = [
  {
    value: "direct",
    label: "Direct",
    description: "Concise, concrete, and decision-oriented.",
  },
  {
    value: "friendly",
    label: "Friendly",
    description: "Warm and plainspoken without losing precision.",
  },
  {
    value: "formal",
    label: "Formal",
    description: "Careful, policy-ready, and executive-facing.",
  },
  {
    value: "technical",
    label: "Technical",
    description: "Detailed, source-heavy, and implementation-aware.",
  },
] as const;

const sourcePolicyOptions = [
  {
    value: "strict",
    label: "Strict",
    description: "Answer from approved knowledge and citations only.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Prefer approved knowledge, then identify source gaps.",
  },
  {
    value: "exploratory",
    label: "Exploratory",
    description: "Use weaker signals but label uncertainty clearly.",
  },
] as const;

type ToneValue = (typeof toneOptions)[number]["value"];
type SourcePolicyValue = (typeof sourcePolicyOptions)[number]["value"];

export default function SettingsRoute() {
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

  const toneDescription =
    toneOptions.find((option) => option.value === settings.assistantTone)
      ?.description ?? toneOptions[0].description;
  const sourcePolicyDescription =
    sourcePolicyOptions.find((option) => option.value === settings.sourcePolicy)
      ?.description ?? sourcePolicyOptions[1].description;

  function update<K extends keyof BrainSettings>(
    key: K,
    value: BrainSettings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow="Customize"
        title="Customize Brain"
        description="Name the assistant, shape its voice, and set the policies it follows when turning company sources into knowledge."
        actions={
          <Button
            size="sm"
            className="w-full sm:w-auto"
            disabled={saveSettings.isPending || !isDirty}
            onClick={() => saveSettings.mutate(settings)}
          >
            <IconDeviceFloppy className="size-4" />
            {saveSettings.isPending
              ? "Saving"
              : isDirty
                ? "Save changes"
                : "Saved"}
          </Button>
        }
      />

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-7">
        <main className="grid gap-5">
          <ChangelogSettingsCard markdown={changelog} />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconBuilding className="size-4 text-primary" />
                Identity
              </CardTitle>
              <CardDescription>
                The names Brain uses when it describes itself and the workspace
                it is protecting.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <TextField
                id="company-name"
                label="Company name"
                value={settings.companyName ?? ""}
                placeholder="Acme"
                onChange={(value) => update("companyName", value)}
              />
              <TextField
                id="assistant-name"
                label="Assistant name"
                value={settings.assistantName ?? ""}
                placeholder="Brain"
                onChange={(value) => update("assistantName", value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconMessageCircle className="size-4 text-primary" />
                Assistant Behavior
              </CardTitle>
              <CardDescription>
                The default voice and source posture for answers and distilled
                knowledge proposals.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-5 md:grid-cols-2">
                <SelectField
                  id="assistant-tone"
                  label="Tone"
                  value={(settings.assistantTone ?? "direct") as ToneValue}
                  options={toneOptions}
                  onChange={(value) => update("assistantTone", value)}
                />
                <SelectField
                  id="source-policy"
                  label="Source policy"
                  value={
                    (settings.sourcePolicy ?? "balanced") as SourcePolicyValue
                  }
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
                  Core instructions
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
                  Guidance for turning raw captures into durable institutional
                  knowledge.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconAdjustments className="size-4 text-primary" />
                Publishing And Review
              </CardTitle>
              <CardDescription>
                Defaults for visibility, approval, and connector cadence.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="publish-tier">Default publish tier</Label>
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
                        <SelectItem value="private">Private</SelectItem>
                        <SelectItem value="team">Team</SelectItem>
                        <SelectItem value="company">Company</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Sets the default visibility for newly distilled knowledge.
                  </p>
                </div>

                <NumberField
                  id="connector-poll-minutes"
                  label="Connector poll interval"
                  value={settings.connectorPollMinutes ?? 60}
                  min={5}
                  max={1440}
                  suffix="min"
                  onChange={(value) => update("connectorPollMinutes", value)}
                />
              </div>

              <Separator />

              <div className="grid gap-4">
                <SettingSwitch
                  label="Require approval for company knowledge"
                  description="Queue company-wide knowledge candidates for human review before publishing."
                  checked={Boolean(settings.requireApprovalForCompanyKnowledge)}
                  onChange={(checked) =>
                    update("requireApprovalForCompanyKnowledge", checked)
                  }
                />
                <SettingSwitch
                  label="Auto-archive resolved review items"
                  description="Remove approved or rejected queue items from the active review lane."
                  checked={Boolean(settings.autoArchiveResolved)}
                  onChange={(checked) => update("autoArchiveResolved", checked)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconShieldCheck className="size-4 text-primary" />
                Safety And Evidence
              </CardTitle>
              <CardDescription>
                Redaction and citation rules for answers that leave the review
                queue.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <SettingSwitch
                label="Sanitize transcript captures before storage"
                description="Filter Granola, Clips, webhook, and manual transcript imports down to company-relevant content before saving."
                checked={settings.captureSanitizationEnabled !== false}
                onChange={(checked) =>
                  update("captureSanitizationEnabled", checked)
                }
              />
              {settings.captureSanitizationEnabled !== false ? (
                <div className="grid gap-4 rounded-md border border-border p-4">
                  <div className="grid gap-2">
                    <Label htmlFor="capture-sanitization-model">
                      Sanitization model
                    </Label>
                    <Input
                      id="capture-sanitization-model"
                      value={settings.captureSanitizationModel ?? ""}
                      placeholder="Default agent model or a cheaper flash model"
                      onChange={(event) =>
                        update("captureSanitizationModel", event.target.value)
                      }
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      Optional override for the pre-save filtering pass.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="capture-sanitization-instructions">
                      Sanitization instructions
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
                label="Auto-redact emails"
                description="Remove email addresses from distilled knowledge unless they are essential evidence."
                checked={Boolean(settings.autoRedactEmails)}
                onChange={(checked) => update("autoRedactEmails", checked)}
              />
              <SettingSwitch
                label="Require citations"
                description="Ask Brain must cite approved source rows for factual answers."
                checked={Boolean(settings.requireCitations)}
                onChange={(checked) => update("requireCitations", checked)}
              />
              <SettingSwitch
                label="Notify on source errors"
                description="Surface degraded or failing connectors in the review flow."
                checked={Boolean(settings.notifyOnSourceErrors)}
                onChange={(checked) => update("notifyOnSourceErrors", checked)}
              />
            </CardContent>
          </Card>
        </main>

        <aside className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconFileText className="size-4 text-primary" />
                Current Policy
              </CardTitle>
              <CardDescription>
                The effective settings saved for this Brain workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <PolicyRow
                label="Assistant"
                value={settings.assistantName || "Brain"}
              />
              <PolicyRow
                label="Company"
                value={settings.companyName || "Not set"}
              />
              <PolicyRow
                label="Tone"
                value={settings.assistantTone ?? "direct"}
              />
              <PolicyRow
                label="Sources"
                value={settings.sourcePolicy ?? "balanced"}
              />
              <PolicyRow
                label="Publish tier"
                value={settings.defaultPublishTier ?? "team"}
              />
              <PolicyRow
                label="Approval"
                value={
                  settings.requireApprovalForCompanyKnowledge
                    ? "required"
                    : "not required"
                }
              />
              <PolicyRow
                label="Redaction"
                value={settings.autoRedactEmails ? "enabled" : "disabled"}
              />
              <PolicyRow
                label="Pre-save filter"
                value={
                  settings.captureSanitizationEnabled === false
                    ? "disabled"
                    : "enabled"
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconGauge className="size-4 text-primary" />
                Auto-publish Gate
              </CardTitle>
              <CardDescription>
                Runtime policy for company-tier knowledge.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  Confidence threshold
                </span>
                <Badge variant="secondary">90%+</Badge>
              </div>
              <Progress value={90} className="h-2" />
              <p className="text-xs leading-5 text-muted-foreground">
                High-confidence company knowledge can publish automatically when
                it is new, unredacted, and does not require an explicit
                proposal.
              </p>
            </CardContent>
          </Card>

          {settingsQuery.isError || saveSettings.isError ? (
            <EmptyActionState
              title="Settings actions are not available yet"
              detail="This page is wired to get-brain-settings and update-brain-settings and is using defaults for now."
            />
          ) : null}
        </aside>
      </div>
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
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
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
          className="rounded-r-none"
        />
        <div className="flex min-w-20 items-center justify-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
          {suffix}
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Must be between {min} and {max} minutes.
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
      <span className="max-w-40 truncate text-right font-medium capitalize">
        {value.replace(/_/g, " ")}
      </span>
    </div>
  );
}
