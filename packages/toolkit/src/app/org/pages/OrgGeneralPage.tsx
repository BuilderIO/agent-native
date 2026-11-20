import { useT } from "@agent-native/core/client/i18n";
import {
  useDeleteOrg,
  useOrgMembers,
  useSetOrgVisualIdentity,
  useUpdateOrg,
} from "@agent-native/core/client/org";
import type { OrgInfo } from "@agent-native/core/org/types";
import type { ScreenModel } from "@agent-native/design-system/model";
import { ModelSurface, Skeleton } from "@agent-native/toolkit/design-system";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { IconLock } from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";

import { useSettingsShell } from "../../settings/shell/context.js";
import { settingsPageHref } from "../../settings/shell/routing.js";
import {
  OrgIconControl,
  useWorkspaceUrlFragment,
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

  const workspaceUrl = useWorkspaceUrlFragment({
    workspaceUrl: org.workspaceUrl,
  });
  const model: ScreenModel = {
    id: "settings",
    rows: [
      {
        id: "settings.org-general.organization",
        part: "settings.group",
        label: t("agentChat.settingsOrg.general.organization"),
        anchor: "organization",
        rows: [
          {
            id: "settings.org-general.organization.name",
            part: "settings.row",
            kind: "field",
            label: t("agentChat.settingsOrg.general.name"),
            anchor: "organization-name",
            state: { value: orgName },
            slot: "organization-name",
          },
          ...(isOwnerOrAdmin ? workspaceUrl.rows : []),
        ],
      },
      {
        id: "settings.org-general.membership",
        part: "settings.group",
        label: t("agentChat.settingsOrg.general.membership"),
        anchor: "membership",
        rows: [
          {
            id: "settings.org-general.membership.your-role",
            part: "settings.row",
            kind: "info",
            label: t("agentChat.settingsOrg.general.yourRole"),
            anchor: "your-role",
            state: { value: orgRoleLabel(org.role, t) },
            slot: "your-role",
          },
          {
            id: "settings.org-general.membership.member-count",
            part: "settings.row",
            label: t("org.members"),
            anchor: "member-count",
            slot: "member-count",
          },
        ],
      },
      ...(org.role === "owner"
        ? [
            {
              id: "settings.org-general.danger-zone",
              part: "settings.group",
              label: t("org.dangerZone"),
              anchor: "danger-zone",
              rows: [
                {
                  id: "settings.org-general.danger-zone.delete-organization",
                  part: "settings.row",
                  label: t("org.deleteOrg"),
                  description: t(
                    "agentChat.settingsOrg.general.deleteDescription",
                    { name: orgName },
                  ),
                  anchor: "delete-organization",
                  slot: "delete-organization",
                },
              ],
            },
          ]
        : []),
    ],
  };

  return (
    <div className="space-y-8">
      <PendingInvitationsCard />
      {org.domainMatches?.length ? (
        <JoinByDomainCard matches={org.domainMatches} />
      ) : null}
      <ModelSurface
        model={model}
        slots={{
          ...workspaceUrl.slots,
          "organization-name": <OrgNameControl org={org} />,
          "your-role": (
            <span className="text-sm text-muted-foreground">
              {orgRoleLabel(org.role, t)}
            </span>
          ),
          "member-count": <MemberCountLink />,
          "delete-organization": <DeleteOrganizationButton orgName={orgName} />,
        }}
      />
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
