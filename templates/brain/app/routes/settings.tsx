import { useEffect, useMemo, useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { IconAdjustments, IconDeviceFloppy } from "@tabler/icons-react";
import {
  type BrainSettings,
  type SettingsResponse,
  defaultSettings,
} from "@/lib/brain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyActionState, PageHeader } from "@/components/brain/Surface";

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

  function update<K extends keyof BrainSettings>(
    key: K,
    value: BrainSettings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow="Settings"
        title="Extraction settings"
        description="Tune how Brain turns source material into cited, reviewable company memory."
        actions={
          <Button
            size="sm"
            disabled={saveSettings.isPending}
            onClick={() => saveSettings.mutate(settings)}
          >
            <IconDeviceFloppy className="size-4" />
            Save settings
          </Button>
        }
      />

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-7">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <IconAdjustments className="size-4 text-primary" />
              Extraction and answer policy
            </CardTitle>
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
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="team">Team</SelectItem>
                    <SelectItem value="company">Company</SelectItem>
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
                suffix="min"
                onChange={(value) => update("connectorPollMinutes", value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="distillation-instructions">
                Distillation instructions
              </Label>
              <Textarea
                id="distillation-instructions"
                value={settings.distillationInstructions ?? ""}
                onChange={(event) =>
                  update("distillationInstructions", event.target.value)
                }
                className="min-h-32 resize-none leading-6"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Instructions for turning raw captures into durable company
                memory.
              </p>
            </div>

            <Separator />

            <div className="grid gap-4">
              <SettingSwitch
                label="Require approval for company knowledge"
                description="Queue company-wide memory candidates for human review before publishing."
                checked={Boolean(settings.requireApprovalForCompanyKnowledge)}
                onChange={(checked) =>
                  update("requireApprovalForCompanyKnowledge", checked)
                }
              />
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
                label="Auto-archive resolved review items"
                description="Remove approved or rejected queue items from the active review lane."
                checked={Boolean(settings.autoArchiveResolved)}
                onChange={(checked) => update("autoArchiveResolved", checked)}
              />
              <SettingSwitch
                label="Notify on source errors"
                description="Surface degraded or failing connectors in the review flow."
                checked={Boolean(settings.notifyOnSourceErrors)}
                onChange={(checked) => update("notifyOnSourceErrors", checked)}
              />
            </div>
          </CardContent>
        </Card>

        <aside className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current policy</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <PolicyRow
                label="Publish tier"
                value={settings.defaultPublishTier ?? "team"}
              />
              <PolicyRow
                label="Poll interval"
                value={`${settings.connectorPollMinutes ?? 60} min`}
              />
              <PolicyRow
                label="Company approval"
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

function NumberField({
  id,
  label,
  value,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
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
          min={0}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="rounded-r-none"
        />
        <div className="flex min-w-20 items-center justify-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
          {suffix}
        </div>
      </div>
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
    <label className="flex items-center justify-between gap-4 rounded-md border border-border p-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium capitalize">{value.replace(/_/g, " ")}</span>
    </div>
  );
}
