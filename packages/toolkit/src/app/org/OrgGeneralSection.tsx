import { useActionQuery } from "@agent-native/core/client/hooks";
import { useIconPickerLabels, useT } from "@agent-native/core/client/i18n";
import {
  useOrg,
  useOrgMembers,
  useUpdateOrg,
  useSetOrgVisualIdentity,
  useDeleteOrg,
  useSwitchOrg,
  useSetOrgWorkspaceUrl,
} from "@agent-native/core/client/org";
import {
  uploadWorkspacePrivateIcon,
  workspacePrivateIconLibraryUrl,
  workspacePrivateIconUrl,
} from "@agent-native/core/client/uploads";
import type { IconValue } from "@agent-native/core/icons";
import type { OrgInfo } from "@agent-native/core/org/types";
import { docsUrl } from "@agent-native/core/shared/docs-url";
import type { ModelRow } from "@agent-native/design-system/model";
import {
  combineFragments,
  type ModelFragment,
  ModelSurface,
  rowAttributes,
} from "@agent-native/toolkit/design-system";
import { ResourceIcon, ResourceIconPicker } from "@agent-native/toolkit/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  IconLoader2,
  IconPencil,
  IconX,
  IconAlertTriangle,
  IconUsersGroup,
  IconExternalLink,
} from "@tabler/icons-react";
import { useState } from "react";

import {
  Button,
  ErrorText,
  OrganizationDescription,
  PendingLabel,
  SectionTooltipProvider,
} from "./TeamPrimitives.js";

function OrgNameDisplay({ name, canEdit }: { name: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const updateOrg = useUpdateOrg();

  if (!canEdit) return <div className="text-sm font-medium">{name}</div>;

  if (!editing) {
    return (
      <Button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        className="group flex items-center gap-1.5 text-sm font-medium hover:text-foreground/80"
      >
        {name}
        <IconPencil
          size={12}
          className="text-muted-foreground opacity-0 group-hover:opacity-100"
        />
      </Button>
    );
  }

  function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    updateOrg.mutate(trimmed, { onSuccess: () => setEditing(false) });
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={save}
        className="rounded border border-border bg-background px-1.5 py-0.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-foreground"
        autoFocus
      />
      <ErrorText error={updateOrg.error} />
    </div>
  );
}

/** The workspace URL: the domain the organization's apps are served from. */
export function useWorkspaceUrlFragment({
  workspaceUrl,
}: {
  workspaceUrl: string | null;
}): ModelFragment {
  const t = useT();
  const setWorkspaceUrl = useSetOrgWorkspaceUrl();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workspaceUrl ?? "");

  function save() {
    const trimmed = draft.trim();
    if (trimmed === (workspaceUrl ?? "")) {
      setEditing(false);
      return;
    }
    setWorkspaceUrl.mutate(trimmed || null, {
      onSuccess: () => setEditing(false),
    });
  }

  const description = t(
    "agentChat.settingsOrg.general.workspaceUrlDescription",
  );

  return {
    rows: [
      {
        id: "settings.org.workspace-url",
        part: "settings.row",
        label: t("agentChat.settingsOrg.general.workspaceUrl"),
        description,
        anchor: "workspace-url",
        slot: "workspace-url",
        regions: {
          description: "workspace-url-description",
          ...(setWorkspaceUrl.error ? { detail: "workspace-url-error" } : {}),
        },
      },
    ],
    slots: {
      "workspace-url": !editing ? (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {workspaceUrl ? (
            <>
              <span className="me-1 inline-flex h-8 max-w-72 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm">
                <IconExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{workspaceUrl}</span>
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolkitButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t(
                      "agentChat.settingsOrg.general.editWorkspaceUrl",
                    )}
                    onClick={() => {
                      setDraft(workspaceUrl);
                      setEditing(true);
                    }}
                  >
                    <IconPencil />
                  </ToolkitButton>
                </TooltipTrigger>
                <TooltipContent>
                  {t("agentChat.settingsOrg.general.editWorkspaceUrl")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolkitButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t(
                      "agentChat.settingsOrg.general.removeWorkspaceUrl",
                    )}
                    disabled={setWorkspaceUrl.isPending}
                    onClick={() => setWorkspaceUrl.mutate(null)}
                  >
                    <IconX />
                  </ToolkitButton>
                </TooltipTrigger>
                <TooltipContent>
                  {t("agentChat.settingsOrg.general.removeWorkspaceUrl")}
                </TooltipContent>
              </Tooltip>
            </>
          ) : (
            <ToolkitButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
            >
              {t("agentChat.settingsOrg.general.setWorkspaceUrl")}
            </ToolkitButton>
          )}
        </div>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Input
            type="text"
            size="sm"
            value={draft}
            aria-label={t("agentChat.settingsOrg.general.workspaceUrl")}
            aria-invalid={setWorkspaceUrl.error ? true : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="workspace.example.com"
            className="w-56"
            autoFocus
          />
          <ToolkitButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(false);
              setWorkspaceUrl.reset();
            }}
          >
            {t("agentChat.common.cancel")}
          </ToolkitButton>
          <ToolkitButton
            type="submit"
            size="sm"
            disabled={setWorkspaceUrl.isPending}
          >
            <PendingLabel
              pending={setWorkspaceUrl.isPending}
              label={t("agentChat.common.save")}
              pendingLabel={t("agentChat.common.saving")}
            />
          </ToolkitButton>
        </form>
      ),
      "workspace-url-description": (
        <OrganizationDescription
          help={t("agentChat.settingsOrg.general.workspaceUrlHelp")}
          docsUrl={docsUrl("deployment", {
            campaign: "organization_settings",
            content: "workspace_url",
          })}
        >
          {description}
        </OrganizationDescription>
      ),
      "workspace-url-error": <ErrorText error={setWorkspaceUrl.error} />,
    },
  };
}

