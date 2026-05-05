import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  IconBuilding,
  IconCheck,
  IconLoader2,
  IconLogout,
  IconPlus,
  IconSelector,
  IconUser,
  IconUserPlus,
} from "@tabler/icons-react";
import {
  useOrg,
  useSwitchOrg,
  useCreateOrg,
  useInviteMember,
  useAcceptInvitation,
  useJoinByDomain,
} from "./hooks.js";
import { agentNativePath } from "../api-path.js";

export interface OrgSwitcherProps {
  className?: string;
  /** Hide entirely when the user only belongs to one org. Default: false. */
  hideWhenSingle?: boolean;
  /** Keep the switcher's button height reserved while org state is loading. */
  reserveSpace?: boolean;
}

function personalLabelFromEmail(email: string | null | undefined): string {
  if (!email) return "Personal";
  const local = email.split("@")[0] ?? email;
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "Personal";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type Mode = "list" | "create" | "invite";

const POPOVER_CONTENT_CLASS =
  "z-50 min-w-[14rem] rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2";

const ITEM_CLASS =
  "flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent focus-visible:bg-accent focus:outline-none disabled:opacity-50 disabled:pointer-events-none";

const SECTION_LABEL_CLASS =
  "px-2.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground";

/**
 * Compact org switcher button. Shows the active org (or "Personal" when the
 * user has none); opens a popover with the user's other orgs, pending
 * invitations, inline forms to create a new org / invite a teammate, and a
 * sign-out item. Renders nothing in dev / no-auth mode.
 */
export function OrgSwitcher({
  className,
  hideWhenSingle,
  reserveSpace,
}: OrgSwitcherProps) {
  const { data: org, isLoading } = useOrg();
  const switchOrg = useSwitchOrg();
  const createOrg = useCreateOrg();
  const inviteMember = useInviteMember();
  const acceptInvitation = useAcceptInvitation();
  const joinByDomain = useJoinByDomain();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("list");
  const [newName, setNewName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [joiningOrgId, setJoiningOrgId] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setMode("list");
      setNewName("");
      setInviteEmail("");
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch(agentNativePath("/_agent-native/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* fall through to reload — server may already have cleared the cookie */
    }
    window.location.reload();
  };

  if (!org) {
    return reserveSpace && isLoading ? (
      <div aria-hidden="true" className={`h-8 ${className ?? ""}`} />
    ) : null;
  }

  const orgs = org.orgs ?? [];
  const pendingInvitations = org.pendingInvitations ?? [];
  const domainMatches = org.domainMatches ?? [];
  const orgCount = orgs.length;
  const hasAny =
    orgCount > 0 || pendingInvitations.length > 0 || domainMatches.length > 0;
  if (!hasAny && !org.email) {
    return reserveSpace ? (
      <div aria-hidden="true" className={`h-8 ${className ?? ""}`} />
    ) : null;
  }
  if (
    hideWhenSingle &&
    orgCount < 2 &&
    pendingInvitations.length === 0 &&
    domainMatches.length === 0
  ) {
    return reserveSpace ? (
      <div aria-hidden="true" className={`h-8 ${className ?? ""}`} />
    ) : null;
  }

  const canInvite =
    !!org.orgId && (org.role === "owner" || org.role === "admin");

  const personalLabel = personalLabelFromEmail(org.email);
  const inOrg = !!org.orgId;
  const buttonLabel = org.orgName ?? "Personal";
  const ButtonIcon = inOrg ? IconBuilding : IconUser;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={`flex w-full items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer ${className ?? ""}`}
        >
          <ButtonIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1 text-left">{buttonLabel}</span>
          <IconSelector className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={POPOVER_CONTENT_CLASS}
          onOpenAutoFocus={(e) => {
            // Don't auto-focus the first item — feels heavy on a switcher.
            if (mode === "list") e.preventDefault();
          }}
        >
          {mode === "list" && (
            <>
              {!inOrg && (
                <div
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground"
                  aria-disabled="true"
                >
                  <IconUser className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1 text-left">
                    Personal ({personalLabel})
                  </span>
                </div>
              )}
              {orgs.length > 0 && (
                <div className={SECTION_LABEL_CLASS}>Organizations</div>
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
                  className={`${ITEM_CLASS} cursor-pointer`}
                >
                  <IconBuilding className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1 text-left">{o.orgName}</span>
                  {o.orgId === org.orgId && (
                    <IconCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))}

              {pendingInvitations.length > 0 && (
                <>
                  {orgs.length > 0 && <div className="my-1 h-px bg-border" />}
                  <div className={SECTION_LABEL_CLASS}>Invitations</div>
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
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50 cursor-pointer"
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

              {domainMatches.length > 0 && (
                <>
                  {(orgs.length > 0 || pendingInvitations.length > 0) && (
                    <div className="my-1 h-px bg-border" />
                  )}
                  <div className={SECTION_LABEL_CLASS}>Join your team</div>
                  {domainMatches.map((match) => {
                    const isJoining =
                      joinByDomain.isPending && joiningOrgId === match.orgId;
                    return (
                      <div
                        key={match.orgId}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-xs"
                      >
                        <IconBuilding className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate flex-1 text-foreground">
                          {match.orgName}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            setJoiningOrgId(match.orgId);
                            try {
                              await joinByDomain.mutateAsync(match.orgId);
                              setOpen(false);
                            } catch {
                              /* error surfaced via joinByDomain.error */
                            } finally {
                              setJoiningOrgId(null);
                            }
                          }}
                          disabled={joinByDomain.isPending}
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50 cursor-pointer"
                        >
                          {isJoining ? (
                            <IconLoader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Join"
                          )}
                        </button>
                      </div>
                    );
                  })}
                </>
              )}

              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => setMode("create")}
                className={`${ITEM_CLASS} cursor-pointer`}
              >
                <IconPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left">Create organization</span>
              </button>
              {canInvite && (
                <button
                  type="button"
                  onClick={() => setMode("invite")}
                  className={`${ITEM_CLASS} cursor-pointer`}
                >
                  <IconUserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-left">Invite member</span>
                </button>
              )}

              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className={`${ITEM_CLASS} cursor-pointer`}
              >
                {signingOut ? (
                  <IconLoader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <IconLogout className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 text-left">
                  Sign out
                  {org.email ? (
                    <span className="ml-1 text-muted-foreground">
                      ({org.email})
                    </span>
                  ) : null}
                </span>
              </button>

              {(switchOrg.error ||
                acceptInvitation.error ||
                joinByDomain.error) && (
                <div className="px-2.5 pt-1 text-[11px] text-destructive">
                  {
                    (
                      (switchOrg.error ||
                        acceptInvitation.error ||
                        joinByDomain.error) as Error
                    ).message
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
                <div className="pt-1 text-[11px] text-destructive">
                  {(createOrg.error as Error).message}
                </div>
              )}
              <div className="flex items-center gap-1.5 pt-1.5">
                <button
                  type="button"
                  onClick={() => setMode("list")}
                  disabled={createOrg.isPending}
                  className="flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createOrg.isPending || !newName.trim()}
                  className="flex-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
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
                <div className="pt-1 text-[11px] text-destructive">
                  {(inviteMember.error as Error).message}
                </div>
              )}
              <div className="flex items-center gap-1.5 pt-1.5">
                <button
                  type="button"
                  onClick={() => setMode("list")}
                  disabled={inviteMember.isPending}
                  className="flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteMember.isPending || !inviteEmail.trim()}
                  className="flex-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
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
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
