import { ResourceIcon } from "@agent-native/toolkit/icons";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  IconArrowUpRight,
  IconBriefcase,
  IconCheck,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconLogout,
  IconPlus,
  IconPresentation,
  IconSelector,
  IconSettings,
  IconUser,
  IconUserCircle,
  IconUserPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { setBrowserDemoModeEnabled } from "../../demo/browser-state.js";
import { canInviteOrgMembers } from "../../org/permissions.js";
import { shouldOfferWorkspace } from "../../org/workspace-url.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { signOut } from "../sign-out.js";
import { useDemoModeStatus } from "../use-demo-mode-status.js";
import { useSession } from "../use-session.js";
import {
  useOrg,
  useSwitchOrg,
  useCreateOrg,
  useInviteMember,
  useAcceptInvitation,
  useJoinByDomain,
} from "./hooks.js";

export interface OrgSwitcherUtilityLink {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  external?: boolean;
}

export interface OrgSwitcherProps {
  className?: string;
  hideWhenSingle?: boolean;
  reserveSpace?: boolean;
  compact?: boolean;
  settingsPath?: string | null;
  profilePath?: string | null;
  /** @deprecated Manage agent is available in Settings and is not shown here. */
  agentPath?: string | null;
  /** @deprecated The switcher no longer renders an app list. */
  currentAppId?: string;
  utilityLinks?: readonly OrgSwitcherUtilityLink[];
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

const SWITCHER_BUTTON_CLASS =
  "flex w-full items-center gap-2 rounded-md border-0 bg-accent/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 cursor-pointer";

const COMPACT_SWITCHER_BUTTON_CLASS =
  "flex items-center justify-center rounded-md border-0 bg-accent/50 p-1.5 text-muted-foreground hover:bg-accent/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 cursor-pointer";

const DEFAULT_ORGANIZATION_SETTINGS_PATH = "/settings/organization";
const DEFAULT_PROFILE_PATH = "/settings/account";
function organizationSettingsPath(path: string): string {
  if (path.includes("#")) return path;
  const pathname = path.split("?")[0]?.replace(/\/+$/, "");
  return pathname === "/settings" ? `${path}#organization` : path;
}

function ReservedOrgSwitcherSpace({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`h-8 ${className ?? ""}`} />;
}

function OrgSwitcherLoadingPlaceholder({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      disabled
      aria-label="Loading organization"
      className={`${compact ? COMPACT_SWITCHER_BUTTON_CLASS : SWITCHER_BUTTON_CLASS} animate-pulse ${className ?? ""}`}
    >
      {compact ? (
        <span className="size-3.5 rounded-sm bg-muted-foreground/20" />
      ) : (
        <>
          <IconBriefcase className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="h-3 min-w-0 flex-1 rounded-sm bg-muted-foreground/20" />
          <IconSelector className="h-3 w-3 shrink-0 opacity-30" />
        </>
      )}
    </button>
  );
}

export function OrgSwitcher({
  className,
  hideWhenSingle,
  reserveSpace,
  compact,
  settingsPath = DEFAULT_ORGANIZATION_SETTINGS_PATH,
  profilePath = DEFAULT_PROFILE_PATH,
  utilityLinks,
}: OrgSwitcherProps) {
  const { data: org, isLoading } = useOrg();
  const { session } = useSession();
  const { enabled: demoModeEnabled } = useDemoModeStatus();
  const t = useT();
  const switchOrg = useSwitchOrg();
  const createOrg = useCreateOrg();
  const inviteMember = useInviteMember();
  const acceptInvitation = useAcceptInvitation();
  const joinByDomain = useJoinByDomain();
  const navigate = useNavigate();
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
    await signOut();
  };

  if (!org) {
    return isLoading ? (
      <OrgSwitcherLoadingPlaceholder className={className} compact={compact} />
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
      <ReservedOrgSwitcherSpace className={className} />
    ) : null;
  }
  if (
    hideWhenSingle &&
    orgCount < 2 &&
    pendingInvitations.length === 0 &&
    domainMatches.length === 0
  ) {
    return reserveSpace ? (
      <ReservedOrgSwitcherSpace className={className} />
    ) : null;
  }

