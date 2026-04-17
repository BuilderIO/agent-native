import { useEffect, useRef, useState } from "react";
import {
  IconBuilding,
  IconCheck,
  IconLoader2,
  IconPlus,
  IconSelector,
  IconUserPlus,
} from "@tabler/icons-react";
import {
  useOrg,
  useSwitchOrg,
  useCreateOrg,
  useInviteMember,
  useAcceptInvitation,
} from "./hooks.js";

export interface OrgSwitcherProps {
  className?: string;
  /** Hide entirely when the user only belongs to one org. Default: false. */
  hideWhenSingle?: boolean;
}

type Mode = "list" | "create" | "invite";

/**
 * Compact org switcher button. Shows the active org name; opens a dropdown
 * with the user's other orgs, pending invitations, and inline forms to
 * create a new org or invite a teammate. Renders nothing in solo / dev
 * mode or when the user has no orgs at all and no invites.
 *
 * Headless DOM (no shadcn deps) so it works in any template.
 */
export function OrgSwitcher({ className, hideWhenSingle }: OrgSwitcherProps) {
  const { data: org } = useOrg();
  const switchOrg = useSwitchOrg();
  const createOrg = useCreateOrg();
  const inviteMember = useInviteMember();
  const acceptInvitation = useAcceptInvitation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("list");
  const [newName, setNewName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMode("list");
      setNewName("");
      setInviteEmail("");
    }
  }, [open]);

  if (!org || org.email === "local@localhost") return null;

  const orgs = org.orgs ?? [];
  const pendingInvitations = org.pendingInvitations ?? [];
  const orgCount = orgs.length;
  const hasAny = orgCount > 0 || pendingInvitations.length > 0;
  if (!hasAny && !org.email) return null;
  if (hideWhenSingle && orgCount < 2 && pendingInvitations.length === 0) {
    return null;
  }

  const canInvite =
    !!org.orgId && (org.role === "owner" || org.role === "admin");

  const label = org.orgName ?? "Choose organization";

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground border border-border/50"
      >
        <IconBuilding className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate flex-1 text-left">{label}</span>
        <IconSelector className="h-3 w-3 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 bottom-full mb-1 z-50 rounded-md border border-border bg-popover shadow-md py-1 min-w-[14rem]">
          {mode === "list" && (
            <>
              {orgs.length > 0 && (
                <div className="px-2.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Organizations
                </div>
              )}
              {orgs.map((o) => (
                <button
                  key={o.orgId}
                  type="button"
                  onClick={async () => {
                    if (o.orgId === org.orgId) {
                      setOpen(false);
                      return;
                    }
                    try {
                      await switchOrg.mutateAsync(o.orgId);
                      setOpen(false);
                    } catch {
                      /* error surfaced via switchOrg.error */
                    }
                  }}
                  disabled={switchOrg.isPending}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                >
                  <IconBuilding className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1 text-left">{o.orgName}</span>
                  {o.orgId === org.orgId && (
                    <IconCheck className="h-3.5 w-3.5 shrink-0 text-green-500" />
                  )}
                </button>
              ))}

              {pendingInvitations.length > 0 && (
                <>
                  {orgs.length > 0 && <div className="my-1 h-px bg-border" />}
                  <div className="px-2.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Invitations
                  </div>
                  {pendingInvitations.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs"
                    >
                      <IconBuilding className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1 text-foreground">
                        {inv.orgName}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await acceptInvitation.mutateAsync(inv.id);
                            setOpen(false);
                          } catch {
                            /* error surfaced via acceptInvitation.error */
                          }
                        }}
                        disabled={acceptInvitation.isPending}
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-green-600 hover:bg-green-500/10 disabled:opacity-50"
                      >
                        {acceptInvitation.isPending ? (
                          <IconLoader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Join"
                        )}
                      </button>
                    </div>
                  ))}
                </>
              )}

              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => setMode("create")}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent"
              >
                <IconPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left">Create organization</span>
              </button>
              {canInvite && (
                <button
                  type="button"
                  onClick={() => setMode("invite")}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent"
                >
                  <IconUserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-left">Invite member</span>
                </button>
              )}

              {(switchOrg.error || acceptInvitation.error) && (
                <div className="px-2.5 pt-1 text-[11px] text-red-600">
                  {
                    ((switchOrg.error || acceptInvitation.error) as Error)
                      .message
                  }
                </div>
              )}
            </>
          )}

          {mode === "create" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const name = newName.trim();
                if (!name) return;
                try {
                  await createOrg.mutateAsync(name);
                  setOpen(false);
                } catch {
                  /* error surfaced via createOrg.error */
                }
              }}
              className="px-2 py-1.5"
            >
              <div className="px-0.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                New organization
              </div>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Organization name"
                disabled={createOrg.isPending}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              {createOrg.error && (
                <div className="pt-1 text-[11px] text-red-600">
                  {(createOrg.error as Error).message}
                </div>
              )}
              <div className="flex items-center gap-1.5 pt-1.5">
                <button
                  type="button"
                  onClick={() => setMode("list")}
                  disabled={createOrg.isPending}
                  className="flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createOrg.isPending || !newName.trim()}
                  className="flex-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {createOrg.isPending ? (
                    <IconLoader2 className="mx-auto h-3 w-3 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </button>
              </div>
            </form>
          )}

          {mode === "invite" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const email = inviteEmail.trim();
                if (!email) return;
                try {
                  await inviteMember.mutateAsync(email);
                  setInviteEmail("");
                  setMode("list");
                } catch {
                  /* error surfaced via inviteMember.error */
                }
              }}
              className="px-2 py-1.5"
            >
              <div className="px-0.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Invite to {org.orgName}
              </div>
              <input
                autoFocus
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                disabled={inviteMember.isPending}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              {inviteMember.error && (
                <div className="pt-1 text-[11px] text-red-600">
                  {(inviteMember.error as Error).message}
                </div>
              )}
              <div className="flex items-center gap-1.5 pt-1.5">
                <button
                  type="button"
                  onClick={() => setMode("list")}
                  disabled={inviteMember.isPending}
                  className="flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteMember.isPending || !inviteEmail.trim()}
                  className="flex-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {inviteMember.isPending ? (
                    <IconLoader2 className="mx-auto h-3 w-3 animate-spin" />
                  ) : (
                    "Send invite"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
