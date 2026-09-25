import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsRow,
  type SettingsAppArea,
} from "@agent-native/core/client/settings";
import {
  IconAdjustments,
  IconLock,
  IconMessageCircle,
  IconShieldCheck,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type BrainHealthResponse,
  type BrainSettings,
  type SettingsResponse,
  defaultSettings,
} from "@/lib/brain";
import type { BrainSettingsAreaId } from "@/lib/settings-navigation";

type SaveBrainSettings = (patch: Partial<BrainSettings>) => Promise<boolean>;

const SETTINGS_QUERY_KEY: QueryKey = ["action", "get-brain-settings"];
const SETTINGS_MUTATION_KEY: QueryKey = ["update-brain-settings"];

type PatchedFields = Array<[QueryKey, Partial<BrainSettings>]>;

const TONES = ["direct", "friendly", "formal", "technical"] as const;
const SOURCE_POLICIES = ["strict", "balanced", "exploratory"] as const;
const PUBLISH_TIERS = ["private", "team", "company"] as const;
const PRIVACY_CLASSIFIERS = [
  ["jev", "settings.privacyClassifierJev"],
  ["model", "settings.privacyClassifierCustom"],
  ["deterministic", "settings.privacyClassifierDeterministic"],
] as const;

const JEV_CREDENTIAL_KEYS = {
  "stored-key": "settings.jevCredentialStoredKey",
  "builder-gateway": "settings.jevCredentialGateway",
  none: "settings.jevCredentialNone",
  unavailable: "settings.jevCredentialUnavailable",
} as const;

type SettingsState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; settings: BrainSettings };

/**
 * Brain's settings with every change saved as it's made: the cache updates
 * first and rolls back with a toast when `update-brain-settings` fails.
 */
function useBrainSettingsState(): {
  state: SettingsState;
  save: SaveBrainSettings;
} {
  const t = useT();
  const queryClient = useQueryClient();
  const query = useActionQuery<SettingsResponse>(
    "get-brain-settings" as any,
    {} as any,
  );
  const mutation = useActionMutation<unknown, Partial<BrainSettings>>(
    "update-brain-settings" as any,
    {
      mutationKey: SETTINGS_MUTATION_KEY,
      // Saves run one at a time and the refetch waits for the last one. A
      // refetch between two quick saves returns the row without the second
      // change and flips that control back until its save lands.
      scope: { id: "update-brain-settings" },
      skipActionQueryInvalidation: true,
      onMutate: async (patch) => {
        await queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_KEY });
        const previous: PatchedFields = queryClient
          .getQueriesData<SettingsResponse>({ queryKey: SETTINGS_QUERY_KEY })
          .map(([key, data]) => [
            key,
            Object.fromEntries(
              Object.keys(patch).map((field) => [
                field,
                data?.settings?.[field as keyof BrainSettings],
              ]),
            ) as Partial<BrainSettings>,
          ]);
        queryClient.setQueriesData<SettingsResponse>(
          { queryKey: SETTINGS_QUERY_KEY },
          (current) =>
            current
              ? { ...current, settings: { ...current.settings, ...patch } }
              : current,
        );
        return { previous };
      },
      onError: (_error, _patch, context) => {
        // Restore only this patch's fields so a queued save keeps its
        // optimistic value.
        const previous = (context as { previous?: PatchedFields } | undefined)
          ?.previous;
        for (const [key, values] of previous ?? []) {
          queryClient.setQueryData<SettingsResponse>(key, (current) =>
            current
              ? { ...current, settings: { ...current.settings, ...values } }
              : current,
          );
        }
        toast.error(t("settings.area.saveFailed"));
      },
      onSettled: () => {
        // The settling save still counts as pending here.
        if (queryClient.isMutating({ mutationKey: SETTINGS_MUTATION_KEY }) > 1)
          return;
        void queryClient.invalidateQueries({ queryKey: ["action"] });
      },
    },
  );
  const { mutateAsync } = mutation;
  const save = useMemo<SaveBrainSettings>(
    () => async (patch) => {
      try {
        await mutateAsync(patch);
        return true;
      } catch {
        // coercion-ok: false is the failure result; onError rolled back and toasted.
        return false;
      }
    },
    [mutateAsync],
  );

  const refetch = query.refetch;
  const state = useMemo<SettingsState>(() => {
    if (query.data) {
      return {
        status: "ready",
        settings: { ...defaultSettings, ...(query.data.settings ?? {}) },
      };
    }
    if (query.isError) return { status: "error", retry: () => void refetch() };
    return { status: "loading" };
  }, [query.data, query.isError, refetch]);

  return { state, save };
}

function AreaSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup>
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <div className="grid gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-9 w-40" />
          </div>
        ))}
      </SettingsGroup>
    </div>
  );
}

function AreaFrame({
  state,
  rows,
  children,
}: {
  state: SettingsState;
  rows: number;
  children: (settings: BrainSettings) => ReactNode;
}) {
  const t = useT();
  if (state.status === "loading") return <AreaSkeleton rows={rows} />;
  if (state.status === "error") {
    return (
      <SettingsGroup>
        <SettingsRow
          label={t("settings.area.loadFailed")}
          control={
            <Button size="sm" variant="outline" onClick={state.retry}>
              {t("settings.area.retry")}
            </Button>
          }
        />
      </SettingsGroup>
    );
  }
  return <div className="flex flex-col gap-8">{children(state.settings)}</div>;
}

/** An input that saves on blur or Enter, and only when its value changed. */
function CommitInput({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  disabled,
  type = "text",
  normalize = (next: string) => next,
}: {
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "number";
  normalize?: (next: string) => string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = normalize(draft);
    setDraft(next);
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      className="w-full sm:w-64"
      type={type}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(value);
      }}
    />
  );
}

function clampedInteger(min: number, max: number, fallback: number) {
  return (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return String(fallback);
    return String(Math.max(min, Math.min(max, parsed)));
  };
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <SettingsRow
      id={id}
      label={label}
      description={description}
      control={
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          aria-label={label}
          className="shrink-0"
        />
      }
    />
  );
}

function SelectControl<TValue extends string>({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: TValue;
  options: ReadonlyArray<{ value: TValue; label: string }>;
  ariaLabel: string;
  onChange: (value: TValue) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as TValue)}>
      <SelectTrigger className="w-full sm:w-64" aria-label={ariaLabel}>
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
  );
}

/**
 * A long text setting: the row opens a dialog that holds a draft and saves it
 * only on Save, so a half-written instruction never reaches the agent.
 */
