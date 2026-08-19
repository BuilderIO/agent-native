import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  IconApps,
  IconArrowUpRight,
  IconBrain,
  IconBrandJira,
  IconBrush,
  IconCalendar,
  IconCalendarTime,
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconClipboardList,
  IconCode,
  IconExternalLink,
  IconFileText,
  IconKey,
  IconLayoutBoard,
  IconListCheck,
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
  IconUserCircle,
  IconUserPlus,
  IconUsers,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { setBrowserDemoModeEnabled } from "../../demo/browser-state.js";
import { shouldOfferWorkspace } from "../../org/workspace-url.js";
import { agentNativePath } from "../api-path.js";
import { useT } from "../i18n.js";
import { buildSignInReturnHref } from "../require-session.js";
import { useDemoModeStatus } from "../use-demo-mode-status.js";
import { notifySessionInvalidated, useSession } from "../use-session.js";
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
   * Icon-only trigger for collapsed sidebar rails. The popover — and with it
   * the org list, pending invitations and "Join your team" — is identical;
   * dropping the switcher instead leaves a collapsed rail with no way to
   * reach another workspace.
   */
  compact?: boolean;
  /**
   * Path to navigate to when the user clicks "Organization settings".
   * Defaults to the Organization tab inside Settings. Templates with an
   * established org surface can pass their own path; pass `null` to only open
   * the in-sidebar settings panel.
   */
  settingsPath?: string | null;
  /** Path to navigate to when the user clicks "Profile". Defaults to the shared Account settings section. */
  profilePath?: string | null;
  /**
   * Path to the Manage agent page. Settings links here too, but the switcher
   * is the only always-visible surface, so omitting it leaves Files,
   * Instructions, Memory, Skills and Automations reachable only from Settings.
   * Pass `null` for apps that do not mount the Agent page.
   */
  agentPath?: string | null;
  /** Omit the link to the app that currently owns this switcher. */
  currentAppId?: string;
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

const SWITCHER_BUTTON_CLASS =
  "flex w-full items-center gap-2 rounded-md border-0 bg-accent/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 cursor-pointer";

const COMPACT_SWITCHER_BUTTON_CLASS =
  "flex items-center justify-center rounded-md border-0 bg-accent/50 p-1.5 text-muted-foreground hover:bg-accent/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 cursor-pointer";

const DEFAULT_ORGANIZATION_SETTINGS_PATH = "/settings/organization";
const DEFAULT_PROFILE_PATH = "/settings/account";
const DEFAULT_AGENT_PATH = "/settings/agent";

const APP_ICON_MAP: Record<string, typeof IconApps> = {
  Mail: IconMail,
  CalendarDays: IconCalendar,
  FileText: IconFileText,
  LayoutBoard: IconLayoutBoard,
  BarChart2: IconChartBar,
  GalleryHorizontal: IconPresentation,
  BrandJira: IconBrandJira,
  ClipboardList: IconClipboardList,
  Users: IconUsers,
  Code: IconCode,
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
  ListCheck: IconListCheck,
};

function appMenuIcon(app: OrgSwitcherAppLink): typeof IconApps {
  if (app.icon) return APP_ICON_MAP[app.icon] ?? IconStack2;
  return app.isDispatch ? IconMessageCircle : IconStack2;
}

function organizationSettingsPath(path: string): string {
  if (path.includes("#")) return path;
  const pathname = path.split("?")[0]?.replace(/\/+$/, "");
  return pathname === "/settings" ? `${path}#organization` : path;
}

