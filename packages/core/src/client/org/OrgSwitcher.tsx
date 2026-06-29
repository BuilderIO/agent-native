import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  IconApps,
  IconArrowUpRight,
  IconBrain,
  IconBrandJira,
  IconBrush,
  IconBuilding,
  IconCalendar,
  IconCalendarTime,
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconClipboardList,
  IconCode,
  IconContract,
  IconFileText,
  IconLayoutBoard,
  IconLoader2,
  IconLogout,
  IconMail,
  IconMessageCircle,
  IconMicrophone,
  IconNote,
  IconPhone,
  IconPhoto,
  IconPlus,
  IconPresentation,
  IconRoute,
  IconScreenShare,
  IconSelector,
  IconSettings,
  IconStack2,
  IconUser,
  IconUserPlus,
  IconUsers,
  IconVideo,
  IconWorld,
} from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { agentNativePath } from "../api-path.js";
import {
  useOrg,
  useSwitchOrg,
  useCreateOrg,
  useInviteMember,
  useAcceptInvitation,
  useJoinByDomain,
} from "./hooks.js";
import {
  ORG_SWITCHER_MAX_APP_LINKS,
  useOrgSwitcherAppLinks,
  visibleOrgAppLinks,
  type OrgSwitcherAppLink,
} from "./workspace-app-links.js";

