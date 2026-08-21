import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconBrandGithub,
  IconBrandSlack,
  IconLoader2,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type CreateFactoryResult = {
  ok: boolean;
  factoryId: string;
  name: string;
};

export function NewFactoryForm({
  onCreated,
}: {
  onCreated: (factoryId: string) => void;
}) {
  const t = useT();
  const createMutation = useActionMutation("create-factory");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slackChannelId, setSlackChannelId] = useState("");
  const [slackChannelName, setSlackChannelName] = useState("");
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
    try {
      const result = (await createMutation.mutateAsync({
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(slackChannelId.trim()
          ? { slackChannelId: slackChannelId.trim() }
          : {}),
        ...(slackChannelName.trim()
          ? { slackChannelName: slackChannelName.trim() }
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
      className="mx-auto flex w-full max-w-2xl flex-col gap-6"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div className="space-y-2">
        <Label htmlFor="new-factory-name">
          {t("factoryRoute.createFactoryNameLabel")}
        </Label>
        <Input
          id="new-factory-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("factoryRoute.newFactory")}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-factory-description">
          {t("factoryRoute.createFactoryDescriptionLabel")}
        </Label>
        <Textarea
          id="new-factory-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
        />
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader className="px-4 pb-0 pt-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconBrandSlack className="size-4" />
              {t("factoryRoute.createFactorySlackSourceOptional")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4">
            <div className="space-y-2">
              <Label htmlFor="new-factory-slack-channel">
                {t("triage.slackChannelId")}
              </Label>
              <Input
                id="new-factory-slack-channel"
                value={slackChannelId}
                onChange={(event) => setSlackChannelId(event.target.value)}
                placeholder={t("triage.slackChannelPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-factory-slack-channel-name">
                {t("triage.slackChannelName")}
              </Label>
              <Input
                id="new-factory-slack-channel-name"
                value={slackChannelName}
                onChange={(event) => setSlackChannelName(event.target.value)}
                placeholder={t("triage.slackChannelNamePlaceholder")}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="new-factory-observe-slack">
                {t("factoryRoute.createFactoryObserveSlack")}
              </Label>
              <Switch
                id="new-factory-observe-slack"
                checked={observeSlack}
                onCheckedChange={(checked) => setObserveSlack(checked === true)}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-4 pb-0 pt-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconBrandGithub className="size-4" />
              {t("factoryRoute.createFactoryGithubSourceOptional")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4">
            <div className="space-y-2">
              <Label htmlFor="new-factory-repository">
                {t("triage.repository")}
              </Label>
              <Input
                id="new-factory-repository"
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                placeholder={t("triage.repositoryPlaceholder")}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="new-factory-observe-github">
                {t("factoryRoute.createFactoryObserveGithub")}
              </Label>
              <Switch
                id="new-factory-observe-github"
                checked={observeGithub}
                onCheckedChange={(checked) =>
                  setObserveGithub(checked === true)
                }
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-4 pb-0 pt-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconAlertCircle className="size-4" />
              {t("factoryRoute.createFactorySentrySourceOptional")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4">
            <div className="space-y-2">
              <Label htmlFor="new-factory-sentry-org">
                {t("triage.sentryOrgSlug")}
              </Label>
              <Input
                id="new-factory-sentry-org"
                value={sentryOrgSlug}
                onChange={(event) => setSentryOrgSlug(event.target.value)}
                placeholder={t("triage.sentryOrgPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-factory-sentry-project">
                {t("triage.sentryProjectSlug")}
              </Label>
              <Input
                id="new-factory-sentry-project"
                value={sentryProjectSlug}
                onChange={(event) => setSentryProjectSlug(event.target.value)}
                placeholder={t("triage.sentryProjectPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-factory-sentry-environment">
                {t("triage.sentryEnvironment")}
              </Label>
              <Input
                id="new-factory-sentry-environment"
                value={sentryEnvironment}
                onChange={(event) => setSentryEnvironment(event.target.value)}
                placeholder={t("triage.sentryEnvironmentPlaceholder")}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="new-factory-observe-sentry">
                {t("factoryRoute.createFactoryObserveSentry")}
              </Label>
              <Switch
                id="new-factory-observe-sentry"
                checked={observeSentry}
                onCheckedChange={(checked) =>
                  setObserveSentry(checked === true)
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>
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
