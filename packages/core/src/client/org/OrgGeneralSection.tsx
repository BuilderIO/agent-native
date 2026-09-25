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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  IconLoader2,
  IconPencil,
  IconX,
  IconAlertTriangle,
  IconUsersGroup,
  IconExternalLink,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import type { IconValue } from "../../icons/index.js";
import { docsUrl } from "../../shared/docs-url.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useIconPickerLabels, useT } from "../i18n.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import { uploadEditorImage } from "../uploads/index.js";
import {
  useOrg,
  useOrgMembers,
  useUpdateOrg,
  useSetOrgVisualIdentity,
  useDeleteOrg,
  useSwitchOrg,
  useSetOrgWorkspaceUrl,
} from "./hooks.js";
import {
  Button,
  ErrorText,
  OrganizationDescription,
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

export function WorkspaceUrlSettingsSection({
  workspaceUrl,
}: {
  workspaceUrl: string | null;
}) {
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

  return (
    <SettingsRow
      id="workspace-url"
      label="Workspace URL"
      description={
        <OrganizationDescription
          help="Members who land on another deployment can be sent to this workspace URL instead of an empty app."
          docsUrl={docsUrl("deployment", {
            campaign: "organization_settings",
            content: "workspace_url",
          })}
        >
          Send members to this workspace from another deployment.
        </OrganizationDescription>
      }
      control={
        !editing ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {workspaceUrl ? (
              <>
                <span className="inline-flex max-w-72 items-center gap-1.5 truncate rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                  <IconExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{workspaceUrl}</span>
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      onClick={() => {
                        setDraft(workspaceUrl);
                        setEditing(true);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <IconPencil size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit workspace URL</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      intent="danger"
                      emphasis="ghost"
                      disabled={setWorkspaceUrl.isPending}
                      onClick={() => setWorkspaceUrl.mutate(null)}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <IconX size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove workspace URL</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Button
                type="button"
                intent="neutral"
                emphasis="outline"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
              >
                Set URL
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="workspace.example.com"
              className="w-56 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              autoFocus
            />
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              disabled={setWorkspaceUrl.isPending}
              onClick={save}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {setWorkspaceUrl.isPending ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              type="button"
              intent="neutral"
              emphasis="outline"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        )
      }
    >
      {setWorkspaceUrl.error ? (
        <ErrorText error={setWorkspaceUrl.error} />
      ) : null}
    </SettingsRow>
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
  return canEdit ? (
    <ResourceIconPicker
      value={icon}
      onValueChange={async (next) => {
        await setVisualIdentity.mutateAsync(next);
      }}
      onUpload={async (file) => {
        const uploaded = await uploadEditorImage(file);
        return {
          version: 1,
          kind: "image",
          authority: "url",
          assetId: uploaded.src,
          alt: uploaded.alt || file.name,
        };
      }}
      resolveImageUrl={(image) =>
        image.authority === "url" ? image.assetId : undefined
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
      <Button
        type="button"
        className="flex size-7 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("org.workspaceIcon", {
          defaultValue: "Workspace icon",
        })}
      >
        <ResourceIcon
          value={icon}
          size={16}
          resolveImageUrl={(image) =>
            image.authority === "url" ? image.assetId : undefined
          }
          fallback={<IconUsersGroup className="size-4 text-muted-foreground" />}
        />
      </Button>
    </ResourceIconPicker>
  ) : (
    <ResourceIcon
      value={icon}
      size={16}
      resolveImageUrl={(image) =>
        image.authority === "url" ? image.assetId : undefined
      }
      fallback={<IconUsersGroup className="size-4 text-muted-foreground" />}
    />
  );
}

/**
 * The "Organization" settings group: icon, name, member count, your role, and
 * the organization switcher. `children` render inside the group, below the
 * summary row and above the switch error.
 */
export function OrgProfileGroup({ children }: { children?: ReactNode }) {
  const t = useT();
  const { data: org } = useOrg();
  const { data: organizationMembersData } = useOrgMembers(0);
  const switchOrg = useSwitchOrg();
  const setVisualIdentity = useSetOrgVisualIdentity();

  if (!org?.orgId) return null;

  const isOwnerOrAdmin = org.role === "owner" || org.role === "admin";
  const totalOrganizationMembers = organizationMembersData?.totalCount;
  const hasMultipleOrgs = (org.orgs?.length ?? 0) > 1;

  return (
    <SettingsGroup title="Organization">
      <SettingsRow
        id="organization"
        label={
          <span className="flex items-center gap-2">
            <OrgIconControl
              icon={org.icon}
              canEdit={isOwnerOrAdmin}
              setVisualIdentity={setVisualIdentity}
            />
            <OrgNameDisplay name={org.orgName ?? ""} canEdit={isOwnerOrAdmin} />
          </span>
        }
        description={
          totalOrganizationMembers === undefined
            ? t("org.youAreRole", { role: org.role })
            : `${t("org.memberCount", { count: totalOrganizationMembers })} · ${t("org.youAreRole", { role: org.role })}`
        }
        control={
          hasMultipleOrgs ? (
            <Select
              value={org.orgId ?? ""}
              onValueChange={(value) => switchOrg.mutate(value || null)}
              disabled={switchOrg.isPending}
            >
              <SelectTrigger className="h-auto w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs sm:w-auto">
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
          ) : undefined
        }
      />
      <ErrorText error={setVisualIdentity.error} />
      {setVisualIdentity.data?.syncPending && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("org.workspaceIconSyncPending", {
            defaultValue: "Saved here. Other apps may take longer to update.",
          })}
        </p>
      )}

      {children}

      {switchOrg.error && (
        <div className="px-5 pb-4">
          <ErrorText error={switchOrg.error} />
        </div>
      )}
    </SettingsGroup>
  );
}

/**
 * Organization profile (name, icon, role, member count, workspace URL) and,
 * for owners, the danger zone.
 */
export function OrgGeneralSection() {
  const { data: org } = useOrg();

  if (!org?.orgId) return null;

  const isOwnerOrAdmin = org.role === "owner" || org.role === "admin";

  return (
    <SectionTooltipProvider>
      <div className="space-y-6">
        <OrgProfileGroup>
          {isOwnerOrAdmin && (
            <WorkspaceUrlSettingsSection workspaceUrl={org.workspaceUrl} />
          )}
        </OrgProfileGroup>
        {org.role === "owner" && <DangerZoneCard orgName={org.orgName ?? ""} />}
      </div>
    </SectionTooltipProvider>
  );
}
