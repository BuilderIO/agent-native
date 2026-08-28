import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import { IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { FactorySourceSettingsGroup } from "./FactorySourceSettingsGroup";

type CreateFactoryResult = {
  ok: boolean;
  factoryId: string;
  name: string;
};

const fieldControlClass = "h-9 w-full sm:w-64";
const selectControlClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64";

export function NewFactoryForm({
  onCreated,
}: {
  onCreated: (factoryId: string) => void;
}) {
  const t = useT();
  const createMutation = useActionMutation("create-factory");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slackWorkspace, setSlackWorkspace] = useState<"primary" | "secondary">(
    "primary",
  );
  const [slackChannelId, setSlackChannelId] = useState("");
  const [slackChannelName, setSlackChannelName] = useState("");
  const [builderSlackUserId, setBuilderSlackUserId] = useState("");
  const [observeSlack, setObserveSlack] = useState(false);
  const [repository, setRepository] = useState("");
  const [observeGithub, setObserveGithub] = useState(false);
  const [sentryOrgSlug, setSentryOrgSlug] = useState("");
  const [sentryProjectSlug, setSentryProjectSlug] = useState("");
  const [sentryEnvironment, setSentryEnvironment] = useState("");
  const [observeSentry, setObserveSentry] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error(t("factoryRoute.createFactoryNameRequired"));
      return;
    }
    const hasSlackFields =
      slackChannelId.trim() ||
      slackChannelName.trim() ||
      builderSlackUserId.trim() ||
      observeSlack ||
      slackWorkspace !== "primary";
    try {
      const result = (await createMutation.mutateAsync({
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(hasSlackFields ? { slackWorkspace } : {}),
        ...(slackChannelId.trim()
          ? { slackChannelId: slackChannelId.trim() }
          : {}),
        ...(slackChannelName.trim()
          ? { slackChannelName: slackChannelName.trim() }
          : {}),
        ...(builderSlackUserId.trim()
          ? { builderSlackUserId: builderSlackUserId.trim() }
          : {}),
        ...(observeSlack ? { observeSlack: true } : {}),
        ...(repository.trim() ? { repository: repository.trim() } : {}),
        ...(observeGithub ? { observeGithub: true } : {}),
        ...(sentryOrgSlug.trim()
          ? { sentryOrgSlug: sentryOrgSlug.trim() }
          : {}),
        ...(sentryProjectSlug.trim()
          ? { sentryProjectSlug: sentryProjectSlug.trim() }
          : {}),
        ...(sentryEnvironment.trim()
          ? { sentryEnvironment: sentryEnvironment.trim() }
          : {}),
        ...(observeSentry ? { observeSentry: true } : {}),
      })) as CreateFactoryResult;
      toast.success(t("factoryRoute.createFactorySuccess"));
      onCreated(result.factoryId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("factoryRoute.createFactoryFailed"),
      );
    }
  }

  return (
    <form
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <SettingsGroup variant="soft">
        <SettingsRow
          label={t("factoryRoute.createFactoryNameLabel")}
          control={
            <Input
              id="new-factory-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("factoryRoute.newFactory")}
              autoFocus
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={
            <span className="flex items-baseline gap-2">
              <span>{t("factoryRoute.createFactoryDescriptionLabel")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t("factoryInspector.optional")}
              </span>
            </span>
          }
        >
          <Textarea
            id="new-factory-description"
            aria-label={t("factoryRoute.createFactoryDescriptionLabel")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
          />
        </SettingsRow>
      </SettingsGroup>
      <FactorySourceSettingsGroup
        title={t("factoryRoute.slackSource")}
        description={t("factoryRoute.slackSourceDescription")}
        optionalLabel={t("factoryInspector.optional")}
      >
        <SettingsRow
          label={t("triage.slackWorkspace")}
          control={
            <select
              aria-label={t("triage.slackWorkspace")}
              value={slackWorkspace}
              onChange={(event) =>
                setSlackWorkspace(event.target.value as "primary" | "secondary")
              }
              className={selectControlClass}
            >
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
            </select>
          }
        />
        <SettingsRow
          label={t("triage.slackChannelId")}
          control={
            <Input
              aria-label={t("triage.slackChannelId")}
              value={slackChannelId}
              onChange={(event) => setSlackChannelId(event.target.value)}
              placeholder={t("triage.slackChannelPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.slackChannelName")}
          control={
            <Input
              aria-label={t("triage.slackChannelName")}
              value={slackChannelName}
              onChange={(event) => setSlackChannelName(event.target.value)}
              placeholder={t("triage.slackChannelNamePlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.builderSlackUserId")}
          control={
            <Input
              aria-label={t("triage.builderSlackUserId")}
              value={builderSlackUserId}
              onChange={(event) => setBuilderSlackUserId(event.target.value)}
              placeholder={t("triage.builderSlackUserIdPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.enablePolling")}
          control={
            <Switch
              aria-label={t("triage.enablePolling")}
              checked={observeSlack}
              onCheckedChange={(checked) => setObserveSlack(checked === true)}
            />
          }
        />
      </FactorySourceSettingsGroup>
      <FactorySourceSettingsGroup
        title={t("factoryRoute.githubSource")}
        description={t("factoryRoute.githubSourceDescription")}
        optionalLabel={t("factoryInspector.optional")}
      >
        <SettingsRow
          label={t("triage.repository")}
          control={
            <Input
              aria-label={t("triage.repository")}
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder={t("triage.repositoryPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.enableGithubPolling")}
          control={
            <Switch
              aria-label={t("triage.enableGithubPolling")}
              checked={observeGithub}
              onCheckedChange={(checked) => setObserveGithub(checked === true)}
            />
          }
        />
      </FactorySourceSettingsGroup>
      <FactorySourceSettingsGroup
        title={t("factoryRoute.sentrySource")}
        description={t("factoryRoute.sentrySourceDescription")}
        optionalLabel={t("factoryInspector.optional")}
      >
        <SettingsRow
          label={t("triage.sentryOrgSlug")}
          control={
            <Input
              aria-label={t("triage.sentryOrgSlug")}
              value={sentryOrgSlug}
              onChange={(event) => setSentryOrgSlug(event.target.value)}
              placeholder={t("triage.sentryOrgPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.sentryProjectSlug")}
          control={
            <Input
              aria-label={t("triage.sentryProjectSlug")}
              value={sentryProjectSlug}
              onChange={(event) => setSentryProjectSlug(event.target.value)}
              placeholder={t("triage.sentryProjectPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.sentryEnvironment")}
          control={
            <Input
              aria-label={t("triage.sentryEnvironment")}
              value={sentryEnvironment}
              onChange={(event) => setSentryEnvironment(event.target.value)}
              placeholder={t("triage.sentryEnvironmentPlaceholder")}
              className={fieldControlClass}
            />
          }
        />
        <SettingsRow
          label={t("triage.enableSentryPolling")}
          control={
            <Switch
              aria-label={t("triage.enableSentryPolling")}
              checked={observeSentry}
              onCheckedChange={(checked) => setObserveSentry(checked === true)}
            />
          }
        />
      </FactorySourceSettingsGroup>
      <div className="flex justify-end gap-2">
        <Button asChild type="button" variant="outline">
          <Link to="/factory">{t("factoryRoute.createFactoryCancel")}</Link>
        </Button>
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : null}
          {t("factoryRoute.createFactorySubmit")}
        </Button>
      </div>
    </form>
  );
}
