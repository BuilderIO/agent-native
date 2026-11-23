import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  SettingsRowTags,
  SettingsSectionDefinition,
} from "@agent-native/toolkit/app/settings";
import { Button } from "@agent-native/toolkit/ui/button";
import { DialogFooter } from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { useState } from "react";
import { toast } from "sonner";

import { settingsTags } from "@/skins/settings-rows";

import { useSettingsSlot } from "./useSettingsSlot";

const WORKSPACE_NAME_ROW = "settings.general.workspace-name";

interface WorkspaceNameFormProps {
  name: string;
  orgId: string | null;
  saving: boolean;
  save: (input: { name: string; expectedOrgId: string }) => Promise<unknown>;
  refetch: () => Promise<unknown>;
  close: () => void;
  tags: SettingsRowTags;
}

/** The one field of the dialog. It starts on the name and workspace it was opened with. */
function WorkspaceNameForm({
  name,
  orgId,
  saving,
  save,
  refetch,
  close,
  tags,
}: WorkspaceNameFormProps) {
  const t = useT();
  const [editingOrgId] = useState<string | null>(orgId);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving || !draft.trim() || !editingOrgId) return;
        setError(null);
        try {
          await save({
            name: draft.trim(),
            expectedOrgId: editingOrgId,
          });
          await refetch();
          close();
          toast.success(t("analytics.settings.workspaceName.saved"));
        } catch (err) {
          setError(
            actionErrorMessage(err) ??
              t("analytics.settings.workspaceName.saveFailed"),
          );
        }
      }}
      {...tags}
    >
      <label htmlFor="analytics-workspace-name">
        {t("analytics.settings.workspaceName.name")}
      </label>
      <Input
        id="analytics-workspace-name"
        name="workspaceName"
        required
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={saving}
        {...settingsTags(
          `${WORKSPACE_NAME_ROW}.dialog.name`,
          "settings.dialog.field",
        )}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter className="mt-4">
        <Button
          type="submit"
          disabled={!draft.trim() || saving}
          {...settingsTags(
            `${WORKSPACE_NAME_ROW}.dialog.confirm`,
            "settings.dialog.action",
          )}
        >
          {t("analytics.settings.preferences.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function useAnalyticsWorkspaceNameSections({
  editLabel,
}: {
  /** The control's own label; the workspace General page names it in full. */
  editLabel?: string | undefined;
} = {}): SettingsSectionDefinition[] {
  const t = useT();
  const editText = editLabel ?? t("analytics.settings.workspaceName.edit");
  const query = useActionQuery<{
    orgId: string;
    name: string;
    canEdit: boolean;
  }>("get-workspace-name", {});
  const save = useActionMutation<
    { name: string },
    { name: string; expectedOrgId: string }
  >("set-workspace-name");
  const body = useSettingsSlot(WorkspaceNameForm, {
    name: query.data?.name ?? "",
    orgId: query.data?.orgId ?? null,
    saving: save.isPending,
    save: save.mutateAsync,
    refetch: query.refetch,
  });
  return [
    {
      id: "workspace-name",
      label: t("analytics.settings.workspaceName.title"),
      description: t("analytics.settings.workspaceName.description"),
      state: query.isError
        ? {
            status: "error",
            message: t("analytics.settings.workspaceName.loadError"),
            retry: () => void query.refetch(),
            retryLabel: t("analytics.settings.retry"),
          }
        : { status: "ready" },
      rows: [
        {
          id: WORKSPACE_NAME_ROW,
          kind: "action",
          label: t("analytics.settings.workspaceName.title"),
          action: {
            id: "edit",
            label: editText,
            pending: save.isPending,
            condition: {
              disabled: !query.data?.canEdit || query.isLoading,
            },
            trigger: {
              kind: "dialog",
              title: editText,
              description: t("analytics.settings.workspaceName.description"),
              body,
            },
          },
        },
      ],
    },
  ];
}
