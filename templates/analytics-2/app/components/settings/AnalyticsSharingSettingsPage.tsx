import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type {
  SettingsRowDefinition,
  SettingsSectionDefinition,
} from "@agent-native/toolkit/app/settings";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_WORKSPACE_SHARING_SETTINGS,
  type WorkspaceSharingSettings,
} from "@/lib/model/sharing-settings-contracts";
import { AppSettingsSections } from "@/skins/app-settings-sections";

export function AnalyticsSharingSettingsPage() {
  const queryClient = useQueryClient();
  const shell = useActionQuery("get-workspace-bootstrap", {}, { retry: 1 });
  const query = useActionQuery("get-organization-sharing-settings", {});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const loading = query.isLoading;
  const unreadable = query.isError || (!loading && !query.data);
  const canEdit =
    shell.data?.features.isAdmin === true && query.data?.canEdit !== false;
  const settings: WorkspaceSharingSettings =
    query.data?.settings ?? DEFAULT_WORKSPACE_SHARING_SETTINGS;
  const capabilities = query.data?.capabilities ?? {
    publicSharingSupported: false,
    guestSharingSupported: false,
  };

  const updateSettings = async (patch: Partial<WorkspaceSharingSettings>) => {
    if (unreadable || !canEdit || saving) return;
    setSaveError("");
    setSaving(true);
    try {
      await callAction("save-organization-sharing-settings", {
        ...settings,
        ...patch,
      });
      await queryClient.invalidateQueries({ queryKey: ["action"] });
    } catch {
      setSaveError("Could not save sharing settings. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const rows: SettingsRowDefinition[] = [
    {
      id: "settings.sharing.share-to-web",
      kind: "toggle",
      label: "Share projects to web",
      description:
        "Allow users with Full access or Can edit project permissions to share projects with the web.",
      condition: {
        disabled:
          loading ||
          unreadable ||
          saving ||
          !canEdit ||
          !capabilities.publicSharingSupported,
        ...(!capabilities.publicSharingSupported
          ? {
              disabledReason:
                "Public web sharing is unavailable in this workspace.",
            }
          : {}),
      },
      binding: {
        value: settings.allowPublicSharing,
        ...(canEdit && capabilities.publicSharingSupported
          ? {
              set: (allowPublicSharing: boolean) =>
                updateSettings({ allowPublicSharing }),
            }
          : {}),
        pending: saving,
        actionName: "save-organization-sharing-settings",
      },
    },
    {
      id: "settings.sharing.share-with-workspace",
      kind: "toggle",
      label: "Share projects with workspace",
      description:
        "Allow users with Full access or Can edit project permissions to share projects with the workspace.",
      condition: {
        disabled: loading || unreadable || saving || !canEdit,
      },
      ...(saveError ? { error: saveError } : {}),
      binding: {
        value: settings.allowWorkspaceSharing,
        ...(canEdit
          ? {
              set: (allowWorkspaceSharing: boolean) =>
                updateSettings({ allowWorkspaceSharing }),
            }
          : {}),
        pending: saving,
        actionName: "save-organization-sharing-settings",
      },
    },
    {
      id: "settings.sharing.share-with-guests",
      kind: "toggle",
      label: "Allow projects to be shared with guests",
      description:
        "When enabled, users can share individual projects with people outside the workspace. Disabling this prevents new guests from being added without removing existing guests.",
      condition: {
        disabled:
          loading ||
          unreadable ||
          saving ||
          !canEdit ||
          !capabilities.guestSharingSupported,
        ...(!capabilities.guestSharingSupported
          ? {
              disabledReason:
                "Invite external collaborators in Users settings first.",
            }
          : {}),
      },
      binding: {
        value: settings.allowGuestCreation,
        ...(canEdit && capabilities.guestSharingSupported
          ? {
              set: (allowGuestCreation: boolean) =>
                updateSettings({ allowGuestCreation }),
            }
          : {}),
        pending: saving,
        actionName: "save-organization-sharing-settings",
      },
    },
  ];

  const sections: SettingsSectionDefinition[] = [
    { id: "sharing-settings", rows },
  ];

  return (
    <section
      aria-label="Sharing settings"
      data-testid="sharing-settings"
      className="space-y-4"
    >
      <div>
        <h2 className="ws-labels-title">Sharing settings</h2>
        <p className="ws-labels-description">
          Who can see and receive links to projects, threads, and published
          apps.
        </p>
      </div>
      {unreadable ? (
        <div className="space-y-2 py-2">
          <p role="alert">Could not load sharing settings.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          <AppSettingsSections
            sections={sections}
            hints={{ frame: "catalog" }}
          />
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Manage workspace members, roles, and invitations.
            </span>
            <Link className="underline" to="/settings/users">
              Manage users
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
