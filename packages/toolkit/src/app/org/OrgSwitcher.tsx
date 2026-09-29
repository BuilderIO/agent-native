import { useActionQuery } from "@agent-native/core/client/hooks";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useDemoModeStatus } from "@agent-native/core/client/hooks";
import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useOrg,
  useSwitchOrg,
  useCreateOrg,
  useAcceptInvitation,
  useJoinByDomain,
} from "@agent-native/core/client/org";
import { signOut } from "@agent-native/core/client/sign-out";
import { setBrowserDemoModeEnabled } from "@agent-native/core/demo/browser-state";
import { buildSettingsRoute } from "@agent-native/core/navigation";
import { shouldOfferWorkspace } from "@agent-native/core/org/workspace-url";
import { builderSubscriptionUpgradeUrl } from "@agent-native/core/shared/builder-link-tracking";
import type { UserProfile } from "@agent-native/core/user-profile/shared";
import {
  ActionButton,
  Avatar,
  TextField,
} from "@agent-native/toolkit/design-system";
import { ResourceIcon } from "@agent-native/toolkit/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconArrowUpRight,
  IconBriefcase,
  IconChartBar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconExternalLink,
  IconAlertCircle,
  IconKey,
  IconLoader2,
  IconLogout,
  IconPlus,
  IconPresentation,
  IconSelector,
  IconSettings,
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
  /** Render its Builder credit notice elsewhere in the sidebar. */
  hideBuilderCreditNotice?: boolean;
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

export function BuilderCreditNotice({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { data: org } = useOrg();
  const builderCreditStatus = useActionQuery<{
    exhausted: boolean;
    period?: "daily" | "monthly";
  } | null>(
    "get-builder-credit-status",
    { orgId: org?.orgId ?? null },
    {
      enabled: Boolean(org?.email),
      staleTime: 30_000,
      refetchInterval: 60_000,
    },
  );
  const t = useT();

  if (
    builderCreditStatus.isError ||
    builderCreditStatus.data?.exhausted !== true
  ) {
    return null;
  }

  const quotaLabel =
    builderCreditStatus.data.period === "daily"
      ? t("agentChat.usage.dailyDefaultLimit")
      : builderCreditStatus.data.period === "monthly"
        ? t("agentChat.usage.monthlyLimit")
        : null;
  const title = [t("agentChat.billing.builderCreditLimitTitle"), quotaLabel]
    .filter((label): label is string => label !== null)
    .join(" · ");
  const builderUpgradeUrl = builderSubscriptionUpgradeUrl(
    "builder_credit_limit_sidebar",
  );
  const noticeLabel = [title, t("agentChat.billing.builderCreditUpgrade")].join(
    " · ",
  );

  return compact ? (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={builderUpgradeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={noticeLabel}
            className="mx-auto inline-flex size-8 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconAlertCircle className="size-4" aria-hidden="true" />
          </a>
        </TooltipTrigger>
        <TooltipContent side="right">{noticeLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    <div
      role="status"
      className={cn(
        "rounded-md border border-border bg-muted px-2.5 py-2 text-xs",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <IconAlertCircle
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="leading-snug text-foreground">{title}</p>
          <a
            href={builderUpgradeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {t("agentChat.billing.builderCreditUpgrade")}
            <IconArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}

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

function ReservedOrgSwitcherSpace({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("h-8", !compact && "flex-1", className)}
    />
  );
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
        !compact && "flex-1",
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
  hideBuilderCreditNotice,
  utilityLinks,
}: OrgSwitcherProps) {
  const { data: org, isLoading, dataUpdatedAt } = useOrg();
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

  // Accounts that picked the retired "Personal" choice have `orgId: null`
  // stored while still holding memberships, which strands them outside the
  // org-scoped Builder.io connection and vault credentials. Move them back.
  // A failed switch retries on the next org fetch, not on the next render:
  // the mutation's state changes would otherwise re-run this in a tight loop.
  const personalRecoveryRef = useRef(false);
  const firstMembershipId = org?.orgs?.[0]?.orgId ?? null;
  const switchOrgMutate = switchOrg.mutate;
  useEffect(() => {
    if (org?.orgId || !firstMembershipId || personalRecoveryRef.current) {
      return;
    }
    personalRecoveryRef.current = true;
    switchOrgMutate(firstMembershipId, {
      onError: () => {
        personalRecoveryRef.current = false;
      },
    });
  }, [org?.orgId, firstMembershipId, switchOrgMutate, dataUpdatedAt]);

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
      <ReservedOrgSwitcherSpace className={className} compact={compact} />
    ) : null;
  }
  if (
    hideWhenSingle &&
    orgCount < 2 &&
    pendingInvitations.length === 0 &&
    domainMatches.length === 0
  ) {
    return reserveSpace ? (
      <ReservedOrgSwitcherSpace className={className} compact={compact} />
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

  const selectOrg = (orgId: string) => {
    if (orgId === org.orgId) {
      setOpen(false);
      return;
    }
    switchOrg.mutate(orgId, { onSuccess: () => setOpen(false) });
  };
  const isSwitchingTo = (orgId: string) =>
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
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1.5",
          !compact && "flex-1",
          compact && "items-center",
        )}
      >
        {!hideBuilderCreditNotice && <BuilderCreditNotice compact={compact} />}
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
      </div>

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
