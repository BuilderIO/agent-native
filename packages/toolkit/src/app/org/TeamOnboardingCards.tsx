import { useT } from "@agent-native/core/client/i18n";
import {
  useOrg,
  useCreateOrg,
  useAcceptInvitation,
  useJoinByDomain,
} from "@agent-native/core/client/org";
import type { DomainMatchOrg } from "@agent-native/core/org/types";
import { type ModelRow, rowIdSegment } from "@agent-native/design-system/model";
import {
  ModelSurface,
  rowAttributes,
} from "@agent-native/toolkit/design-system";
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

import { ErrorText, PendingLabel } from "./TeamPrimitives.js";

function errorRow(id: string, error: Error | null): ModelRow[] {
  if (!error) return [];
  return [
    {
      id,
      part: "settings.content",
      label: error.message,
      slot: "error",
    },
  ];
}

export function PendingInvitationsCard() {
  const t = useT();
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (!org?.pendingInvitations?.length) return null;

  const rows: ModelRow[] = org.pendingInvitations.map((inv) => {
    const segment = rowIdSegment(inv.id);
    return {
      id: `settings.org.pending-invitations.${segment}`,
      part: "settings.row",
      label: inv.orgName,
      description: t("org.invitedByLabel", { name: inv.invitedBy }),
      rows: [
        {
          id: `settings.org.pending-invitations.${segment}.accept`,
          part: "button",
          kind: "action",
          label: t("org.accept"),
          state: {
            disabled: acceptInvitation.isPending,
            pending: acceptInvitation.isPending && pendingId === inv.id,
          },
          effect: { kind: "action", effectId: `accept-${inv.id}` },
        },
      ],
    };
  });

  return (
    <ModelSurface
      model={{
        id: "settings",
        rows: [
          {
            id: "settings.org.pending-invitations",
            part: "settings.group",
            label: t("org.pendingInvitations"),
            anchor: "pending-invitations",
            rows: [
              ...rows,
              ...errorRow(
                "settings.org.pending-invitations.error",
                acceptInvitation.error,
              ),
            ],
          },
        ],
      }}
      actions={Object.fromEntries(
        org.pendingInvitations.map((inv) => [
          `accept-${inv.id}`,
          () => {
            setPendingId(inv.id);
            acceptInvitation.mutate(inv.id, {
              onSettled: () => setPendingId(null),
            });
          },
        ]),
      )}
      slots={{
        error: (row) => (
          <div {...rowAttributes(row)} className="px-5 py-3 sm:px-6">
            <ErrorText error={acceptInvitation.error} />
          </div>
        ),
      }}
    />
  );
}

export function JoinByDomainCard({ matches }: { matches: DomainMatchOrg[] }) {
  const t = useT();
  const joinByDomain = useJoinByDomain();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const rows: ModelRow[] = matches.map((m) => {
    const segment = rowIdSegment(m.orgId);
    return {
      id: `settings.org.join-by-domain.${segment}`,
      part: "settings.row",
      label: m.orgName,
      icon: { kind: "symbol", key: "users-group" },
      rows: [
        {
          id: `settings.org.join-by-domain.${segment}.join`,
          part: "button",
          kind: "action",
          label: t("org.join"),
          state: {
            disabled: joinByDomain.isPending,
            pending: joinByDomain.isPending && pendingId === m.orgId,
          },
          effect: { kind: "action", effectId: `join-${m.orgId}` },
        },
      ],
    };
  });

  return (
    <ModelSurface
      model={{
        id: "settings",
        rows: [
          {
            id: "settings.org.join-by-domain",
            part: "settings.group",
            label: t("org.joinYourTeam"),
            anchor: "join-by-domain",
            rows: [
              ...rows,
              ...errorRow(
                "settings.org.join-by-domain.error",
                joinByDomain.error,
              ),
            ],
          },
        ],
      }}
      actions={Object.fromEntries(
        matches.map((m) => [
          `join-${m.orgId}`,
          () => {
            setPendingId(m.orgId);
            joinByDomain.mutate(m.orgId, {
              onSettled: () => setPendingId(null),
            });
          },
        ]),
      )}
      slots={{
        error: (row) => (
          <div {...rowAttributes(row)} className="px-5 py-3 sm:px-6">
            <ErrorText error={joinByDomain.error} />
          </div>
        ),
      }}
    />
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
