import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import { IconAlertCircle, IconX } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  INTERVAL_MINUTES,
  isDestinationReady,
  timezoneOptions,
  type AutomationAuthorFilter,
  type FactoryAutomationConnections,
  type FactoryAutomationFormState,
} from "./factory-automation-form";

const fieldControlClass = "h-9 w-full sm:w-64";

function WorkspaceConnectionBanner({
  title,
  actionLabel,
  href,
}: {
  title: string;
  actionLabel: string;
  href: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2">
        <IconAlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <p className="text-sm font-medium text-destructive">{title}</p>
      </div>
      <Button asChild type="button" size="sm" className="shrink-0">
        <a href={href} target="_blank" rel="noreferrer">
          {actionLabel}
        </a>
      </Button>
    </div>
  );
}

export function FactoryAutomationFields({
  form,
  onChange,
  connections,
  workspaceIntegrationsHref: workspaceIntegrationsHrefProp,
  sourcePicker,
  startFrom,
  modelControl,
  showName = true,
  showSource = true,
  showDestination = true,
  showAuthors = true,
  showSchedule = true,
  showLimits = true,
  showEnabled = true,
  showGuardrails = true,
  showPrompt = true,
  guardrails,
  disabled = false,
}: {
  form: FactoryAutomationFormState;
  onChange: (next: FactoryAutomationFormState) => void;
  connections?: FactoryAutomationConnections;
  workspaceIntegrationsHref?: string;
  sourcePicker?: ReactNode;
  startFrom?: ReactNode;
  modelControl?: ReactNode;
  showName?: boolean;
  showSource?: boolean;
  showDestination?: boolean;
  showAuthors?: boolean;
  showSchedule?: boolean;
  showLimits?: boolean;
  showEnabled?: boolean;
  showGuardrails?: boolean;
  showPrompt?: boolean;
  guardrails?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const [authorDraft, setAuthorDraft] = useState("");
  const destinationReady = isDestinationReady(
    form.source,
    connections,
    form.slackWorkspace,
  );
  const workspaceIntegrationsHref =
    workspaceIntegrationsHrefProp ?? "/dispatch/admin/integrations";
  const showIdentity =
    Boolean(sourcePicker) || (showSource && Boolean(form.source));
  const showRun =
    Boolean(form.source) &&
    (showName ||
      Boolean(startFrom) ||
      showDestination ||
      showAuthors ||
      showSchedule ||
      showLimits ||
      showEnabled ||
      Boolean(modelControl));
  const showInstructions =
    Boolean(form.source) && (showGuardrails || showPrompt);
  const missingBanner =
    form.source === "slack"
      ? {
          title: t("factoryRoute.automationMissingSlack"),
          actionLabel: t("factoryRoute.automationConnectSlack"),
        }
      : form.source === "github"
        ? {
            title: t("factoryRoute.automationMissingGithub"),
            actionLabel: t("factoryRoute.automationConnectGithub"),
          }
        : form.source === "sentry"
          ? {
              title: t("factoryRoute.automationMissingSentry"),
              actionLabel: t("factoryRoute.automationConnectSentry"),
            }
          : null;
  const showMissingBanner = Boolean(missingBanner && !destinationReady);

  function addAuthorId() {
    const id = authorDraft.trim();
    if (!id || form.authorIds.includes(id)) return;
    onChange({ ...form, authorIds: [...form.authorIds, id] });
    setAuthorDraft("");
  }

  function setAuthorFilter(filter: AutomationAuthorFilter) {
    const next =
      form.authorFilter === filter && filter !== "none" ? "none" : filter;
    onChange({
      ...form,
      authorFilter: next,
      authorIds: next === "none" ? [] : form.authorIds,
    });
  }

  const sourceLabel =
    form.source === "slack"
      ? t("factoryRoute.slackSource")
      : form.source === "github"
        ? t("factoryRoute.githubSource")
        : form.source === "sentry"
          ? t("factoryRoute.sentrySource")
          : null;

  return (
    <div className="grid gap-6">
      {showIdentity ? (
        <SettingsGroup
          variant="soft"
          title={t("factoryRoute.automationCardIdentityTitle")}
          description={t("factoryRoute.automationCardIdentityDescription")}
        >
          {sourcePicker ? (
            <SettingsRow
              label={t("factoryRoute.automationSource")}
              description={t("factoryRoute.automationSourceDescription")}
            >
              {sourcePicker}
            </SettingsRow>
          ) : showSource && sourceLabel ? (
            <SettingsRow
              label={t("factoryRoute.automationSource")}
              description={t("factoryRoute.automationSourceDescription")}
              control={
                <span className="text-sm text-muted-foreground">
                  {sourceLabel}
                </span>
              }
            />
          ) : null}
        </SettingsGroup>
      ) : null}

      {showMissingBanner && missingBanner ? (
        <WorkspaceConnectionBanner
          title={missingBanner.title}
          actionLabel={missingBanner.actionLabel}
          href={workspaceIntegrationsHref}
        />
      ) : null}

      {showRun ? (
        <SettingsGroup
          variant="soft"
          title={t("factoryRoute.automationCardRunTitle")}
          description={t("factoryRoute.automationCardRunDescription")}
        >
          {showName ? (
            <SettingsRow
              label={t("factoryRoute.automationDisplayName")}
              description={t("factoryRoute.automationDisplayNameDescription")}
              control={
                <Input
                  id="factory-automation-name"
                  aria-label={t("factoryRoute.automationDisplayName")}
                  value={form.displayName}
                  onChange={(event) =>
                    onChange({ ...form, displayName: event.target.value })
                  }
                  placeholder={t(
                    "factoryRoute.automationDisplayNamePlaceholder",
                  )}
                  disabled={disabled}
                  className={fieldControlClass}
                />
              }
            />
          ) : null}
          {startFrom}
          {showDestination && form.source === "slack" ? (
            <SettingsRow
              label={t("factoryRoute.automationSlackChannel")}
              description={t("factoryRoute.automationSlackChannelDescription")}
              control={
                <Input
                  id="factory-automation-channel"
                  aria-label={t("factoryRoute.automationSlackChannel")}
                  value={form.slackChannelId}
                  onChange={(event) =>
                    onChange({
                      ...form,
                      slackChannelId: event.target.value,
                    })
                  }
                  placeholder={t("triage.slackChannelPlaceholder")}
                  disabled={disabled || !destinationReady}
                  className={fieldControlClass}
                />
              }
            />
          ) : null}
          {showDestination && form.source === "github" ? (
            <SettingsRow
              label={t("factoryRoute.automationRepository")}
              description={t("factoryRoute.automationRepositoryDescription")}
              control={
                <Input
                  id="factory-automation-repo"
                  aria-label={t("factoryRoute.automationRepository")}
                  value={form.repository}
                  onChange={(event) =>
                    onChange({ ...form, repository: event.target.value })
                  }
                  placeholder={t("triage.repositoryPlaceholder")}
                  disabled={disabled || !destinationReady}
                  className={fieldControlClass}
                />
              }
            />
          ) : null}
          {showDestination && form.source === "sentry" ? (
            <>
              <SettingsRow
                label={t("factoryRoute.automationSentryOrg")}
                description={t("factoryRoute.automationSentryOrgDescription")}
                control={
                  <Input
                    id="factory-automation-sentry-org"
                    aria-label={t("factoryRoute.automationSentryOrg")}
                    value={form.sentryOrgSlug}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        sentryOrgSlug: event.target.value,
                      })
                    }
                    placeholder={t("triage.sentryOrgPlaceholder")}
                    disabled={disabled || !destinationReady}
                    className={fieldControlClass}
                  />
                }
              />
              <SettingsRow
                label={t("factoryRoute.automationSentryProject")}
                description={t(
                  "factoryRoute.automationSentryProjectDescription",
                )}
                control={
                  <Input
                    id="factory-automation-sentry-project"
                    aria-label={t("factoryRoute.automationSentryProject")}
                    value={form.sentryProjectSlug}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        sentryProjectSlug: event.target.value,
                      })
                    }
                    placeholder={t("triage.sentryProjectPlaceholder")}
                    disabled={disabled || !destinationReady}
                    className={fieldControlClass}
                  />
                }
              />
            </>
          ) : null}
          {showAuthors && form.source !== "sentry" ? (
            <>
              <SettingsRow
                label={t("factoryRoute.automationAuthors")}
                description={t("factoryRoute.automationAuthorsDescription")}
                control={
                  <div className="flex flex-wrap justify-end gap-2">
                    {(
                      [
                        ["none", "factoryRoute.automationAuthorNone"],
                        ["include", "factoryRoute.automationAuthorInclude"],
                        ["exclude", "factoryRoute.automationAuthorExclude"],
                      ] as const
                    ).map(([mode, key]) => (
                      <Button
                        key={mode}
                        type="button"
                        size="sm"
                        variant={
                          form.authorFilter === mode ? "default" : "outline"
                        }
                        onClick={() => setAuthorFilter(mode)}
                        disabled={disabled}
                      >
                        {t(key)}
                      </Button>
                    ))}
                  </div>
                }
              />
              {form.authorFilter !== "none" ? (
                <SettingsRow
                  label={t("factoryRoute.automationAuthorAdd")}
                  description={t("factoryRoute.automationAuthorIdsDescription")}
                  control={
                    <div className="flex w-full gap-2 sm:w-auto">
                      <Input
                        value={authorDraft}
                        onChange={(event) => setAuthorDraft(event.target.value)}
                        placeholder={
                          form.source === "slack"
                            ? t("factoryRoute.automationAuthorSlackPlaceholder")
                            : t(
                                "factoryRoute.automationAuthorGithubPlaceholder",
                              )
                        }
                        disabled={disabled}
                        className={fieldControlClass}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addAuthorId();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addAuthorId}
                        disabled={disabled}
                      >
                        {t("factoryRoute.automationAuthorAdd")}
                      </Button>
                    </div>
                  }
                >
                  {form.authorIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {form.authorIds.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                        >
                          {id}
                          <button
                            type="button"
                            className="text-muted-foreground"
                            onClick={() =>
                              onChange({
                                ...form,
                                authorIds: form.authorIds.filter(
                                  (entry) => entry !== id,
                                ),
                              })
                            }
                            disabled={disabled}
                            aria-label={t(
                              "factoryRoute.automationAuthorRemove",
                            )}
                          >
                            <IconX className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </SettingsRow>
              ) : null}
            </>
          ) : null}
          {showSchedule ? (
            <>
              <SettingsRow
                label={t("factoryRoute.automationSchedule")}
                description={t(
                  "factoryRoute.automationScheduleModeDescription",
                )}
                control={
                  <select
                    id="factory-automation-schedule"
                    aria-label={t("factoryRoute.automationSchedule")}
                    value={
                      form.scheduleMode === "daily"
                        ? "daily"
                        : String(form.intervalMinutes)
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "daily") {
                        onChange({ ...form, scheduleMode: "daily" });
                        return;
                      }
                      onChange({
                        ...form,
                        scheduleMode: "interval",
                        intervalMinutes: Number(
                          value,
                        ) as FactoryAutomationFormState["intervalMinutes"],
                      });
                    }}
                    disabled={disabled}
                    className={`${fieldControlClass} rounded-md border bg-card px-3 text-sm`}
                  >
                    {INTERVAL_MINUTES.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {t("factoryRoute.automationEveryMinutes", {
                          count: minutes,
                        })}
                      </option>
                    ))}
                    <option value="daily">
                      {t("factoryRoute.automationScheduleDaily")}
                    </option>
                  </select>
                }
              />
              {form.scheduleMode === "daily" ? (
                <>
                  <SettingsRow
                    label={t("factoryRoute.automationDailyTime")}
                    description={t(
                      "factoryRoute.automationDailyTimeDescription",
                    )}
                    control={
                      <Input
                        id="factory-automation-daily-time"
                        aria-label={t("factoryRoute.automationDailyTime")}
                        type="time"
                        value={form.dailyTime}
                        onChange={(event) =>
                          onChange({
                            ...form,
                            dailyTime: event.target.value,
                          })
                        }
                        disabled={disabled}
                        className={fieldControlClass}
                      />
                    }
                  />
                  <SettingsRow
                    label={t("factoryRoute.automationTimezone")}
                    description={t(
                      "factoryRoute.automationTimezoneDescription",
                    )}
                    control={
                      <select
                        id="factory-automation-timezone"
                        aria-label={t("factoryRoute.automationTimezone")}
                        value={form.timezone}
                        onChange={(event) =>
                          onChange({
                            ...form,
                            timezone: event.target.value,
                          })
                        }
                        disabled={disabled}
                        className={`${fieldControlClass} rounded-md border bg-card px-3 text-sm`}
                      >
                        {timezoneOptions().map((zone) => (
                          <option key={zone} value={zone}>
                            {zone}
                          </option>
                        ))}
                      </select>
                    }
                  />
                </>
              ) : null}
            </>
          ) : null}
          {showLimits ? (
            <>
              <SettingsRow
                label={t("factoryRoute.automationInboxLimit")}
                description={t("factoryRoute.automationInboxLimitDescription")}
                control={
                  <Input
                    id="factory-automation-inbox-limit"
                    aria-label={t("factoryRoute.automationInboxLimit")}
                    type="number"
                    min={1}
                    max={50}
                    value={form.inboxLimit}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        inboxLimit: Number(event.target.value) || 1,
                      })
                    }
                    disabled={disabled}
                    className={fieldControlClass}
                  />
                }
              />
              <SettingsRow
                label={t("factoryRoute.automationWorkLimit")}
                description={t("factoryRoute.automationWorkLimitDescription")}
                control={
                  <Input
                    id="factory-automation-work-limit"
                    aria-label={t("factoryRoute.automationWorkLimit")}
                    type="number"
                    min={1}
                    max={10}
                    value={form.workLimit}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        workLimit: Number(event.target.value) || 1,
                      })
                    }
                    disabled={disabled}
                    className={fieldControlClass}
                  />
                }
              />
            </>
          ) : null}
          {modelControl}
          {showEnabled ? (
            <SettingsRow
              label={t("factoryRoute.automationEnabledLabel")}
              description={t("factoryRoute.automationEnabledDescription")}
              control={
                <Switch
                  aria-label={t("factoryRoute.automationEnabledLabel")}
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    onChange({ ...form, enabled: checked === true })
                  }
                  disabled={disabled}
                />
              }
            />
          ) : null}
        </SettingsGroup>
      ) : null}

      {showInstructions ? (
        <SettingsGroup
          variant="soft"
          title={t("factoryRoute.automationCardPromptTitle")}
          description={t("factoryRoute.automationCardPromptDescription")}
        >
          {showGuardrails ? (
            <SettingsRow
              label={t("factoryRoute.automationGuardrails")}
              description={t("factoryRoute.automationGuardrailsDescription")}
            >
              <div className="grid gap-2">
                <p className="text-xs text-muted-foreground">
                  {t("factoryRoute.automationGuardrailsSummary", {
                    inbox: form.inboxLimit,
                    work: form.workLimit,
                  })}
                </p>
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {guardrails ||
                    t("factoryRoute.automationGuardrailsPlaceholder")}
                </pre>
              </div>
            </SettingsRow>
          ) : null}
          {showPrompt ? (
            <SettingsRow
              label={t("factoryRoute.automationPrompt")}
              description={t("factoryRoute.automationPromptDescription")}
            >
              <Textarea
                id="factory-automation-prompt"
                value={form.prompt}
                onChange={(event) =>
                  onChange({ ...form, prompt: event.target.value })
                }
                placeholder={t("factoryRoute.automationPromptPlaceholder")}
                rows={10}
                disabled={disabled}
              />
            </SettingsRow>
          ) : null}
        </SettingsGroup>
      ) : null}
    </div>
  );
}