export interface OrgSwitcherProps {
  className?: string;
  /** Hide entirely when the user only belongs to one org. Default: false. */
  hideWhenSingle?: boolean;
  /** Keep the switcher's button height reserved while org state is loading. */
  reserveSpace?: boolean;
  /**
   * Path to navigate to when the user clicks "Organization settings".
   * Defaults to the standard Team tab inside Settings. Templates with an
   * established org surface can pass their own path; pass `null` to only open
   * the in-sidebar settings panel.
   */
  settingsPath?: string | null;
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

const APP_SUBMENU_CONTENT_CLASS =
  "z-50 w-72 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2";

const DEFAULT_ORGANIZATION_SETTINGS_PATH = "/settings#team";

const APP_ICON_MAP: Record<string, typeof IconApps> = {
  Mail: IconMail,
  CalendarDays: IconCalendar,
  FileText: IconFileText,
  LayoutBoard: IconLayoutBoard,
  BarChart2: IconChartBar,
  GalleryHorizontal: IconPresentation,
  Video: IconVideo,
  BrandJira: IconBrandJira,
  ClipboardList: IconClipboardList,
  Users: IconUsers,
  Code: IconCode,
  Contract: IconContract,
  MessageCircle: IconMessageCircle,
  Route: IconRoute,
  ScreenShare: IconScreenShare,
  Brush: IconBrush,
  Brain: IconBrain,
  Phone: IconPhone,
  Note: IconNote,
  Microphone: IconMicrophone,
  CalendarTime: IconCalendarTime,
  Globe: IconWorld,
  Photo: IconPhoto,
};

function appMenuIcon(app: OrgSwitcherAppLink): typeof IconApps {
  if (app.icon) return APP_ICON_MAP[app.icon] ?? IconStack2;
  return app.isDispatch ? IconMessageCircle : IconStack2;
}

function organizationSettingsPath(path: string): string {
  return path.includes("#") ? path : `${path}#team`;
}

function AppMenuLink({
  app,
  onNavigate,
}: {
  app: OrgSwitcherAppLink;
  onNavigate: () => void;
}) {
  const Icon = appMenuIcon(app);
  return (
    <a
      href={app.href}
      onClick={onNavigate}
      className={`flex items-center gap-2 rounded-sm px-2.5 py-2 text-xs outline-none hover:bg-accent focus:bg-accent ${
        app.isDispatch ? "border border-primary/20 bg-primary/5" : ""
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
          app.isDispatch
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">
          {app.name}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {app.isDispatch
            ? "Main hub"
            : app.status === "pending"
              ? "Building"
              : "Open app"}
        </span>
      </span>
      <IconArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

function AppsSubmenu({
  apps,
  isWorkspace,
  isLoading,
  dispatchHref,
  dispatchAllAppsHref,
  onNavigate,
}: {
  apps: OrgSwitcherAppLink[];
  isWorkspace: boolean;
  isLoading: boolean;
  dispatchHref: string;
  dispatchAllAppsHref: string;
  onNavigate: () => void;
}) {
  const { links, overflowCount } = visibleOrgAppLinks(apps);
  const visibleDispatchApp = links.find((app) => app.isDispatch);
  const dispatchApp =
    visibleDispatchApp ??
    ({
      id: "dispatch",
      name: "Dispatch",
      href: dispatchHref,
      isDispatch: true,
      status: "ready",
    } satisfies OrgSwitcherAppLink);
  const visibleNonDispatch = links
    .filter((app) => !app.isDispatch)
    .slice(0, visibleDispatchApp ? undefined : ORG_SWITCHER_MAX_APP_LINKS - 1);
  const shownCount = (dispatchApp ? 1 : 0) + visibleNonDispatch.length;
  const remainingCount = Math.max(overflowCount, apps.length - shownCount);

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" className={`${ITEM_CLASS} cursor-pointer`}>
          <IconApps className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-start">Apps</span>
          <span className="text-[11px] text-muted-foreground">
            {isLoading ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              apps.length
            )}
          </span>
          <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className={APP_SUBMENU_CONTENT_CLASS}
        >
          <div className="px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {isWorkspace ? "Workspace apps" : "Default apps"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {isWorkspace
                ? "Dispatch is the workspace hub."
                : "Dispatch is the home base."}
            </div>
          </div>

          <AppMenuLink app={dispatchApp} onNavigate={onNavigate} />

          {visibleNonDispatch.length > 0 && (
            <div className="my-1 h-px bg-border" />
          )}
          {visibleNonDispatch.map((app) => (
            <AppMenuLink key={app.id} app={app} onNavigate={onNavigate} />
          ))}

          {remainingCount > 0 && (
            <>
              <div className="my-1 h-px bg-border" />
              <a
                href={dispatchAllAppsHref}
                onClick={onNavigate}
                className="flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs text-foreground outline-none hover:bg-accent focus:bg-accent"
              >
                <IconMessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">
                  {`View ${remainingCount} more in Dispatch`}
                </span>
                <IconArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </a>
            </>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

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
  settingsPath = DEFAULT_ORGANIZATION_SETTINGS_PATH,
}: OrgSwitcherProps) {
  const { data: org, isLoading } = useOrg();
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
  const appLinks = useOrgSwitcherAppLinks(open);

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
  const organizationSettingsHref = settingsPath
    ? organizationSettingsPath(settingsPath)
    : null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={`flex w-full items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer ${className ?? ""}`}
        >
          <ButtonIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1 text-start">{buttonLabel}</span>
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
                  <span className="truncate flex-1 text-start">
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
                  <span className="truncate flex-1 text-start">
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
              <AppsSubmenu
                apps={appLinks.apps}
                isWorkspace={appLinks.isWorkspace}
                isLoading={appLinks.isLoading}
                dispatchHref={appLinks.dispatchHref}
                dispatchAllAppsHref={appLinks.dispatchAllAppsHref}
                onNavigate={() => setOpen(false)}
              />
              {inOrg && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    window.dispatchEvent(new CustomEvent("agent-panel:open"));
                    window.dispatchEvent(
                      new CustomEvent("agent-panel:open-settings", {
                        detail: { section: "workspace-settings" },
                      }),
                    );
                    if (organizationSettingsHref) {
                      navigate(organizationSettingsHref);
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
                  // Clear any leftover input from a prior session — otherwise
                  // the create form re-opens prefilled with the just-created
                  // org's name and looks like a create dialog for the new org.
                  setNewName("");
                  setMode("create");
                }}
                className={`${ITEM_CLASS} cursor-pointer`}
              >
                <IconPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-start">Create organization</span>
              </button>
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
                  {org.email ? (
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
