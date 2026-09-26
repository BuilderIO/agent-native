import {
  ActionButton,
  Avatar,
  TextField,
} from "@agent-native/toolkit/design-system";
import { ResourceIcon } from "@agent-native/toolkit/icons";
import {
  IconArrowUpRight,
  IconBriefcase,
  IconChartBar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconLogout,
  IconPlus,
  IconPresentation,
  IconSelector,
  IconSettings,
  IconUser,
  IconUsersGroup,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router";

import { setBrowserDemoModeEnabled } from "../../demo/browser-state.js";
import { buildSettingsRoute } from "../../navigation/index.js";
import { shouldOfferWorkspace } from "../../org/workspace-url.js";
import type { UserProfile } from "../../user-profile/shared.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { signOut } from "../sign-out.js";
import { useActionQuery } from "../use-action.js";
import { useAvatarUrl } from "../use-avatar.js";
import { useDemoModeStatus } from "../use-demo-mode-status.js";
import { useSession } from "../use-session.js";
import { cn } from "../utils.js";
import {
  useOrg,
  useSwitchOrg,
  useCreateOrg,
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
  /** Hide entirely when the user only belongs to one org. Default: false. */
  hideWhenSingle?: boolean;
  /** Keep the switcher's slot reserved when there is no organization to show. */
  reserveSpace?: boolean;
  /**
   * Avatar-only trigger for collapsed sidebar rails. The menu, and with it the
   * org list, pending invitations and "Join your team", is identical; dropping
   * the menu instead leaves a collapsed rail with no way to reach another
   * workspace or Settings.
   */
  compact?: boolean;
  /**
   * @deprecated The account menu no longer has an "Organization settings"
   * item. Settings opens through the shared settings route. Accepted for one
   * release so existing callers keep compiling.
   */
  settingsPath?: string | null;
  /**
   * @deprecated The account menu no longer has a "Profile" item. Settings
   * opens on the account page through the shared settings route.
   */
  profilePath?: string | null;
  /** @deprecated Manage agent is available in Settings and is not shown here. */
  agentPath?: string | null;
  /** @deprecated The switcher no longer renders an app list. */
  currentAppId?: string;
  /**
   * App-owned downloads, listed under "Get apps and extensions". The item is
   * hidden when no links are passed.
   */
  utilityLinks?: readonly OrgSwitcherUtilityLink[];
}

export type AccountMenuProps = OrgSwitcherProps;
export type AccountMenuUtilityLink = OrgSwitcherUtilityLink;

function nameFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  const local = email.split("@")[0] ?? email;
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function initials(name: string): string {
  return (
    name
      .split(/[ @._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function isApplePlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
  );
}

type MenuView = "main" | "apps";

const ITEM_CLASS = "text-xs";
const ITEM_ICON_CLASS = "size-3.5 shrink-0 text-muted-foreground";

const TRIGGER_CLASS =
  "flex w-full min-w-0 items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-start text-foreground hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 data-[state=open]:bg-accent/60 cursor-pointer";

const COMPACT_TRIGGER_CLASS =
  "flex items-center justify-center rounded-md border-0 bg-transparent p-1 text-foreground hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 data-[state=open]:bg-accent/60 cursor-pointer";

const AVATAR_CLASS =
  "shrink-0 rounded-full border border-border bg-accent text-[11px] font-semibold text-muted-foreground";

function ReservedOrgSwitcherSpace({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`h-8 ${className ?? ""}`} />;
}

function OrgSwitcherLoadingPlaceholder({
  className,
  compact,
  label,
}: {
  className?: string;
  compact?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled
      aria-label={label}
      className={cn(
        compact ? COMPACT_TRIGGER_CLASS : TRIGGER_CLASS,
        "animate-pulse",
        className,
      )}
    >
      {compact ? (
        <span className="size-6 rounded-full bg-muted-foreground/20" />
      ) : (
        <>
          <span className="size-7 shrink-0 rounded-full bg-muted-foreground/20" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="h-3 w-3/4 rounded-sm bg-muted-foreground/20" />
            <span className="h-2.5 w-1/2 rounded-sm bg-muted-foreground/15" />
          </span>
          <IconSelector className="size-3.5 shrink-0 opacity-30" />
        </>
      )}
    </button>
  );
}

/**
 * Account menu for app sidebars. The trigger shows the signed-in person's
 * photo, name, and current organization; the menu lists organizations,
 * pending invitations, and domain matches, then Settings, Usage, the app's
 * downloads, and Log out. Renders nothing in dev / no-auth mode.
 */
export function OrgSwitcher({
  className,
  hideWhenSingle,
  reserveSpace,
  compact,
  utilityLinks,
}: OrgSwitcherProps) {
  const { data: org, isLoading } = useOrg();
  const { session } = useSession();
  const { enabled: demoModeEnabled } = useDemoModeStatus();
  const t = useT();
  const switchOrg = useSwitchOrg();
  const createOrg = useCreateOrg();
  const acceptInvitation = useAcceptInvitation();
  const joinByDomain = useJoinByDomain();
  const navigate = useNavigate();
  const email = session?.email ?? org?.email ?? null;
  const profileQuery = useActionQuery<UserProfile>(
    "get-user-profile",
    undefined,
    { enabled: !!email },
  );
  const avatarUrl = useAvatarUrl(email);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("main");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const viewChangedRef = useRef(false);
  const openingDialogRef = useRef(false);
  const settingsShortcut = useMemo(
    () => (isApplePlatform() ? "⌘," : "Ctrl+,"),
    [],
  );

  // The drill-in swaps the menu's items, which unmounts the focused one.
  // Hand focus to the first item of the new list so arrow keys keep working.
  useEffect(() => {
    if (!viewChangedRef.current) return;
    viewChangedRef.current = false;
    contentRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
      ?.focus();
  }, [view]);

  const showView = (next: MenuView) => {
    viewChangedRef.current = true;
    setView(next);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setView("main");
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await signOut();
  };

  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    // Failures stay on `createOrg.error`, which the dialog renders.
    createOrg.mutate(name, {
      onSuccess: () => {
        setCreateOpen(false);
        setNewName("");
      },
    });
  };

  if (!org) {
    return isLoading ? (
      <OrgSwitcherLoadingPlaceholder
        className={className}
        compact={compact}
        label={t("agentChat.accountMenu.loading")}
      />
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

  const inOrg = !!org.orgId;
  const organizationLabel = org.orgName ?? t("agentChat.accountMenu.personal");
  const displayName =
    profileQuery.data?.name ||
    session?.name ||
    nameFromEmail(org.email) ||
    organizationLabel;
  const triggerLabel = demoModeEnabled
    ? t("agentChat.accountMenu.triggerLabelDemo", {
        name: displayName,
        organization: organizationLabel,
      })
    : t("agentChat.accountMenu.triggerLabel", {
        name: displayName,
        organization: organizationLabel,
      });
  const workspaceUrl =
    typeof window !== "undefined" &&
    org.workspaceUrl &&
    shouldOfferWorkspace(window.location.href, org.workspaceUrl)
      ? org.workspaceUrl
      : null;
  const links = utilityLinks ?? [];
  const menuError = (switchOrg.error ||
    acceptInvitation.error ||
    joinByDomain.error) as Error | null;

  const avatar = (
    <Avatar
      name={displayName}
      src={avatarUrl}
      fallback={initials(displayName)}
      className={cn(AVATAR_CLASS, compact ? "size-6" : "size-7")}
    />
  );

  const trigger = compact ? (
    <button
      type="button"
      aria-label={triggerLabel}
      className={cn(COMPACT_TRIGGER_CLASS, className)}
    >
      {avatar}
    </button>
  ) : (
    <button
      type="button"
      aria-label={triggerLabel}
      className={cn(TRIGGER_CLASS, className)}
    >
      {avatar}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium leading-tight">
          {displayName}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs leading-tight text-muted-foreground">
          {inOrg && org.icon ? (
            <ResourceIcon
              value={org.icon}
              size={12}
              resolveImageUrl={(image) =>
                image.authority === "url" ? image.assetId : undefined
              }
              fallback={<IconBriefcase className="size-3 shrink-0" />}
            />
          ) : null}
          <span className="truncate">{organizationLabel}</span>
          {demoModeEnabled && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
              <IconPresentation className="size-3" aria-hidden="true" />
              {t("agentChat.accountMenu.demoMode")}
            </span>
          )}
        </span>
      </span>
      <IconSelector className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );

  const selectOrg = (orgId: string | null) => {
    if (orgId === (org.orgId ?? null)) {
      setOpen(false);
      return;
    }
    // `null` switches to Personal, which the server stores as an explicit
    // choice rather than falling back to the first membership.
    switchOrg.mutate(orgId, { onSuccess: () => setOpen(false) });
  };
  const isSwitchingTo = (orgId: string | null) =>
    switchOrg.isPending && switchOrg.variables === orgId;

  const mainItems = (
    <>
      {!demoModeEnabled && org.email ? (
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {org.email}
        </DropdownMenuLabel>
      ) : null}
      {demoModeEnabled && (
        <>
          <div
            role="status"
            className="mx-1 mb-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px]"
          >
            <div className="flex items-center gap-1.5 font-medium text-primary">
              <IconPresentation
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
              {t("agentChat.accountMenu.demoModeOn")}
            </div>
            <p className="mt-0.5 leading-snug text-muted-foreground">
              {t("agentChat.accountMenu.demoModeDescription")}
            </p>
          </div>
          <DropdownMenuItem
            className={ITEM_CLASS}
            onSelect={() => setBrowserDemoModeEnabled(false)}
          >
            <IconPresentation className={ITEM_ICON_CLASS} />
            <span className="flex-1">
              {t("agentChat.accountMenu.turnOffDemoMode")}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuGroup>
        {orgs.map((o) => {
          const current = o.orgId === org.orgId;
          return (
            <DropdownMenuItem
              key={o.orgId}
              className={ITEM_CLASS}
              disabled={switchOrg.isPending && !current}
              onSelect={(event) => {
                if (current) return;
                event.preventDefault();
                selectOrg(o.orgId);
              }}
            >
              <ResourceIcon
                value={o.icon}
                size={14}
                resolveImageUrl={(image) =>
                  image.authority === "url" ? image.assetId : undefined
                }
                fallback={<IconBriefcase className={ITEM_ICON_CLASS} />}
              />
              <span className="min-w-0 flex-1 truncate">{o.orgName}</span>
              {isSwitchingTo(o.orgId) ? (
                <IconLoader2 className={cn(ITEM_ICON_CLASS, "animate-spin")} />
              ) : current ? (
                <IconCheck className={ITEM_ICON_CLASS} />
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem
          className={ITEM_CLASS}
          disabled={switchOrg.isPending && inOrg}
          onSelect={(event) => {
            if (!inOrg) return;
            event.preventDefault();
            selectOrg(null);
          }}
        >
          <IconUser className={ITEM_ICON_CLASS} />
          <span className="min-w-0 flex-1 truncate">
            {t("agentChat.accountMenu.personal")}
          </span>
          {isSwitchingTo(null) ? (
            <IconLoader2 className={cn(ITEM_ICON_CLASS, "animate-spin")} />
          ) : !inOrg ? (
            <IconCheck className={ITEM_ICON_CLASS} />
          ) : null}
        </DropdownMenuItem>
      </DropdownMenuGroup>

      {pendingInvitations.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel className="pb-0.5 text-[11px] font-normal text-muted-foreground">
            {t("agentChat.accountMenu.invitations")}
          </DropdownMenuLabel>
          {pendingInvitations.map((inv) => (
            <DropdownMenuItem
              key={inv.id}
              className={cn(ITEM_CLASS, "flex-col items-stretch gap-1")}
              disabled={acceptInvitation.isPending}
              onSelect={(event) => {
                event.preventDefault();
                acceptInvitation.mutate(inv.id, {
                  onSuccess: () => setOpen(false),
                });
              }}
            >
              <span className="flex items-center gap-2">
                <IconUsersGroup className={ITEM_ICON_CLASS} />
                <span className="min-w-0 flex-1 truncate">{inv.orgName}</span>
                {acceptInvitation.isPending ? (
                  <IconLoader2
                    className={cn(ITEM_ICON_CLASS, "animate-spin")}
                  />
                ) : (
                  <span className="text-[11px] font-medium text-primary">
                    {t("agentChat.accountMenu.join")}
                  </span>
                )}
              </span>
              {org.orgId && (
                <span className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                  <IconKey className="mt-0.5 size-3 shrink-0" />
                  <span>
                    {t("org.acceptInvitationOrgSwitchNotice", {
                      name: inv.orgName,
                    })}
                  </span>
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      )}

      {domainMatches.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel className="pb-0.5 text-[11px] font-normal text-muted-foreground">
            {t("agentChat.accountMenu.joinYourTeam")}
          </DropdownMenuLabel>
          {domainMatches.map((match) => {
            const isJoining =
              joinByDomain.isPending && joinByDomain.variables === match.orgId;
            return (
              <DropdownMenuItem
                key={match.orgId}
                className={ITEM_CLASS}
                disabled={joinByDomain.isPending}
                onSelect={(event) => {
                  event.preventDefault();
                  joinByDomain.mutate(match.orgId, {
                    onSuccess: () => setOpen(false),
                  });
                }}
              >
                <IconUsersGroup className={ITEM_ICON_CLASS} />
                <span className="min-w-0 flex-1 truncate">{match.orgName}</span>
                {isJoining ? (
                  <IconLoader2
                    className={cn(ITEM_ICON_CLASS, "animate-spin")}
                  />
                ) : (
                  <span className="text-[11px] font-medium text-primary">
                    {t("agentChat.accountMenu.join")}
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      )}

      <DropdownMenuGroup>
        {workspaceUrl && (
          <DropdownMenuItem asChild className={ITEM_CLASS}>
            <a href={workspaceUrl}>
              <IconExternalLink className={ITEM_ICON_CLASS} />
              <span className="flex-1">
                {t("agentChat.accountMenu.yourWorkspace")}
              </span>
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className={ITEM_CLASS}
          onSelect={() => {
            // The menu restores focus to its trigger as it closes, which
            // would pull focus out of the dialog opening in its place.
            openingDialogRef.current = true;
            createOrg.reset();
            setNewName("");
            setCreateOpen(true);
          }}
        >
          <IconPlus className={ITEM_ICON_CLASS} />
          <span className="flex-1">
            {t("agentChat.accountMenu.createOrganization")}
          </span>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem
          className={ITEM_CLASS}
          onSelect={() => void navigate(buildSettingsRoute("account"))}
        >
          <IconSettings className={ITEM_ICON_CLASS} />
          <span className="flex-1">{t("agentChat.common.settings")}</span>
          <DropdownMenuShortcut className="tracking-normal">
            {settingsShortcut}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={ITEM_CLASS}
          onSelect={() => void navigate(buildSettingsRoute("usage"))}
        >
          <IconChartBar className={ITEM_ICON_CLASS} />
          <span className="flex-1">{t("agentChat.accountMenu.usage")}</span>
        </DropdownMenuItem>
        {links.length > 0 && (
          <DropdownMenuItem
            className={ITEM_CLASS}
            onSelect={(event) => {
              event.preventDefault();
              showView("apps");
            }}
          >
            <IconDownload className={ITEM_ICON_CLASS} />
            <span className="flex-1">{t("agentChat.accountMenu.getApps")}</span>
            <IconChevronRight
              className={cn(ITEM_ICON_CLASS, "rtl:-scale-x-100")}
            />
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>

      <DropdownMenuSeparator />
      <DropdownMenuItem
        className={ITEM_CLASS}
        disabled={signingOut}
        onSelect={(event) => {
          event.preventDefault();
          void handleSignOut();
        }}
      >
        {signingOut ? (
          <IconLoader2 className={cn(ITEM_ICON_CLASS, "animate-spin")} />
        ) : (
          <IconLogout className={cn(ITEM_ICON_CLASS, "rtl:-scale-x-100")} />
        )}
        <span className="flex-1">{t("agentChat.auth.logOut")}</span>
      </DropdownMenuItem>

      {menuError && (
        <div
          role="alert"
          className="px-2 pb-1 pt-0.5 text-[11px] text-destructive"
        >
          {menuError.message}
        </div>
      )}
    </>
  );

  const appItems = (
    <>
      <DropdownMenuItem
        className={ITEM_CLASS}
        aria-label={t("agentChat.accountMenu.back")}
        onSelect={(event) => {
          event.preventDefault();
          showView("main");
        }}
      >
        <IconChevronLeft className={cn(ITEM_ICON_CLASS, "rtl:-scale-x-100")} />
        <span className="flex-1">{t("agentChat.accountMenu.getApps")}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {links.map((link) => {
          const content = (
            <>
              <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">
                {link.icon ?? <IconExternalLink />}
              </span>
              <span className="flex-1">{link.label}</span>
              {link.external && (
                <IconArrowUpRight
                  className={cn(ITEM_ICON_CLASS, "rtl:-scale-x-100")}
                />
              )}
            </>
          );
          return (
            <DropdownMenuItem key={link.id} asChild className={ITEM_CLASS}>
              {link.external ? (
                <a href={link.href} target="_blank" rel="noopener noreferrer">
                  {content}
                </a>
              ) : (
                <Link to={link.href}>{content}</Link>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuGroup>
    </>
  );

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        {compact ? (
          // The menu trigger has to sit directly on the button: both Radix
          // slots merge their props into the same DOM node, and a provider
          // between them would swallow the click that opens the menu.
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">
                <span className="block font-medium">{displayName}</span>
                <span className="block opacity-70">{organizationLabel}</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          ref={contentRef}
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={t("agentChat.accountMenu.label")}
          className="w-[max(15.5rem,var(--radix-dropdown-menu-trigger-width))] max-w-[calc(100vw-1.5rem)]"
          onCloseAutoFocus={(event) => {
            if (!openingDialogRef.current) return;
            openingDialogRef.current = false;
            event.preventDefault();
          }}
        >
          {view === "apps" && links.length > 0 ? appItems : mainItems}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          if (createOrg.isPending) return;
          setCreateOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {t("agentChat.accountMenu.createOrganization")}
              </DialogTitle>
              <DialogDescription className="flex items-start gap-1.5 text-xs">
                <IconKey className="mt-0.5 size-3.5 shrink-0" />
                <span>{t("org.createOrgVaultNotice")}</span>
              </DialogDescription>
            </DialogHeader>
            <TextField
              autoFocus
              value={newName}
              onChange={setNewName}
              label={t("agentChat.accountMenu.organizationName")}
              disabled={createOrg.isPending}
              invalid={!!createOrg.error}
              errorMessage={
                createOrg.error ? (createOrg.error as Error).message : undefined
              }
            />
            <DialogFooter>
              <ActionButton
                type="button"
                intent="neutral"
                emphasis="ghost"
                disabled={createOrg.isPending}
                onPress={() => setCreateOpen(false)}
              >
                {t("agentChat.common.cancel")}
              </ActionButton>
              <ActionButton
                type="submit"
                intent="primary"
                pending={createOrg.isPending}
                disabled={createOrg.isPending || !newName.trim()}
              >
                {t("agentChat.accountMenu.create")}
              </ActionButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The account menu under its product name. Same component as `OrgSwitcher`. */
export const AccountMenu = OrgSwitcher;
