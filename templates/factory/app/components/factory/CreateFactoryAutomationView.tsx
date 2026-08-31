import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsRow } from "@agent-native/core/client/settings";
import { IconArrowLeft, IconLoader2 } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import {
  canCreateFactoryAutomation,
  defaultWorkLimit,
  dispatchIntegrationsHref,
  emptyAutomationForm,
  parseDailyTime,
  persistAuthorFilter,
  type AutomationSource,
  type AutomationTemplateId,
  type FactoryAutomationConnections,
  type FactoryAutomationFormState,
} from "./factory-automation-form";
import { FactoryAutomationFields } from "./FactoryAutomationFields";

type Template = {
  id: AutomationTemplateId;
  source: AutomationSource | null;
  prompt: string;
  scheduleMode: "interval" | "daily";
  intervalMinutes: number;
  dailyHour: number;
  dailyMinute: number;
  timezone: string | null;
  inboxLimit: number;
  workLimit: number;
};

type CreateResult = {
  id: string;
};

export function CreateFactoryAutomationView({
  factoryId,
  onCancel,
  onCreated,
}: {
  factoryId: string;
  onCancel: () => void;
  onCreated: (automationId: string) => void;
}) {
  const t = useT();
  const [form, setForm] = useState<FactoryAutomationFormState>(
    emptyAutomationForm(),
  );
  const createMutation = useActionMutation("create-factory-automation");
  const templatesQuery = useActionQuery<Template[]>(
    "list-factory-automation-templates",
    { source: form.source },
    { enabled: Boolean(form.source) },
  );
  const configQuery = useActionQuery<{
    connections?: FactoryAutomationConnections;
  }>("get-triage-config", { factoryId });
  const appsQuery = useActionQuery("list-workspace-apps", {
    includeAgentCards: false,
  });
  const templates = useMemo(
    () => templatesQuery.data ?? [],
    [templatesQuery.data],
  );
  const authors = persistAuthorFilter(form.authorFilter, form.authorIds);
  const connections = configQuery.data?.connections;
  const canCreate = canCreateFactoryAutomation(form, connections);
  const workspaceIntegrationsHref = dispatchIntegrationsHref(appsQuery.data);

  function applyTemplate(templateId: AutomationTemplateId) {
    const template = templates.find((entry) => entry.id === templateId);
    setForm((current) => ({
      ...current,
      template: templateId,
      prompt: template?.prompt ?? current.prompt,
      inboxLimit: template?.inboxLimit ?? current.inboxLimit,
      workLimit: template?.workLimit ?? current.workLimit,
      scheduleMode: template?.scheduleMode ?? current.scheduleMode,
      intervalMinutes:
        (template?.intervalMinutes as FactoryAutomationFormState["intervalMinutes"]) ??
        current.intervalMinutes,
      dailyTime: template
        ? `${String(template.dailyHour).padStart(2, "0")}:${String(template.dailyMinute).padStart(2, "0")}`
        : current.dailyTime,
      timezone: template?.timezone ?? current.timezone,
    }));
  }

  async function handleCreate() {
    if (!form.source) return;
    const daily = parseDailyTime(form.dailyTime);
    try {
      const result = (await createMutation.mutateAsync({
        factoryId,
        displayName: form.displayName.trim(),
        source: form.source,
        template: form.template,
        slackWorkspace: form.slackWorkspace,
        slackChannelId: form.slackChannelId.trim() || undefined,
        slackChannelName: form.slackChannelName.trim() || undefined,
        repository: form.repository.trim() || undefined,
        sentryOrgSlug: form.sentryOrgSlug.trim() || undefined,
        sentryProjectSlug: form.sentryProjectSlug.trim() || undefined,
        sentryEnvironment: form.sentryEnvironment.trim() || undefined,
        authorMode: authors.authorMode,
        authorIds: authors.authorIds,
        scheduleMode: form.scheduleMode,
        intervalMinutes: form.intervalMinutes,
        dailyHour: daily.dailyHour,
        dailyMinute: daily.dailyMinute,
        timezone: form.scheduleMode === "daily" ? form.timezone : undefined,
        inboxLimit: form.inboxLimit,
        workLimit: form.workLimit,
        prompt: form.prompt.trim() || undefined,
        enabled: form.enabled,
      })) as CreateResult;
      toast.success(t("factoryRoute.automationCreated"));
      onCreated(result.id);
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("factoryRoute.automationCreateFailed"),
      );
    }
  }

  const sources: AutomationSource[] = ["slack", "github", "sentry"];

  function templateLabel(id: AutomationTemplateId) {
    return id === "blank"
      ? t("factoryRoute.automationTemplateBlank")
      : id === "slack-feedback"
        ? t("factoryRoute.automationTemplateSlackFeedback")
        : id === "github-issues"
          ? t("factoryRoute.automationTemplateGithubIssues")
          : id === "pr-governance"
            ? t("factoryRoute.automationTemplatePrGovernance")
            : id === "pr-babysit"
              ? t("factoryRoute.automationTemplatePrBabysit")
              : t("factoryRoute.automationTemplateSentryErrors");
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center">
        <Button
          type="button"
          variant="ghost"
          className="gap-2 px-2"
          onClick={onCancel}
        >
          <IconArrowLeft className="size-4" />
          {t("factoryRoute.automationsTitle")}
        </Button>
      </div>

      <FactoryAutomationFields
        form={form}
        onChange={setForm}
        connections={connections}
        workspaceIntegrationsHref={workspaceIntegrationsHref}
        showGuardrails
        guardrails={t("factoryRoute.automationGuardrailsSummary", {
          inbox: form.inboxLimit,
          work: form.workLimit,
        })}
        sourcePicker={
          <div className="grid gap-2 sm:grid-cols-3">
            {sources.map((source) => (
              <button
                key={source}
                type="button"
                className={`rounded-lg border p-3 text-left text-sm ${
                  form.source === source
                    ? "border-primary bg-primary/10"
                    : "hover:bg-muted/50"
                }`}
                onClick={() =>
                  setForm({
                    ...emptyAutomationForm(source),
                    displayName: form.displayName,
                    enabled: form.enabled,
                    source,
                    workLimit: defaultWorkLimit(source),
                  })
                }
              >
                <span className="font-medium">
                  {source === "slack"
                    ? t("factoryRoute.slackSource")
                    : source === "github"
                      ? t("factoryRoute.githubSource")
                      : t("factoryRoute.sentrySource")}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {source === "slack"
                    ? t("factoryRoute.automationSourceSlackHint")
                    : source === "github"
                      ? t("factoryRoute.automationSourceGithubHint")
                      : t("factoryRoute.automationSourceSentryHint")}
                </span>
              </button>
            ))}
          </div>
        }
        startFrom={
          form.source ? (
            <SettingsRow
              label={t("factoryRoute.automationStartFrom")}
              description={t("factoryRoute.automationStartFromDescription")}
              control={
                <select
                  id="factory-automation-template"
                  aria-label={t("factoryRoute.automationStartFrom")}
                  value={form.template}
                  onChange={(event) =>
                    applyTemplate(event.target.value as AutomationTemplateId)
                  }
                  disabled={templatesQuery.isLoading && templates.length === 0}
                  className="h-9 w-full rounded-md border bg-card px-3 text-sm sm:w-64"
                >
                  {templates.length === 0 ? (
                    <option value={form.template}>
                      {templateLabel(form.template)}
                    </option>
                  ) : null}
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {templateLabel(template.id)}
                    </option>
                  ))}
                </select>
              }
            />
          ) : null
        }
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("factoryRoute.createAutomationCancel")}
        </Button>
        <Button
          type="button"
          onClick={() => void handleCreate()}
          disabled={createMutation.isPending || !canCreate}
        >
          {createMutation.isPending ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : null}
          {t("factoryRoute.createAutomationSubmit")}
        </Button>
      </div>
    </div>
  );
}
