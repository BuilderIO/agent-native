import { useT } from "@agent-native/core/client/i18n";
import type {
  SettingsRowTags,
  SettingsSectionDefinition,
} from "@agent-native/toolkit/app/settings";
import { useState } from "react";

import {
  AddDataConnectionDialog,
  WorkspaceSshKeyCard,
  useDataConnectionActions,
  type AddDataConnectionDialogProps,
  type ConnectionValues,
  type ConnectionSchema,
  type DataConnection,
  type ConnectionCanonicalBaseline,
} from "@/components/data";
import { useWorkspaceDataConnectionsSections } from "@/components/data/useWorkspaceDataConnectionsSections";
import { useSettingsSlot } from "@/components/settings/useSettingsSlot";

import {
  ANALYTICS_CONTROL_IDS as controls,
  capabilityAllowed,
} from "../../../shared/analytics-control-ids";

interface EditState {
  connection: DataConnection;
  values: ConnectionValues;
  configuredCredentialFields: readonly string[];
  baseline: ConnectionCanonicalBaseline;
  nativeRevision?: string | undefined;
}

type ConnectionDialogProps = Pick<
  AddDataConnectionDialogProps,
  "schemas" | "resources" | "onSave" | "onTest"
> & {
  /** Present when the dialog was opened on an existing connection. */
  edit: EditState | undefined;
  close: () => void;
  /** The dialog draws its own window and takes no attributes for it, so these are not used. */
  tags: SettingsRowTags;
};

/**
 * The body of the connection dialog: on the type picker for a new connection,
 * on the connection's own form for an edit.
 */
function ConnectionDialog({
  schemas,
  resources,
  onSave,
  onTest,
  edit,
  close,
}: ConnectionDialogProps) {
  return (
    <AddDataConnectionDialog
      isOpen
      schemas={schemas}
      resources={resources}
      onClose={() => close()}
      onSave={onSave}
      onTest={onTest}
      {...(edit
        ? {
            initialType: edit.connection.type,
            initialValues: edit.values,
            connectionId: edit.connection.id,
            isDraft: edit.connection.isDraft,
            baseline: edit.baseline,
            nativeRevision: edit.nativeRevision,
            configuredCredentialFields: edit.configuredCredentialFields,
          }
        : {})}
    />
  );
}

export function useDataConnectionsPageSections(): SettingsSectionDefinition[] {
  const t = useT();
  const {
    access,
    connections,
    schemas,
    sshKey,
    save,
    testConnection,
    getForm,
    onSetDefault,
    onDelete,
    onInviteAdmin,
  } = useDataConnectionActions();
  const canBrowse = capabilityAllowed(
    access.data?.capabilities,
    controls.dataBrowse,
  );
  const canAdd = capabilityAllowed(
    access.data?.capabilities,
    controls.bigQueryConnectionCreate,
  );
  const canManageConnections = access.data?.isAdministrator === true;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [edit, setEdit] = useState<EditState>();
  const [editError, setEditError] = useState<string>();

  const rows = connections.data?.connections ?? [];

  function closeDialog(_connection?: DataConnection) {
    setDialogOpen(false);
    setEdit(undefined);
    setEditError(undefined);
  }

  async function startEdit(connection: DataConnection) {
    setEditError(undefined);
    try {
      const form = await getForm(connection.id);
      setEdit({
        connection: form.connection,
        values: form.values,
        configuredCredentialFields: form.configuredCredentialFields,
        baseline: form.baseline,
        nativeRevision: form.nativeRevision,
      });
      setDialogOpen(true);
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : "Could not load the connection configuration.",
      );
    }
  }

  const body = useSettingsSlot(ConnectionDialog, {
    // The action output keeps optional keys as `| undefined`; the model
    // type is the same validated shape.
    schemas: (schemas.data?.schemas ?? []) as readonly ConnectionSchema[],
    resources: { onInviteAdmin },
    onSave: save,
    onTest: testConnection,
    edit,
  });

  const sshKeyBody = useSettingsSlot(WorkspaceSshKeyCard, {
    publicKey: sshKey?.data?.sshPublicKey,
    loading: sshKey?.isPending,
    error: sshKey?.isError,
    onRetry: sshKey?.refetch ? () => void sshKey.refetch() : undefined,
  });

  const connectionSections = useWorkspaceDataConnectionsSections({
    connections: rows,
    loading: connections.isPending,
    error: connections.isError,
    addDialog: {
      title: "Add a data connection",
      body,
      open: dialogOpen && (edit ? canManageConnections : canAdd),
      disabledReason: canAdd ? undefined : t("dataBrowser.unavailableTitle"),
      setOpen: (open) => {
        if (open) {
          setEdit(undefined);
          setDialogOpen(true);
        } else {
          closeDialog();
        }
      },
    },
    ...(canManageConnections
      ? {
          onEdit: (connection: DataConnection) => void startEdit(connection),
          onSetDefault,
          onDelete,
        }
      : {}),
    ...(canBrowse ? { dataBrowserHref: "/home/data" } : {}),
    notice: editError,
  });

  if (!canManageConnections) return connectionSections;

  return [
    ...connectionSections,
    {
      id: "workspace-ssh-key",
      headingId: "settings-data-sources-ssh-key",
      label: t("sources.workspaceSettings.sshKeyTitle"),
      description: t("sources.workspaceSettings.sshKeyDescription"),
      rows: [
        {
          id: "settings.data-sources.ssh-key",
          kind: "custom",
          label: t("sources.workspaceSettings.sshKeyTitle"),
          reason:
            "Displays the masked workspace SSH public key with reveal and clipboard copy controls.",
          component: sshKeyBody,
        },
      ],
    },
  ];
}
