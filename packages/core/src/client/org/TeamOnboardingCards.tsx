import { Button } from "@agent-native/toolkit/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@agent-native/toolkit/ui/empty";
import { Input } from "@agent-native/toolkit/ui/input";
import { IconKey, IconUsersGroup } from "@tabler/icons-react";
import { useState } from "react";

import type { DomainMatchOrg } from "../../org/types.js";
import { useT } from "../i18n.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import {
  useOrg,
  useCreateOrg,
  useAcceptInvitation,
  useJoinByDomain,
} from "./hooks.js";
import { ErrorText, PendingLabel } from "./TeamPrimitives.js";

export function PendingInvitationsCard() {
  const t = useT();
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (!org?.pendingInvitations?.length) return null;

  return (
    <SettingsGroup id="pending-invitations" title={t("org.pendingInvitations")}>
      {org.pendingInvitations.map((inv) => (
        <SettingsRow
          key={inv.id}
          label={inv.orgName}
          description={t("org.invitedByLabel", { name: inv.invitedBy })}
          control={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setPendingId(inv.id);
                acceptInvitation.mutate(inv.id, {
                  onSettled: () => setPendingId(null),
                });
              }}
              disabled={acceptInvitation.isPending}
            >
              <PendingLabel
                pending={acceptInvitation.isPending && pendingId === inv.id}
                label={t("org.accept")}
                pendingLabel={t("org.accept")}
              />
            </Button>
          }
        />
      ))}
      {acceptInvitation.error ? (
        <div className="px-5 py-3 sm:px-6">
          <ErrorText error={acceptInvitation.error} />
        </div>
      ) : null}
    </SettingsGroup>
  );
}

export function JoinByDomainCard({ matches }: { matches: DomainMatchOrg[] }) {
  const t = useT();
  const joinByDomain = useJoinByDomain();
  const [pendingId, setPendingId] = useState<string | null>(null);

  return (
    <SettingsGroup id="join-by-domain" title={t("org.joinYourTeam")}>
      {matches.map((m) => (
        <SettingsRow
          key={m.orgId}
          icon={<IconUsersGroup />}
          label={m.orgName}
          control={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={joinByDomain.isPending}
              onClick={() => {
                setPendingId(m.orgId);
                joinByDomain.mutate(m.orgId, {
                  onSettled: () => setPendingId(null),
                });
              }}
            >
              <PendingLabel
                pending={joinByDomain.isPending && pendingId === m.orgId}
                label={t("org.join")}
                pendingLabel={t("org.join")}
              />
            </Button>
          }
        />
      ))}
      {joinByDomain.error ? (
        <div className="px-5 py-3 sm:px-6">
          <ErrorText error={joinByDomain.error} />
        </div>
      ) : null}
    </SettingsGroup>
  );
}

function CreateOrgCard({ description }: { description?: string }) {
  const t = useT();
  const createOrg = useCreateOrg();
  const [name, setName] = useState("");
  const trimmed = name.trim();

  return (
    <Empty className="border border-border/70 bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconUsersGroup />
        </EmptyMedia>
        <EmptyTitle>{t("org.createTitle")}</EmptyTitle>
        <EmptyDescription>
          {description || t("org.createOrgCardDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed || createOrg.isPending) return;
            createOrg.mutate(trimmed, { onSuccess: () => setName("") });
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("org.organizationPlaceholder")}
            aria-label={t("org.organizationName")}
            aria-invalid={createOrg.error ? true : undefined}
            className="flex-1"
          />
          <Button type="submit" disabled={!trimmed || createOrg.isPending}>
            <PendingLabel
              pending={createOrg.isPending}
              label={t("org.create")}
              pendingLabel={t("org.creating")}
            />
          </Button>
        </form>
        <ErrorText error={createOrg.error} />
        <p className="flex items-start gap-2 text-start text-xs text-muted-foreground">
          <IconKey className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("org.createOrgVaultNotice")}</span>
        </p>
      </EmptyContent>
    </Empty>
  );
}

export function NoOrgCard({
  description,
  orgCreation,
}: {
  description?: string;
  orgCreation?: "open" | "closed";
}) {
  const t = useT();
  if (orgCreation !== "closed") {
    return <CreateOrgCard description={description} />;
  }
  return (
    <Empty className="border border-border/70 bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconUsersGroup />
        </EmptyMedia>
        <EmptyTitle>{t("org.askAdminTitle")}</EmptyTitle>
        <EmptyDescription>{t("org.askAdminDescription")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