function TextDialogRow({
  id,
  label,
  description,
  value,
  placeholder,
  disabled,
  onSave,
}: {
  id: string;
  label: string;
  description?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onSave: (next: string) => Promise<boolean>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const openDialog = () => {
    setDraft(value);
    setFailed(false);
    setOpen(true);
  };
  const submit = async () => {
    setPending(true);
    setFailed(false);
    const saved = await onSave(draft);
    setPending(false);
    if (saved) setOpen(false);
    else setFailed(true);
  };

  return (
    <SettingsRow
      id={id}
      label={label}
      description={description}
      control={
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={openDialog}
          >
            {t("settings.area.edit")}
          </Button>
          <Dialog
            open={open}
            onOpenChange={(next) => !pending && setOpen(next)}
          >
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{label}</DialogTitle>
                <DialogDescription className="sr-only">
                  {description ?? label}
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={draft}
                placeholder={placeholder}
                aria-label={label}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-40 resize-y"
              />
              {failed ? (
                <p role="alert" className="text-sm text-destructive">
                  {t("settings.area.saveFailed")}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                >
                  {t("settings.area.cancel")}
                </Button>
                <Button
                  disabled={pending || draft === value}
                  onClick={() => void submit()}
                >
                  {pending ? t("common.saving") : t("settings.area.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      }
    />
  );
}

function IdentityArea({
  state,
  save,
}: {
  state: SettingsState;
  save: SaveBrainSettings;
}) {
  const t = useT();
  return (
    <AreaFrame state={state} rows={2}>
      {(settings) => (
        <SettingsGroup id="brain-names" title={t("settings.area.groupNames")}>
          <SettingsRow
            id="company-name"
            label={t("settings.companyName")}
            control={
              <CommitInput
                value={settings.companyName ?? ""}
                ariaLabel={t("settings.companyName")}
                placeholder="Acme"
                normalize={(next) => next.trim()}
                onCommit={(companyName) => void save({ companyName })}
              />
            }
          />
          <SettingsRow
            id="assistant-name"
            label={t("settings.assistantName")}
            control={
              <CommitInput
                value={settings.assistantName ?? ""}
                ariaLabel={t("settings.assistantName")}
                placeholder="Brain"
                normalize={(next) => next.trim()}
                onCommit={(assistantName) => void save({ assistantName })}
              />
            }
          />
        </SettingsGroup>
      )}
    </AreaFrame>
  );
}

function BehaviorArea({
  state,
  save,
}: {
  state: SettingsState;
  save: SaveBrainSettings;
}) {
  const t = useT();
  return (
    <AreaFrame state={state} rows={3}>
      {(settings) => {
        const tone = settings.assistantTone ?? "direct";
        const sourcePolicy = settings.sourcePolicy ?? "balanced";
        return (
          <>
            <SettingsGroup
              id="brain-answers"
              title={t("settings.area.groupAnswers")}
            >
              <SettingsRow
                id="assistant-tone"
                label={t("settings.toneLabel")}
                description={t(`settings.tone.${tone}.description`)}
                control={
                  <SelectControl
                    value={tone}
                    ariaLabel={t("settings.toneLabel")}
                    options={TONES.map((value) => ({
                      value,
                      label: t(`settings.tone.${value}.label`),
                    }))}
                    onChange={(assistantTone) => void save({ assistantTone })}
                  />
                }
              />
              <SettingsRow
                id="source-policy"
                label={t("settings.sourcePolicyLabel")}
                description={t(
                  `settings.sourcePolicy.${sourcePolicy}.description`,
                )}
                control={
                  <SelectControl
                    value={sourcePolicy}
                    ariaLabel={t("settings.sourcePolicyLabel")}
                    options={SOURCE_POLICIES.map((value) => ({
                      value,
                      label: t(`settings.sourcePolicy.${value}.label`),
                    }))}
                    onChange={(next) => void save({ sourcePolicy: next })}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup
              id="brain-distillation"
              title={t("settings.area.groupDistillation")}
            >
              <TextDialogRow
                id="distillation-instructions"
                label={t("settings.coreInstructions")}
                description={t("settings.coreInstructionsDescription")}
                value={settings.distillationInstructions ?? ""}
                onSave={(distillationInstructions) =>
                  save({ distillationInstructions })
                }
              />
            </SettingsGroup>
          </>
        );
      }}
    </AreaFrame>
  );
}

function PublishingArea({
  state,
  save,
}: {
  state: SettingsState;
  save: SaveBrainSettings;
}) {
  const t = useT();
  return (
    <AreaFrame state={state} rows={4}>
      {(settings) => (
        <>
          <SettingsGroup
            id="brain-publishing"
            title={t("settings.area.tabPublishing")}
          >
            <SettingsRow
              id="publish-tier"
              label={t("settings.defaultPublishTier")}
              description={t("settings.defaultPublishTierDescription")}
              control={
                <SelectControl
                  value={settings.defaultPublishTier ?? "team"}
                  ariaLabel={t("settings.defaultPublishTier")}
                  options={PUBLISH_TIERS.map((value) => ({
                    value,
                    label: t(`settings.publishTier.${value}`),
                  }))}
                  onChange={(defaultPublishTier) =>
                    void save({ defaultPublishTier })
                  }
                />
              }
            />
            <SwitchRow
              id="require-approval"
              label={t("settings.requireApproval")}
              description={t("settings.requireApprovalDescription")}
              checked={Boolean(settings.requireApprovalForCompanyKnowledge)}
              onChange={(checked) =>
                void save({ requireApprovalForCompanyKnowledge: checked })
              }
            />
          </SettingsGroup>
          <SettingsGroup
            id="brain-review-queue"
            title={t("settings.area.groupReviewQueue")}
          >
            <SwitchRow
              id="auto-archive-resolved"
              label={t("settings.autoArchiveResolved")}
              description={t("settings.autoArchiveResolvedDescription")}
              checked={Boolean(settings.autoArchiveResolved)}
              onChange={(checked) =>
                void save({ autoArchiveResolved: checked })
              }
            />
          </SettingsGroup>
          <SettingsGroup
            id="brain-sources"
            title={t("settings.area.groupSources")}
          >
            <SettingsRow
              id="connector-poll-minutes"
              label={t("settings.connectorPollInterval")}
              description={t("settings.numberFieldRange", {
                min: 5,
                max: 1440,
              })}
              control={
                <CommitInput
                  type="number"
                  value={String(settings.connectorPollMinutes ?? 60)}
                  ariaLabel={t("settings.connectorPollInterval")}
                  normalize={clampedInteger(
                    5,
                    1440,
                    settings.connectorPollMinutes ?? 60,
                  )}
                  onCommit={(next) =>
                    void save({ connectorPollMinutes: Number(next) })
                  }
                />
              }
            />
          </SettingsGroup>
        </>
      )}
    </AreaFrame>
  );
}

function SafetyArea({
  state,
  save,
}: {
  state: SettingsState;
  save: SaveBrainSettings;
}) {
  const t = useT();
  return (
    <AreaFrame state={state} rows={5}>
      {(settings) => {
        const sanitizing = settings.captureSanitizationEnabled !== false;
        return (
          <>
            <SettingsGroup
              id="brain-captures"
              title={t("settings.area.groupCaptures")}
            >
              <SwitchRow
                id="capture-sanitization"
                label={t("settings.sanitizeCaptures")}
                description={t("settings.sanitizeCapturesDescription")}
                checked={sanitizing}
                onChange={(checked) =>
                  void save({ captureSanitizationEnabled: checked })
                }
              />
              <SettingsRow
                id="capture-sanitization-model"
                label={t("settings.sanitizationModel")}
                description={t("settings.sanitizationModelDescription")}
                control={
                  <CommitInput
                    value={settings.captureSanitizationModel ?? ""}
                    ariaLabel={t("settings.sanitizationModel")}
                    placeholder={t("settings.sanitizationModelPlaceholder")}
                    disabled={!sanitizing}
                    normalize={(next) => next.trim()}
                    onCommit={(captureSanitizationModel) =>
                      void save({ captureSanitizationModel })
                    }
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup
              id="brain-evidence"
              title={t("settings.area.groupAnswers")}
            >
              <SwitchRow
                id="require-citations"
                label={t("settings.requireCitations")}
                description={t("settings.requireCitationsDescription")}
                checked={Boolean(settings.requireCitations)}
                onChange={(checked) => void save({ requireCitations: checked })}
              />
              <SwitchRow
                id="auto-redact-emails"
                label={t("settings.autoRedactEmails")}
                description={t("settings.autoRedactEmailsDescription")}
                checked={Boolean(settings.autoRedactEmails)}
                onChange={(checked) => void save({ autoRedactEmails: checked })}
              />
              <SwitchRow
                id="notify-source-errors"
                label={t("settings.notifySourceErrors")}
                description={t("settings.notifySourceErrorsDescription")}
                checked={Boolean(settings.notifyOnSourceErrors)}
                onChange={(checked) =>
                  void save({ notifyOnSourceErrors: checked })
                }
              />
            </SettingsGroup>
            <SettingsGroup
              id="brain-safety-advanced"
              title={t("settings.area.groupAdvanced")}
            >
              <TextDialogRow
                id="capture-sanitization-instructions"
                label={t("settings.sanitizationInstructions")}
                value={settings.captureSanitizationInstructions ?? ""}
                disabled={!sanitizing}
                onSave={(captureSanitizationInstructions) =>
                  save({ captureSanitizationInstructions })
                }
              />
            </SettingsGroup>
          </>
        );
      }}
    </AreaFrame>
  );
}

function PrivacyArea({
  state,
  save,
}: {
  state: SettingsState;
  save: SaveBrainSettings;
}) {
  const t = useT();
  const healthQuery = useActionQuery<BrainHealthResponse>(
    "get-brain-health" as any,
    {} as any,
  );
  const classifier = healthQuery.data?.privacy?.classifier;
  return (
    <AreaFrame state={state} rows={3}>
      {(settings) => (
        <>
          <div className="flex flex-col gap-2.5">
            <SettingsGroup
              id="brain-screening"
              title={t("settings.area.groupScreening")}
            >
              <SettingsRow
                id="privacy-classifier-choice"
                label={t("settings.privacyClassifierChoice")}
                status={
                  healthQuery.data ? (
                    <Badge variant="secondary">
                      {classifier?.configured
                        ? t("settings.ready")
                        : t("settings.readinessPending")}
                    </Badge>
                  ) : null
                }
                description={
                  classifier?.warning ? (
                    <span className="text-destructive">
                      {classifier.warning}
                    </span>
                  ) : undefined
                }
                control={
                  <SelectControl
                    value={settings.privacyClassifier ?? "jev"}
                    ariaLabel={t("settings.privacyClassifierChoice")}
                    options={PRIVACY_CLASSIFIERS.map(([value, key]) => ({
                      value,
                      label: t(key),
                    }))}
                    onChange={(privacyClassifier) =>
                      void save({ privacyClassifier })
                    }
                  />
                }
              />
              {healthQuery.data ? (
                <SettingsRow
                  id="jev-credential"
                  label={t("settings.jevCredentialLabel")}
                  control={
                    <span className="text-sm text-muted-foreground">
                      {t(
                        JEV_CREDENTIAL_KEYS[
                          classifier?.jevCredential ?? "none"
                        ],
                      )}
                    </span>
                  }
                />
              ) : null}
              <SettingsRow
                id="quarantine-retention-hours"
                label={t("settings.quarantineRetentionHours")}
                description={t("settings.quarantineRetentionHoursDescription")}
                control={
                  <CommitInput
                    type="number"
                    value={String(settings.quarantineRetentionHours ?? 72)}
                    ariaLabel={t("settings.quarantineRetentionHours")}
                    normalize={clampedInteger(
                      1,
                      720,
                      settings.quarantineRetentionHours ?? 72,
                    )}
                    onCommit={(next) =>
                      void save({ quarantineRetentionHours: Number(next) })
                    }
                  />
                }
              />
            </SettingsGroup>
            <p className="px-1 text-xs leading-5 text-muted-foreground">
              {t("settings.tightenOnly")}
            </p>
          </div>
          <SettingsGroup
            id="brain-privacy-advanced"
            title={t("settings.area.groupAdvanced")}
          >
            <SettingsRow
              id="privacy-classifier-model"
              label={t("settings.privacyClassifierModel")}
              control={
                <CommitInput
                  value={settings.privacyClassifierModel ?? ""}
                  ariaLabel={t("settings.privacyClassifierModel")}
                  placeholder={t("settings.privacyClassifierModelPlaceholder")}
                  normalize={(next) => next.trim()}
                  onCommit={(privacyClassifierModel) =>
                    void save({ privacyClassifierModel })
                  }
                />
              }
            />
            <SettingsRow
              id="privacy-classifier-engine"
              label={t("settings.privacyClassifierEngine")}
              control={
                <CommitInput
                  value={settings.privacyClassifierEngine ?? ""}
                  ariaLabel={t("settings.privacyClassifierEngine")}
                  placeholder={t("settings.privacyClassifierEnginePlaceholder")}
                  normalize={(next) => next.trim()}
                  onCommit={(privacyClassifierEngine) =>
                    void save({ privacyClassifierEngine })
                  }
                />
              }
            />
            <TextDialogRow
              id="sensitivity-custom-instructions"
              label={t("settings.sensitivityCustomInstructions")}
              description={t(
                "settings.sensitivityCustomInstructionsDescription",
              )}
              placeholder={t(
                "settings.sensitivityCustomInstructionsPlaceholder",
              )}
              value={settings.sensitivityCustomInstructions ?? ""}
              onSave={(sensitivityCustomInstructions) =>
                save({ sensitivityCustomInstructions })
              }
            />
            <TextDialogRow
              id="public-channel-exclusion-patterns"
              label={t("settings.publicChannelExclusionPatterns")}
              description={t(
                "settings.publicChannelExclusionPatternsDescription",
              )}
              placeholder={t(
                "settings.publicChannelExclusionPatternsPlaceholder",
              )}
              value={(settings.publicChannelExclusionPatterns ?? []).join("\n")}
              onSave={(next) =>
                save({
                  publicChannelExclusionPatterns: next
                    .split("\n")
                    .map((pattern) => pattern.trim())
                    .filter(Boolean),
                })
              }
            />
          </SettingsGroup>
        </>
      )}
    </AreaFrame>
  );
}

function searchEntry(id: string, label: string, keywords: string) {
  return { id: `brain-${id}`, label, keywords, hash: id };
}

/**
 * Brain's areas, shown as tabs on Brain › General in the redesigned Settings.
 * Ids are the `/settings/app/<id>` segments `settings-navigation.ts` maps
 * today's `?section=` links onto.
 */
export function useBrainSettingsAreas(): SettingsAppArea[] {
  const t = useT();
  const { state, save } = useBrainSettingsState();
  return useMemo(() => {
    const areas: Array<SettingsAppArea & { id: BrainSettingsAreaId }> = [
      {
        id: "identity",
        label: t("settings.identityTitle"),
        icon: IconUsersGroup,
        keywords: "identity company name assistant name",
        searchEntries: [
          searchEntry(
            "company-name",
            t("settings.companyName"),
            "company workspace name",
          ),
          searchEntry(
            "assistant-name",
            t("settings.assistantName"),
            "assistant name",
          ),
        ],
        content: <IdentityArea state={state} save={save} />,
      },
      {
        id: "behavior",
        label: t("settings.area.tabBehavior"),
        icon: IconMessageCircle,
        keywords: "assistant behavior tone source policy instructions",
        searchEntries: [
          searchEntry(
            "assistant-tone",
            t("settings.toneLabel"),
            "tone voice style",
          ),
          searchEntry(
            "source-policy",
            t("settings.sourcePolicyLabel"),
            "strict balanced exploratory",
          ),
          searchEntry(
            "distillation-instructions",
            t("settings.coreInstructions"),
            "distillation instructions",
          ),
        ],
        content: <BehaviorArea state={state} save={save} />,
      },
      {
        id: "publishing",
        label: t("settings.area.tabPublishing"),
        icon: IconAdjustments,
        keywords: "publishing review publish tier approval connector poll",
        searchEntries: [
          searchEntry(
            "publish-tier",
            t("settings.defaultPublishTier"),
            "private team company visibility",
          ),
          searchEntry(
            "require-approval",
            t("settings.requireApproval"),
            "approval review",
          ),
          searchEntry(
            "auto-archive-resolved",
            t("settings.autoArchiveResolved"),
            "archive queue",
          ),
          searchEntry(
            "connector-poll-minutes",
            t("settings.connectorPollInterval"),
            "sync poll connector",
          ),
        ],
        content: <PublishingArea state={state} save={save} />,
      },
      {
        id: "safety",
        label: t("settings.area.tabSafety"),
        icon: IconShieldCheck,
        keywords: "safety evidence sanitize redact citations sources",
        searchEntries: [
          searchEntry(
            "capture-sanitization",
            t("settings.sanitizeCaptures"),
            "sanitize transcripts filter",
          ),
          searchEntry(
            "require-citations",
            t("settings.requireCitations"),
            "citations evidence",
          ),
          searchEntry(
            "auto-redact-emails",
            t("settings.autoRedactEmails"),
            "redact pii",
          ),
          searchEntry(
            "notify-source-errors",
            t("settings.notifySourceErrors"),
            "errors connectors",
          ),
          searchEntry(
            "capture-sanitization-instructions",
            t("settings.sanitizationInstructions"),
            "sanitization instructions",
          ),
        ],
        content: <SafetyArea state={state} save={save} />,
      },
      {
        id: "privacy",
        label: t("settings.area.tabPrivacy"),
        icon: IconLock,
        keywords:
          "privacy sensitivity classifier jev quarantine retention tighten only",
        searchEntries: [
          searchEntry(
            "privacy-classifier-choice",
            t("settings.privacyClassifierChoice"),
            "jev classifier sensitivity",
          ),
          searchEntry(
            "quarantine-retention-hours",
            t("settings.quarantineRetentionHours"),
            "quarantine retention",
          ),
          searchEntry(
            "sensitivity-custom-instructions",
            t("settings.sensitivityCustomInstructions"),
            "sensitivity instructions stricter",
          ),
          searchEntry(
            "public-channel-exclusion-patterns",
            t("settings.publicChannelExclusionPatterns"),
            "slack channel exclusions",
          ),
        ],
        content: <PrivacyArea state={state} save={save} />,
      },
    ];
    return areas;
  }, [save, state, t]);
}
