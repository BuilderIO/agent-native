import { Skeleton } from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { IconLock } from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";

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
  OrgIconStorageNotice,
  WorkspaceUrlSettingsSection,
} from "../OrgGeneralSection.js";
import {
  JoinByDomainCard,
  PendingInvitationsCard,
} from "../TeamOnboardingCards.js";
import {
  DialogErrorAlert,
  ErrorText,
  PendingLabel,
} from "../TeamPrimitives.js";
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
            size="sm"
            className="w-56"
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
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const canConfirm =
    confirmText.trim().toLowerCase() === orgName.trim().toLowerCase();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setConfirmText("");
      deleteOrg.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline-destructive" size="sm">
          {t("org.deleteOrg")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canConfirm || deleteOrg.isPending) return;
            deleteOrg.mutate(orgName, { onSuccess: () => setOpen(false) });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("org.deleteOrg")}</DialogTitle>
            <DialogDescription>
              {t("org.deleteOrgDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>
              {t("org.deleteOrgConfirmPrompt", { name: orgName })}
            </Label>
            <Input
              id={inputId}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={t("org.deleteOrgConfirmPlaceholder")}
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogErrorAlert error={deleteOrg.error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t("org.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={!canConfirm || deleteOrg.isPending}
            >
              <PendingLabel
                pending={deleteOrg.isPending}
                label={t("org.deleteOrgConfirmCta")}
                pendingLabel={t("org.deleteOrgPending")}
              />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
        {isOwnerOrAdmin && <OrgIconStorageNotice />}
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
