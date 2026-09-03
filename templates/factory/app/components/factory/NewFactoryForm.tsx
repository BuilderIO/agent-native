import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import { IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type CreateFactoryResult = {
  ok: boolean;
  factoryId: string;
  name: string;
};

const fieldControlClass = "h-9 w-full sm:w-64";

export function NewFactoryForm({
  onCreated,
}: {
  onCreated: (factoryId: string) => void;
}) {
  const t = useT();
  const createMutation = useActionMutation("create-factory");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

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
      <SettingsGroup
        variant="soft"
        title={t("factoryRoute.createFactoryTitle")}
      >
        <SettingsRow
          label={t("factoryRoute.createFactoryNameLabel")}
          description={t("factoryRoute.createFactoryNameDescription")}
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
          label={t("factoryRoute.createFactoryDescriptionLabel")}
          description={t("factoryRoute.createFactoryDescriptionHelp")}
        >
          <Textarea
            id="new-factory-description"
            aria-label={t("factoryRoute.createFactoryDescriptionLabel")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("factoryRoute.newFactoryDescription")}
            rows={8}
          />
        </SettingsRow>
      </SettingsGroup>

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