export function WorkspaceUrlSettingsSection({
  workspaceUrl,
}: {
  workspaceUrl: string | null;
}) {
  const fragment = useWorkspaceUrlFragment({ workspaceUrl });
  return (
    <ModelSurface
      model={{ id: "settings", rows: fragment.rows }}
      slots={fragment.slots}
    />
  );
}

export function DangerZoneCard({ orgName }: { orgName: string }) {
  const t = useT();
  const deleteOrg = useDeleteOrg();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const canConfirm =
    confirmText.trim().toLowerCase() === orgName.trim().toLowerCase();

  function handleConfirm(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!canConfirm || deleteOrg.isPending) return;
    deleteOrg.mutate(orgName, { onSuccess: () => setOpen(false) });
  }

  return (
    <section className="rounded-lg border border-destructive/40 bg-card p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-destructive">
              {t("org.dangerZone")}
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              <OrganizationDescription help={t("org.deleteOrgDescription")}>
                Delete this organization and all of its members.
              </OrganizationDescription>
            </p>
          </div>
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setConfirmText("");
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                intent="danger"
                emphasis="outline"
                className="cursor-pointer rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                {t("org.deleteOrg")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("org.deleteOrg")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("org.deleteOrgConfirmPrompt", { name: orgName })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={t("org.deleteOrgConfirmPlaceholder")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-destructive"
                autoFocus
              />
              <ErrorText error={deleteOrg.error} />
              <AlertDialogFooter>
                <AlertDialogCancel className="cursor-pointer">
                  {t("org.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={!canConfirm || deleteOrg.isPending}
                  onClick={handleConfirm}
                  className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleteOrg.isPending ? (
                    <span className="inline-flex items-center gap-1.5">
                      <IconLoader2 size={14} className="animate-spin" />
                      {t("org.deleteOrgPending")}
                    </span>
                  ) : (
                    t("org.deleteOrgConfirmCta")
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </section>
  );
}

/** The workspace icon: a picker for owners and admins, the icon otherwise. */
export function OrgIconControl({
  icon,
  canEdit,
  setVisualIdentity,
}: {
  icon: IconValue | null;
  canEdit: boolean;
  setVisualIdentity: ReturnType<typeof useSetOrgVisualIdentity>;
}) {
  const t = useT();
  const iconPickerLabels = useIconPickerLabels();
  const { data: org } = useOrg();
  const uploadedIcons = useActionQuery<{
    assets: Array<{ id: string; alt?: string }>;
  }>("list-workspace-icons", {}, { enabled: canEdit && !!org?.orgId });
  return canEdit ? (
    <ResourceIconPicker
      value={icon}
      uploadedImages={(uploadedIcons.data?.assets ?? []).map((asset) => ({
        version: 1,
        kind: "image",
        authority: "private-icon",
        assetId: asset.id,
        ...(asset.alt ? { alt: asset.alt } : {}),
      }))}
      uploadedImagesError={Boolean(uploadedIcons.error)}
      onUploadedImagesRetry={() => {
        void uploadedIcons.refetch();
      }}
      onValueChange={async (next) => {
        await setVisualIdentity.mutateAsync(next);
      }}
      onUpload={async (file) => {
        const uploaded = await uploadWorkspacePrivateIcon(file);
        void uploadedIcons.refetch();
        return uploaded;
      }}
      formatUploadError={() => iconPickerLabels.uploadFailed}
      resolveImageUrl={(image) =>
        image.assetId === (icon?.kind === "image" ? icon.assetId : null)
          ? workspacePrivateIconUrl(org?.orgId ?? "", image)
          : workspacePrivateIconLibraryUrl(org?.orgId ?? "", image)
      }
      disabled={setVisualIdentity.isPending}
      labels={{
        ...iconPickerLabels,
        trigger: t("org.workspaceIcon", {
          defaultValue: "Workspace icon",
        }),
        iconsTab: t("org.icons", { defaultValue: "Icons" }),
        emojiTab: t("org.emoji", { defaultValue: "Emoji" }),
        uploadTab: t("org.upload", { defaultValue: "Upload" }),
        search: t("org.searchIcons", {
          defaultValue: "Search icons",
        }),
        noResults: t("org.noIconsFound", {
          defaultValue: "No icons found",
        }),
        recents: t("org.recentIcons", {
          defaultValue: "Recent icons",
        }),
        colors: t("org.iconColors", { defaultValue: "Colors" }),
        defaultColor: t("org.defaultColor", {
          defaultValue: "Default",
        }),
        remove: t("org.removeIcon", {
          defaultValue: "Remove icon",
        }),
        upload: t("org.uploadIcon", {
          defaultValue: "Upload icon",
        }),
        uploading: t("org.uploadingIcon", {
          defaultValue: "Uploading…",
        }),
      }}
    >
      <ToolkitButton
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("org.workspaceIcon", {
          defaultValue: "Workspace icon",
        })}
      >
        <ResourceIcon
          value={icon}
          size={16}
          resolveImageUrl={(image) =>
            workspacePrivateIconUrl(org?.orgId ?? "", image)
          }
          fallback={<IconUsersGroup className="size-4 text-muted-foreground" />}
        />
      </ToolkitButton>
    </ResourceIconPicker>
  ) : (
    <ResourceIcon
      value={icon}
      size={16}
      resolveImageUrl={(image) =>
        workspacePrivateIconUrl(org?.orgId ?? "", image)
      }
      fallback={<IconUsersGroup className="size-4 text-muted-foreground" />}
    />
  );
}

function errorLabel(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The "Organization" settings group: icon, name, member count, your role, and
 * the organization switcher. `rows` render inside the group, below the
 * summary row and above the switch error.
 */
export function OrgProfileGroup({
  rows,
}: {
  rows?: ModelFragment | undefined;
}) {
  const t = useT();
  const { data: org } = useOrg();
  const { data: organizationMembersData } = useOrgMembers(0);
  const switchOrg = useSwitchOrg();
  const setVisualIdentity = useSetOrgVisualIdentity();

  if (!org?.orgId) return null;

  const isOwnerOrAdmin = org.role === "owner" || org.role === "admin";
  const totalOrganizationMembers = organizationMembersData?.totalCount;
  const hasMultipleOrgs = (org.orgs?.length ?? 0) > 1;
  const syncPendingLabel = t("org.workspaceIconSyncPending", {
    defaultValue: "Saved here. Other apps may take longer to update.",
  });

  const summary: ModelRow = {
    id: "settings.org.organization.summary",
    part: "settings.row",
    label: org.orgName || t("agentChat.settingsOrg.general.organization"),
    description:
      totalOrganizationMembers === undefined
        ? t("org.youAreRole", { role: org.role })
        : `${t("org.memberCount", { count: totalOrganizationMembers })} · ${t("org.youAreRole", { role: org.role })}`,
    anchor: "organization",
    regions: { label: "organization-name" },
    ...(hasMultipleOrgs ? { slot: "organization-switcher" } : {}),
  };
  const before: ModelRow[] = [summary];
  if (setVisualIdentity.error) {
    before.push({
      id: "settings.org.organization.icon-error",
      part: "settings.content",
      label: errorLabel(setVisualIdentity.error),
      slot: "organization-icon-error",
    });
  }
  if (setVisualIdentity.data?.syncPending) {
    before.push({
      id: "settings.org.organization.icon-sync-pending",
      part: "settings.content",
      label: syncPendingLabel,
      slot: "organization-icon-sync-pending",
    });
  }
  const after: ModelRow[] = switchOrg.error
    ? [
        {
          id: "settings.org.organization.switch-error",
          part: "settings.content",
          label: errorLabel(switchOrg.error),
          slot: "organization-switch-error",
        },
      ]
    : [];
  const content = combineFragments([
    {
      rows: before,
      slots: {
        "organization-name": (
          <span className="flex items-center gap-2">
            <OrgIconControl
              icon={org.icon}
              canEdit={isOwnerOrAdmin}
              setVisualIdentity={setVisualIdentity}
            />
            <OrgNameDisplay name={org.orgName ?? ""} canEdit={isOwnerOrAdmin} />
          </span>
        ),
        "organization-switcher": (
          <Select
            value={org.orgId}
            onValueChange={(value) => switchOrg.mutate(value)}
            disabled={switchOrg.isPending}
          >
            <SelectTrigger
              // guard:allow-part-geometry kept from main until the toolkit migration sizes this Select
              className="h-auto w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs sm:w-auto"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {org.orgs.map((o) => (
                <SelectItem key={o.orgId} value={o.orgId}>
                  {o.orgName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
        "organization-icon-error": (row) => (
          <p {...rowAttributes(row)} className="text-xs text-destructive">
            {row.label}
          </p>
        ),
        "organization-icon-sync-pending": (row) => (
          <p
            {...rowAttributes(row)}
            role="status"
            className="text-xs text-muted-foreground"
          >
            {row.label}
          </p>
        ),
      },
    },
    ...(rows ? [rows] : []),
    {
      rows: after,
      slots: {
        "organization-switch-error": (row) => (
          <div {...rowAttributes(row)} className="px-5 pb-4">
            <p className="text-xs text-destructive">{row.label}</p>
          </div>
        ),
      },
    },
  ]);

  return (
    <ModelSurface
      model={{
        id: "settings",
        rows: [
          {
            id: "settings.org.organization",
            part: "settings.group",
            label: "Organization",
            rows: content.rows,
          },
        ],
      }}
      actions={content.actions}
      slots={content.slots}
    />
  );
}

/**
 * Organization profile (name, icon, role, member count, workspace URL) and,
 * for owners, the danger zone.
 */
export function OrgGeneralSection() {
  const { data: org } = useOrg();

  if (!org?.orgId) return null;

  return <OrgGeneralContent org={org} />;
}

function OrgGeneralContent({ org }: { org: OrgInfo }) {
  const isOwnerOrAdmin = org.role === "owner" || org.role === "admin";
  const workspaceUrl = useWorkspaceUrlFragment({
    workspaceUrl: org.workspaceUrl,
  });

  return (
    <SectionTooltipProvider>
      <div className="space-y-6">
        <OrgProfileGroup rows={isOwnerOrAdmin ? workspaceUrl : undefined} />
        {org.role === "owner" && <DangerZoneCard orgName={org.orgName ?? ""} />}
      </div>
    </SectionTooltipProvider>
  );
}
