import { Skeleton } from "@agent-native/toolkit/design-system";
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
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { IconLoader2, IconLock } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import type { OrgInfo } from "../../../org/types.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { useT } from "../../i18n.js";
import { SettingsGroup, SettingsRow } from "../../settings/SettingsRow.js";
import { useSettingsShell } from "../../settings/shell/context.js";
import { settingsPageHref } from "../../settings/shell/routing.js";
import {
  useDeleteOrg,
  useOrgMembers,
  useSetOrgVisualIdentity,
  useUpdateOrg,
} from "../hooks.js";
import {
  OrgIconControl,
  WorkspaceUrlSettingsSection,
} from "../OrgGeneralSection.js";
import {
  JoinByDomainCard,
  PendingInvitationsCard,
} from "../TeamOnboardingCards.js";
import { ErrorText } from "../TeamPrimitives.js";
import { OrgPageGate, orgRoleLabel } from "./OrgPageGate.js";

function OrgNameControl({ org }: { org: OrgInfo }) {
  const t = useT();
  const updateOrg = useUpdateOrg();
  const setVisualIdentity = useSetOrgVisualIdentity();
  const canEdit = org.role === "owner" || org.role === "admin";
  const name = org.orgName ?? "";
  const [draft, setDraft] = useState(name);

  useEffect(() => setDraft(name), [name]);

  function save() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(name);
      return;
    }
    if (trimmed === name) return;
    updateOrg.mutate(trimmed, { onError: () => setDraft(name) });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <OrgIconControl
          icon={org.icon}
          canEdit={canEdit}
          setVisualIdentity={setVisualIdentity}
        />
        {canEdit ? (
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setDraft(name);
            }}
            aria-label={t("agentChat.settingsOrg.general.name")}
            disabled={updateOrg.isPending}
            className="h-9 w-56"
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                {name}
                <IconLock
                  className="size-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("agentChat.settingsOrg.general.nameLocked")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <ErrorText error={updateOrg.error ?? setVisualIdentity.error} />
    </div>
  );
}

function MemberCountLink() {
  const t = useT();
  const { navigate } = useSettingsShell();
  const members = useOrgMembers(0);

  if (members.error) return <ErrorText error={members.error} />;
  if (members.data === undefined) return <Skeleton className="h-4 w-20" />;

  return (
    <a
      href={settingsPageHref("members")}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate("members");
      }}
      className="text-sm text-primary underline-offset-4 hover:underline"
    >
      {t("org.memberCount", { count: members.data.totalCount })}
    </a>
  );
}

function DeleteOrganizationButton({ orgName }: { orgName: string }) {
  const t = useT();
  const deleteOrg = useDeleteOrg();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const canConfirm =
    confirmText.trim().toLowerCase() === orgName.trim().toLowerCase();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmText("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          {t("org.deleteOrg")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("org.deleteOrg")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("org.deleteOrgDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="grid gap-1.5 text-sm">
          <span>{t("org.deleteOrgConfirmPrompt", { name: orgName })}</span>
          <Input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={t("org.deleteOrgConfirmPlaceholder")}
            autoFocus
          />
        </label>
        <ErrorText error={deleteOrg.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>{t("org.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm || deleteOrg.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (!canConfirm || deleteOrg.isPending) return;
              deleteOrg.mutate(orgName, { onSuccess: () => setOpen(false) });
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteOrg.isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <IconLoader2 className="size-3.5 animate-spin" />
                {t("org.deleteOrgPending")}
              </span>
            ) : (
              t("org.deleteOrgConfirmCta")
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function OrgGeneralContent({ org }: { org: OrgInfo }) {
  const t = useT();
  const isOwnerOrAdmin = org.role === "owner" || org.role === "admin";
  const orgName = org.orgName ?? "";

  return (
    <div className="space-y-8">
      <PendingInvitationsCard />
      {org.domainMatches?.length ? (
        <JoinByDomainCard matches={org.domainMatches} />
      ) : null}
      <SettingsGroup
        id="organization"
        title={t("agentChat.settingsOrg.general.organization")}
      >
        <SettingsRow
          id="organization-name"
          label={t("agentChat.settingsOrg.general.name")}
          control={<OrgNameControl org={org} />}
        />
        {isOwnerOrAdmin && (
          <WorkspaceUrlSettingsSection workspaceUrl={org.workspaceUrl} />
        )}
      </SettingsGroup>
      <SettingsGroup
        id="membership"
        title={t("agentChat.settingsOrg.general.membership")}
      >
        <SettingsRow
          id="your-role"
          label={t("agentChat.settingsOrg.general.yourRole")}
          control={
            <span className="text-sm text-muted-foreground">
              {orgRoleLabel(org.role, t)}
            </span>
          }
        />
        <SettingsRow
          id="member-count"
          label={t("org.members")}
          control={<MemberCountLink />}
        />
      </SettingsGroup>
      {org.role === "owner" && (
        <SettingsGroup id="danger-zone" title={t("org.dangerZone")}>
          <SettingsRow
            id="delete-organization"
            label={t("org.deleteOrg")}
            description={t("agentChat.settingsOrg.general.deleteDescription", {
              name: orgName,
            })}
            control={<DeleteOrganizationButton orgName={orgName} />}
          />
        </SettingsGroup>
      )}
    </div>
  );
}

/** Organization › General: name, your role, member count, and deletion. */
export function OrgGeneralPage() {
  return (
    <OrgPageGate skeletonRows={3}>
      {(org) => <OrgGeneralContent key={org.orgId} org={org} />}
    </OrgPageGate>
  );
}
