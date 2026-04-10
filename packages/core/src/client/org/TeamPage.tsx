import { useState, type ReactNode } from "react";
import {
  IconBuilding,
  IconUserPlus,
  IconTrash,
  IconCrown,
  IconShieldCheck,
  IconLoader2,
  IconMail,
  IconCheck,
} from "@tabler/icons-react";
import {
  useOrg,
  useOrgMembers,
  useOrgInvitations,
  useCreateOrg,
  useInviteMember,
  useAcceptInvitation,
  useRemoveMember,
  useSwitchOrg,
} from "./hooks.js";

export interface TeamPageProps {
  /**
   * Optional wrapper around the page contents. Templates pass their own Layout
   * component so the Team page renders inside the template's chrome.
   */
  layout?: (children: ReactNode) => ReactNode;
  /**
   * Title shown at the top of the page. Defaults to "Team".
   */
  title?: string;
  /**
   * Class applied to the outer max-width container. Templates can use this to
   * tweak page width.
   */
  className?: string;
}

function RoleIcon({ role }: { role: string }) {
  if (role === "owner")
    return <IconCrown className="h-3.5 w-3.5 text-amber-500" />;
  if (role === "admin")
    return <IconShieldCheck className="h-3.5 w-3.5 text-blue-500" />;
  return null;
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="text-xs text-red-500">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

function PendingInvitationsCard() {
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();

  if (!org?.pendingInvitations?.length) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">Pending Invitations</h3>
      {org.pendingInvitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded-md border border-border p-3"
        >
          <div>
            <div className="text-sm font-medium">{inv.orgName}</div>
            <div className="text-xs text-muted-foreground">
              Invited by {inv.invitedBy}
            </div>
          </div>
          <button
            type="button"
            onClick={() => acceptInvitation.mutate(inv.id)}
            disabled={acceptInvitation.isPending}
            className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {acceptInvitation.isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Accept"
            )}
          </button>
        </div>
      ))}
      <ErrorText error={acceptInvitation.error} />
    </section>
  );
}

function CreateOrgCard() {
  const createOrg = useCreateOrg();
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">Create an Organization</h3>
      <p className="text-sm text-muted-foreground">
        Set up a team to share dashboards and connections with your colleagues.
      </p>
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
        >
          Create organization
        </button>
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
            <button
              type="button"
              disabled={!name.trim() || createOrg.isPending}
              onClick={() => createOrg.mutate(name.trim(), { onSuccess: () => { setName(""); setShowForm(false); } })}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {createOrg.isPending ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Create"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setName("");
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <ErrorText error={createOrg.error} />
        </div>
      )}
    </section>
  );
}

function MembersCard() {
  const { data: org } = useOrg();
  const { data: membersData } = useOrgMembers();
  const { data: invitationsData } = useOrgInvitations();
  const inviteMember = useInviteMember();
  const removeMember = useRemoveMember();
  const switchOrg = useSwitchOrg();

  const [inviteEmail, setInviteEmail] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);

  if (!org?.orgId) return null;

  const isOwnerOrAdmin = org.role === "owner" || org.role === "admin";
  const members = membersData?.members ?? [];
  const pendingInvites = invitationsData?.invitations ?? [];
  const hasMultipleOrgs = (org.orgs?.length ?? 0) > 1;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/10">
            <IconBuilding className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <div className="text-sm font-medium">{org.orgName}</div>
            <div className="text-xs text-muted-foreground">
              {members.length} member{members.length !== 1 ? "s" : ""} · You
              are {org.role}
            </div>
          </div>
        </div>
        {hasMultipleOrgs && (
          <select
            value={org.orgId ?? ""}
            onChange={(e) => switchOrg.mutate(e.target.value || null)}
            disabled={switchOrg.isPending}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
          >
            {org.orgs.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.orgName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="border-t border-border pt-3 space-y-1">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Members
        </div>
        {members.map((m) => (
          <div
            key={m.email}
            className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent/30"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">{m.email}</span>
              <RoleIcon role={m.role} />
              {m.email === org.email && (
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  You
                </span>
              )}
            </div>
            {isOwnerOrAdmin &&
              m.email !== org.email &&
              m.role !== "owner" && (
                <button
                  type="button"
                  disabled={removeMember.isPending}
                  onClick={() => removeMember.mutate(m.email)}
                  className="text-muted-foreground hover:text-red-500 disabled:opacity-50"
                  title="Remove member"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              )}
          </div>
        ))}
        {pendingInvites.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center justify-between py-1.5 px-2 opacity-60"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">{inv.email}</span>
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Invited
              </span>
            </div>
          </div>
        ))}
      </div>

      {isOwnerOrAdmin && (
        <div className="border-t border-border pt-3">
          {!showInviteForm ? (
            <button
              type="button"
              onClick={() => setShowInviteForm(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent/50"
            >
              <IconUserPlus className="h-3.5 w-3.5" />
              Invite member
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <IconMail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  disabled={!inviteEmail.trim() || inviteMember.isPending}
                  onClick={() =>
                    inviteMember.mutate(inviteEmail.trim(), {
                      onSuccess: () => {
                        setInviteEmail("");
                        setShowInviteForm(false);
                      },
                    })
                  }
                  className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
                >
                  {inviteMember.isPending ? (
                    <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <IconCheck className="h-3.5 w-3.5" />
                      Send
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteForm(false);
                    setInviteEmail("");
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                They&apos;ll need to sign in with Google using this exact email
                to accept the invitation.
              </p>
              <ErrorText error={inviteMember.error} />
            </div>
          )}
        </div>
      )}

      <ErrorText error={removeMember.error} />
      <ErrorText error={switchOrg.error} />
    </section>
  );
}

/**
 * Default Team management page. Templates can route directly to this component
 * or wrap it with their own Layout via the `layout` prop.
 */
export function TeamPage({ layout, title = "Team", className }: TeamPageProps) {
  const { data: org, isLoading } = useOrg();

  const content = (
    <div className={`space-y-6 max-w-2xl ${className ?? ""}`}>
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>

      {isLoading && (
        <section className="rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </section>
      )}

      {!isLoading && org?.email === "local@localhost" && (
        <section className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            You&apos;re signed in as <code>local@localhost</code>. Sign in with
            Google to create or join an organization.
          </p>
        </section>
      )}

      {!isLoading && org?.email !== "local@localhost" && (
        <>
          <PendingInvitationsCard />
          {!org?.orgId ? <CreateOrgCard /> : <MembersCard />}
        </>
      )}
    </div>
  );

  return layout ? <>{layout(content)}</> : content;
}