function AppMenuLink({
  app,
  onNavigate,
}: {
  app: OrgSwitcherAppLink;
  onNavigate: () => void;
}) {
  const Icon = appMenuIcon(app);
  const description =
    app.status === "pending"
      ? "Building"
      : app.description?.trim() ||
        (app.isDispatch ? "Workspace hub" : `${app.name} workspace`);
  return (
    <a
      href={app.href}
      onClick={onNavigate}
      className="flex items-center gap-2 rounded-sm px-2.5 py-2 text-xs outline-none hover:bg-accent focus:bg-accent"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">
          {app.name}
        </span>
        <span
          className="block truncate text-[11px] text-muted-foreground"
          title={description}
        >
          {description}
        </span>
      </span>
      <IconArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

function AppsSubmenu({
  apps,
  isLoading,
  dispatchHref,
  dispatchAllAppsHref,
  currentAppId,
  onNavigate,
}: {
  apps: OrgSwitcherAppLink[];
  isLoading: boolean;
  dispatchHref: string;
  dispatchAllAppsHref: string;
  currentAppId?: string;
  onNavigate: () => void;
}) {
  const appsForMenu = currentAppId
    ? apps.filter((app) => app.id !== currentAppId)
    : apps;
  const { links, overflowCount } = visibleOrgAppLinks(appsForMenu);
  const visibleDispatchApp = links.find((app) => app.isDispatch);
  const dispatchApp =
    currentAppId === "dispatch"
      ? null
      : (visibleDispatchApp ??
        ({
          id: "dispatch",
          name: "Dispatch",
          href: dispatchHref,
          isDispatch: true,
          status: "ready",
        } satisfies OrgSwitcherAppLink));
  const visibleNonDispatch = links
    .filter((app) => !app.isDispatch)
    .slice(0, dispatchApp ? undefined : ORG_SWITCHER_MAX_APP_LINKS);
  const shownCount = (dispatchApp ? 1 : 0) + visibleNonDispatch.length;
  const remainingCount = Math.max(
    overflowCount,
    appsForMenu.length - shownCount,
  );

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
              appsForMenu.length
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
          {dispatchApp && (
            <AppMenuLink app={dispatchApp} onNavigate={onNavigate} />
          )}

          {dispatchApp && visibleNonDispatch.length > 0 && (
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
                <IconApps className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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

function ReservedOrgSwitcherSpace({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`h-8 ${className ?? ""}`} />;
}

function OrgSwitcherLoadingPlaceholder({ className }: { className?: string }) {
  return (
    <button
      type="button"
      disabled
      aria-label="Loading organization"
      className={`${SWITCHER_BUTTON_CLASS} animate-pulse ${className ?? ""}`}
    >
      <IconUsersGroup className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span className="h-3 min-w-0 flex-1 rounded-sm bg-muted-foreground/20" />
      <IconSelector className="h-3 w-3 shrink-0 opacity-30" />
    </button>
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
  compact,
  settingsPath = DEFAULT_ORGANIZATION_SETTINGS_PATH,
  profilePath = DEFAULT_PROFILE_PATH,
  agentPath = DEFAULT_AGENT_PATH,
  currentAppId,
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
      /* continue to sign-in — the server may already have cleared the cookie */
    }
    notifySessionInvalidated();
    window.location.href = buildSignInReturnHref();
  };

  if (!org) {
    return reserveSpace && isLoading ? (
      <OrgSwitcherLoadingPlaceholder className={className} />
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
    !!org.orgId && (org.role === "owner" || org.role === "admin");

  const personalLabel = session?.name || personalLabelFromEmail(org.email);
  const inOrg = !!org.orgId;
  const buttonLabel = org.orgName ?? "Personal";
  const triggerLabel = demoModeEnabled
    ? `${buttonLabel}, Demo mode`
    : buttonLabel;
  const ButtonIcon = inOrg ? IconUsersGroup : IconUser;
  const organizationSettingsHref = settingsPath
    ? organizationSettingsPath(settingsPath)
    : null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        {compact ? (
          <button
            type="button"
            title={triggerLabel}
            aria-label={triggerLabel}
            className={`${COMPACT_SWITCHER_BUTTON_CLASS} ${className ?? ""}`}
          >
            <ButtonIcon className="h-3.5 w-3.5 shrink-0" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={triggerLabel}
            className={`${SWITCHER_BUTTON_CLASS} ${className ?? ""}`}
          >
            <ButtonIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate flex-1 text-start">{buttonLabel}</span>
            {demoModeEnabled && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                <IconPresentation className="h-3 w-3" aria-hidden="true" />
                Demo mode
              </span>
            )}
            <IconSelector className="h-3 w-3 shrink-0 opacity-50" />
          </button>
        )}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={`${POPOVER_CONTENT_CLASS} ${mode === "list" ? "" : "w-64"}`}
          onOpenAutoFocus={(e) => {
            // Don't auto-focus the first item — feels heavy on a switcher.
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
                  <IconUsersGroup className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
                    <div key={inv.id} className="px-2.5 py-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <IconUsersGroup className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
                isLoading={appLinks.isLoading}
                dispatchHref={appLinks.dispatchHref}
                dispatchAllAppsHref={appLinks.dispatchAllAppsHref}
                currentAppId={currentAppId}
                onNavigate={() => setOpen(false)}
              />
              {profilePath && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(profilePath);
                  }}
                  className={`${ITEM_CLASS} cursor-pointer`}
                >
                  <IconUserCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-start">
                    {t("settings.profileMenuItem")}
                  </span>
                </button>
              )}
              {agentPath && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(agentPath);
                  }}
                  className={`${ITEM_CLASS} cursor-pointer`}
                >
                  <IconBrain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-start">
                    {t("settings.manageAgentMenuItem", {
                      defaultValue: "Manage agent",
                    })}
                  </span>
                </button>
              )}
              {inOrg && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (organizationSettingsHref) {
                      navigate(organizationSettingsHref);
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