  const canInvite =
    !!org.orgId && canInviteOrgMembers(org.role, org.emailConfigured);

  const personalLabel = session?.name || personalLabelFromEmail(org.email);
  const inOrg = !!org.orgId;
  const buttonLabel = org.orgName ?? "Personal";
  const triggerLabel = demoModeEnabled
    ? `${buttonLabel}, Demo mode`
    : buttonLabel;
  const ButtonIcon = inOrg ? IconBriefcase : IconUser;
  const buttonIcon = inOrg ? org.icon : null;
  const organizationSettingsHref = settingsPath
    ? organizationSettingsPath(settingsPath)
    : null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {compact ? (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverPrimitive.Trigger asChild>
                <button
                  type="button"
                  aria-label={triggerLabel}
                  className={`${COMPACT_SWITCHER_BUTTON_CLASS} ${className ?? ""}`}
                >
                  <ResourceIcon
                    value={buttonIcon}
                    size={14}
                    resolveImageUrl={(image) =>
                      image.authority === "url" ? image.assetId : undefined
                    }
                    fallback={<ButtonIcon className="h-3.5 w-3.5 shrink-0" />}
                  />
                </button>
              </PopoverPrimitive.Trigger>
            </TooltipTrigger>
            <TooltipContent side="right">{triggerLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={triggerLabel}
            className={`${SWITCHER_BUTTON_CLASS} ${className ?? ""}`}
          >
            <ResourceIcon
              value={buttonIcon}
              size={14}
              resolveImageUrl={(image) =>
                image.authority === "url" ? image.assetId : undefined
              }
              fallback={<ButtonIcon className="h-3.5 w-3.5 shrink-0" />}
            />
            <span className="truncate flex-1 text-start">{buttonLabel}</span>
            {demoModeEnabled && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                <IconPresentation className="h-3 w-3" aria-hidden="true" />
                Demo mode
              </span>
            )}
            <IconSelector className="h-3 w-3 shrink-0 opacity-50" />
          </button>
        </PopoverPrimitive.Trigger>
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={`${POPOVER_CONTENT_CLASS} w-64 max-w-[calc(100vw-1.5rem)]`}
          onOpenAutoFocus={(e) => {
            if (mode === "list") e.preventDefault();
          }}
        >
          {mode === "list" && (
            <>
              {/* The org name alone is ambiguous: the same org exists on every
                  deployment a member has signed into, so the switcher reads
                  identically on all of them. The host is what tells them
                  which one they're actually looking at. */}
              {typeof window !== "undefined" && (
                <div className="px-2.5 pb-1.5 pt-1 text-[11px] text-muted-foreground">
                  <div className="truncate">{window.location.host}</div>
                  {shouldOfferWorkspace(
                    window.location.href,
                    org.workspaceUrl,
                  ) && (
                    <a
                      href={org.workspaceUrl ?? undefined}
                      className="mt-0.5 inline-flex items-center gap-1 text-foreground no-underline hover:underline"
                    >
                      <IconExternalLink className="h-3 w-3 shrink-0" />
                      Your workspace
                    </a>
                  )}
                </div>
              )}
              {demoModeEnabled && (
                <div
                  role="status"
                  className="mx-2.5 mb-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px]"
                >
                  <div className="flex items-center gap-1.5 font-medium text-primary">
                    <IconPresentation
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    Demo mode is on
                  </div>
                  <p className="mt-0.5 leading-snug text-muted-foreground">
                    Displayed emails and supported charts are adjusted for
                    presentations. Your account and permissions are unchanged.
                  </p>
                  <button
                    type="button"
                    onClick={() => setBrowserDemoModeEnabled(false)}
                    className="mt-1 rounded text-[11px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Turn off demo mode
                  </button>
                </div>
              )}
              {!inOrg && (
                <div
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground"
                  aria-disabled="true"
                >
                  <IconUser className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate flex-1 text-start">
                    Personal ({personalLabel})
                  </span>
                </div>
              )}
              <div className={SECTION_LABEL_CLASS}>Organizations</div>
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
                  <ResourceIcon
                    value={o.icon}
                    size={14}
                    resolveImageUrl={(image) =>
                      image.authority === "url" ? image.assetId : undefined
                    }
                    fallback={
                      <IconBriefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    }
                  />
                  <span className="min-w-0 truncate flex-1 text-start">
                    {o.orgName}
                  </span>
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
                    <div key={inv.id} className="px-2.5 py-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <IconUsersGroup className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate flex-1 text-foreground">
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
                      {org.orgId && (
                        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                          <IconKey className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            {t("org.acceptInvitationOrgSwitchNotice", {
                              name: inv.orgName,
                            })}
                          </span>
                        </p>
                      )}
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
                        <IconUsersGroup className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate flex-1 text-foreground">
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

              {(pendingInvitations.length > 0 || domainMatches.length > 0) && (
                <div className="my-1 h-px bg-border" />
              )}
              {canInvite && (
                <button
                  type="button"
                  onClick={() => {
                    setInviteEmail("");
                    setMode("invite");
                  }}
                  className={`${ITEM_CLASS} cursor-pointer`}
                >
                  <IconUserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-start">Invite member</span>
                </button>
              )}
              {inOrg && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (organizationSettingsHref) {
                      void navigate(organizationSettingsHref);
                    } else {
                      window.dispatchEvent(new CustomEvent("agent-panel:open"));
                      window.dispatchEvent(
                        new CustomEvent("agent-panel:open-settings", {
                          detail: { section: "workspace-settings" },
                        }),
                      );
                    }
                  }}
                  className={`${ITEM_CLASS} cursor-pointer`}
                >
                  <IconSettings className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-start">
                    Organization settings
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setNewName("");
                  setMode("create");
                }}
                className={`${ITEM_CLASS} cursor-pointer`}
              >
                <IconPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-start">Create organization</span>
              </button>

              {profilePath && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <div className={SECTION_LABEL_CLASS}>
                    {t("settings.profileTitle")}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      void navigate(profilePath);
                    }}
                    className={`${ITEM_CLASS} cursor-pointer`}
                  >
                    <IconUserCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-start">
                      {t("settings.profileMenuItem")}
                    </span>
                  </button>
                </>
              )}
              {utilityLinks && utilityLinks.length > 0 && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <div className={SECTION_LABEL_CLASS}>
                    {t("contextXray.provenance.tools", {
                      defaultValue: "Tools",
                    })}
                  </div>
                  {utilityLinks.map((link) => {
                    const content = (
                      <>
                        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">
                          {link.icon ?? <IconExternalLink />}
                        </span>
                        <span className="flex-1 text-start">{link.label}</span>
                        {link.external && (
                          <IconArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </>
                    );

                    return link.external ? (
                      <a
                        key={link.id}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setOpen(false)}
                        className={ITEM_CLASS}
                      >
                        {content}
                      </a>
                    ) : (
                      <Link
                        key={link.id}
                        to={link.href}
                        onClick={() => setOpen(false)}
                        className={ITEM_CLASS}
                      >
                        {content}
                      </Link>
                    );
                  })}
                </>
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
                  <IconLogout className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" />
                )}
                <span className="flex-1 text-start">
                  Sign out
                  {!demoModeEnabled && org.email ? (
                    <span className="ms-1 text-muted-foreground">
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
                  handleOpenChange(false);
                } catch {
                  /* error surfaced via createOrg.error */
                }
              }}
              className="px-2 py-1.5"
            >
              <div className="px-0.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                New organization
              </div>
              <p className="pe-0.5 pb-1.5 ps-2 text-[11px] leading-snug text-muted-foreground">
                <IconKey className="me-1.5 inline-block h-3 w-3 align-text-top" />
                {t("org.createOrgVaultNotice")}
              </p>
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
                  className="flex flex-1 items-center justify-center rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {createOrg.isPending ? (
                    <IconLoader2 className="h-3 w-3 animate-spin" />
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
                  className="flex flex-1 items-center justify-center rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {inviteMember.isPending ? (
                    <IconLoader2 className="h-3 w-3 animate-spin" />
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
