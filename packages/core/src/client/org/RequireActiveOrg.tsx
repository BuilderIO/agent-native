import { ReactNode, useState } from "react";
import {
  IconAlertTriangle,
  IconBuilding,
  IconLoader2,
  IconUserPlus,
  IconAt,
} from "@tabler/icons-react";
import {
  useAcceptInvitation,
  useCreateOrg,
  useJoinByDomain,
  useOrg,
} from "./hooks.js";

export interface RequireActiveOrgProps {
  children: ReactNode;
  /**
   * Override the heading shown on the create-org pane. Default: "Create your organization".
   */
  title?: string;
  /**
   * Override the description shown below the heading. Default explains that
   * an org is required to use the app.
   */
  description?: string;
  /** Optional extra classes on the blocking pane wrapper. */
  className?: string;
}

/**
 * Guards its children behind the user having an active organization.
 *
 * When the user has no active org, renders a blocking, centered pane in place
 * of `children` with:
 *   1. Any pending invitations (one-click accept), and
 *   2. A "Create your organization" form.
 *
 * As soon as an org is joined or created, `useOrg` refetches and `children`
 * renders normally.
 *
 * The pane fills whatever box this component is rendered into — it does **not**
 * position itself `fixed` over the viewport. Place it inside your app shell so
 * ambient UI (agent sidebar, global nav) stays accessible while the user
 * completes org setup.
 */
export function RequireActiveOrg({
  children,
  title = "Create your organization",
  description = "This app organizes your content by team. Create an organization to continue — you can invite teammates afterward.",
  className,
}: RequireActiveOrgProps) {
  const { data: org, isLoading, isError, error, refetch } = useOrg();

  if (isLoading) return null;

  // Network / server failure on the org lookup — do NOT fall through to the
  // create-org pane (that would lock out an existing member on a transient
  // 500). Render a retry state instead. Only treat a successful null orgId
  // response as "genuinely no org".
  if (isError) {
    return (
      <ErrorPane
        message={(error as Error)?.message ?? "Couldn't load organization."}
        onRetry={() => void refetch()}
        className={className}
      />
    );
  }

  if (org?.orgId) return <>{children}</>;

  return (
    <CreateOrgPane
      pendingInvitations={org?.pendingInvitations ?? []}
      domainMatches={org?.domainMatches ?? []}
      email={org?.email ?? ""}
      title={title}
      description={description}
      className={className}
    />
  );
}

function ErrorPane({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      className={
        "flex h-full w-full items-center justify-center overflow-y-auto bg-background p-8 " +
        (className ?? "")
      }
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-4 flex items-center gap-2">
          <IconAlertTriangle className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Couldn't load organization</h1>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function CreateOrgPane({
  pendingInvitations,
  domainMatches,
  email,
  title,
  description,
  className,
}: {
  pendingInvitations: Array<{
    id: string;
    orgId: string;
    orgName: string;
    invitedBy: string;
  }>;
  domainMatches: Array<{ orgId: string; orgName: string }>;
  email: string;
  title: string;
  description: string;
  className?: string;
}) {
  const createOrg = useCreateOrg();
  const acceptInvitation = useAcceptInvitation();
  const joinByDomain = useJoinByDomain();
  const [name, setName] = useState("");

  const hasInvites = pendingInvitations.length > 0;
  const hasDomainMatches = domainMatches.length > 0;
  const userDomain = email.split("@")[1] ?? "";
  const [showCreateForm, setShowCreateForm] = useState(
    !hasDomainMatches && !hasInvites,
  );

  const busy =
    createOrg.isPending || acceptInvitation.isPending || joinByDomain.isPending;

  return (
    <div
      className={
        "flex h-full w-full items-center justify-center overflow-y-auto bg-background p-8 " +
        (className ?? "")
      }
    >
      <div className="my-auto w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-2">
          <IconBuilding className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">{description}</p>

        {hasDomainMatches && (
          <div className="mb-4">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              {domainMatches.length === 1
                ? "Your organization"
                : "Join your team"}
            </div>
            <ul className="space-y-2">
              {domainMatches.map((match) => (
                <li
                  key={match.orgId}
                  className="flex items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 px-4 py-3"
                >
                  <IconAt className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {match.orgName}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      Open to @{userDomain} emails
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => joinByDomain.mutate(match.orgId)}
                    className="shrink-0 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {joinByDomain.isPending ? (
                      <IconLoader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      `Join ${match.orgName}`
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasInvites && (
          <div className="mb-4">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              Pending invitations
            </div>
            <ul className="space-y-2">
              {pendingInvitations.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <IconUserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {inv.orgName}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      from {inv.invitedBy}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => acceptInvitation.mutate(inv.id)}
                    className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {acceptInvitation.isPending ? (
                      <IconLoader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Accept"
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(hasDomainMatches || hasInvites) && (
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="mb-4 flex w-full cursor-pointer items-center gap-3"
          >
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              or create a separate organization
            </span>
            <div className="h-px flex-1 bg-border" />
          </button>
        )}

        {showCreateForm && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              try {
                await createOrg.mutateAsync(trimmed);
              } catch {
                /* surfaced below */
              }
            }}
            className="space-y-3"
          >
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Organization name
              </span>
              <input
                autoFocus={!hasDomainMatches && !hasInvites}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc."
                disabled={busy}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </label>
            {createOrg.error && (
              <div className="text-xs text-red-600">
                {(createOrg.error as Error).message}
              </div>
            )}
            {acceptInvitation.error && (
              <div className="text-xs text-red-600">
                {(acceptInvitation.error as Error).message}
              </div>
            )}
            {joinByDomain.error && (
              <div className="text-xs text-red-600">
                {(joinByDomain.error as Error).message}
              </div>
            )}
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className={
                hasDomainMatches
                  ? "w-full rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
                  : "w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              }
            >
              {createOrg.isPending ? "Creating…" : "Create organization"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
