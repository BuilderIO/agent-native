import { IconLoader2, IconKey, IconUsersGroup } from "@tabler/icons-react";
import { useState } from "react";

import type { DomainMatchOrg } from "../../org/types.js";
import { useT } from "../i18n.js";
import {
  useOrg,
  useCreateOrg,
  useAcceptInvitation,
  useJoinByDomain,
} from "./hooks.js";
import { Button, ErrorText } from "./TeamPrimitives.js";

export function PendingInvitationsCard() {
  const t = useT();
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();

  if (!org?.pendingInvitations?.length) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.pendingInvitations")}</h3>
      {org.pendingInvitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded-md border border-border p-3"
        >
          <div>
            <div className="text-sm font-medium">{inv.orgName}</div>
            <div className="text-xs text-muted-foreground">
              {t("org.invitedByLabel", { name: inv.invitedBy })}
            </div>
          </div>
          <Button
            type="button"
            intent="primary"
            emphasis="solid"
            onClick={() => acceptInvitation.mutate(inv.id)}
            disabled={acceptInvitation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {acceptInvitation.isPending ? (
              <IconLoader2 size={14} className="animate-spin" />
            ) : (
              t("org.accept")
            )}
          </Button>
        </div>
      ))}
      <ErrorText error={acceptInvitation.error} />
    </section>
  );
}

export function JoinByDomainCard({ matches }: { matches: DomainMatchOrg[] }) {
  const t = useT();
  const joinByDomain = useJoinByDomain();
  const [pendingId, setPendingId] = useState<string | null>(null);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.joinYourTeam")}</h3>
      <p className="text-sm text-muted-foreground">
        {matches.length === 1
          ? t("org.joinDomainOne")
          : t("org.joinDomainMany")}
      </p>
      <div className="space-y-2">
        {matches.map((m) => (
          <div
            key={m.orgId}
            className="flex items-center justify-between rounded-md border border-border p-3"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <IconUsersGroup className="h-4 w-4 text-primary" />
              </div>
              <div className="text-sm font-medium">{m.orgName}</div>
            </div>
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              disabled={joinByDomain.isPending && pendingId === m.orgId}
              onClick={() => {
                setPendingId(m.orgId);
                joinByDomain.mutate(m.orgId, {
                  onSettled: () => setPendingId(null),
                });
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {joinByDomain.isPending && pendingId === m.orgId ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                t("org.join")
              )}
            </Button>
          </div>
        ))}
      </div>
      <ErrorText error={joinByDomain.error} />
    </section>
  );
}

function CreateOrgCard({ description }: { description?: string }) {
  const t = useT();
  const createOrg = useCreateOrg();
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.createOrgCardTitle")}</h3>
      <p className="text-sm text-muted-foreground">
        {description || t("org.createOrgCardDescription")}
      </p>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <IconKey className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t("org.createOrgVaultNotice")}</span>
      </p>
      {!showForm ? (
        <Button
          type="button"
          intent="primary"
          emphasis="solid"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("org.createOrganization")}
        </Button>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Inc."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              type="button"
              intent="primary"
              emphasis="solid"
              disabled={!name.trim() || createOrg.isPending}
              onClick={() =>
                createOrg.mutate(name.trim(), {
                  onSuccess: () => {
                    setName("");
                    setShowForm(false);
                  },
                })
              }
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createOrg.isPending ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                t("org.create")
              )}
            </Button>
            <Button
              type="button"
              intent="neutral"
              emphasis="outline"
              onClick={() => {
                setShowForm(false);
                setName("");
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {t("org.cancel")}
            </Button>
          </div>
          <ErrorText error={createOrg.error} />
        </div>
      )}
    </section>
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
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("org.askAdminTitle")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("org.askAdminDescription")}
      </p>
    </section>
  );
}
