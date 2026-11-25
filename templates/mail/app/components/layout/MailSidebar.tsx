import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { usePersistentSidebarCollapsed } from "@agent-native/toolkit/app-shell";
import { DevDatabaseLink } from "@agent-native/toolkit/app/db-admin";
import { FeedbackButton } from "@agent-native/toolkit/app/feedback";
import {
  BuilderCreditNotice,
  OrgSwitcher,
} from "@agent-native/toolkit/app/org";
import {
  AppSidebar,
  AppSidebarFooter,
  AppSidebarHeader,
  AppSidebarNavItem,
  AppSidebarSection,
  type AppSidebarItemDefinition,
} from "@agent-native/toolkit/app/shared";
import {
  IconArchive,
  IconClock,
  IconFileText,
  IconInbox,
  IconMail,
  IconPlus,
  IconSend,
  IconStar,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState, type ComponentType } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import { MailCount } from "./MailCount";

export const MAIL_SIDEBAR_COLLAPSED_KEY = "mail.sidebar.collapsed";
const WIDE_WINDOW_QUERY = "(min-width: 1280px)";

const DRAFTS_VIEWS = new Set(["drafts", "scheduled", "draft-queue"]);

const MAIL_SIDEBAR_VIEWS: {
  id: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "inbox", labelKey: "mail.views.inbox", icon: IconInbox },
  { id: "unread", labelKey: "mail.views.unread", icon: IconMail },
  { id: "starred", labelKey: "mail.views.starred", icon: IconStar },
  { id: "snoozed", labelKey: "mail.views.snoozed", icon: IconClock },
  { id: "sent", labelKey: "mail.views.sent", icon: IconSend },
  { id: "drafts", labelKey: "mail.views.drafts", icon: IconFileText },
  { id: "archive", labelKey: "mail.views.archive", icon: IconArchive },
  { id: "trash", labelKey: "mail.views.trash", icon: IconTrash },
];

export interface MailSidebarLabel {
  id: string;
  href: string;
  label: string;
  fullLabel?: string | undefined;
  color?: string | undefined;
  unread?: number | undefined;
  depth: number;
  isActive: boolean;
}

export interface MailSidebarProps {
  view: string;
  labels?: MailSidebarLabel[];
  inboxUnreadCount?: number | undefined;
  queuedDraftCount: number;
  onNewLabel?: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  className?: string;
}

function useIsWideWindow(): boolean {
  const [wide, setWide] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia(WIDE_WINDOW_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(WIDE_WINDOW_QUERY);
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    onChange();
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function MailSidebar({
  view,
  labels = [],
  inboxUnreadCount,
  queuedDraftCount,
  onNewLabel,
  mobileOpen,
  onMobileOpenChange,
  className,
}: MailSidebarProps) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const isMobile = useIsMobile();
  const isWideWindow = useIsWideWindow();
  const { collapsed, setCollapsed } = usePersistentSidebarCollapsed({
    storageKey: MAIL_SIDEBAR_COLLAPSED_KEY,
    defaultCollapsed: !isWideWindow,
  });
  const showCollapsed = collapsed && !isMobile;
  const closeMobile = () => {
    if (isMobile) onMobileOpenChange(false);
  };

  const items: AppSidebarItemDefinition[] = MAIL_SIDEBAR_VIEWS.map((item) => ({
    id: item.id,
    to: `/${item.id}`,
    label: t(item.labelKey),
    icon: item.icon,
    active: item.id === "drafts" ? DRAFTS_VIEWS.has(view) : view === item.id,
    onClick: closeMobile,
    badge:
      item.id === "drafts" && queuedDraftCount > 0 ? (
        <MailCount
          display={formatNumber(queuedDraftCount)}
          meaning={t("mail.inbox.draftsToReviewCount", {
            count: formatNumber(queuedDraftCount),
          })}
          className="text-xs text-amber-300 tabular-nums"
        />
      ) : item.id === "inbox" && !!inboxUnreadCount && inboxUnreadCount > 0 ? (
        <MailCount
          display={formatNumber(inboxUnreadCount)}
          meaning={t("mail.inbox.unreadCount", {
            count: formatNumber(inboxUnreadCount),
          })}
          className="text-xs text-muted-foreground/50 tabular-nums"
        />
      ) : undefined,
  }));

  const sidebar = (
    <AppSidebar
      appId="mail"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      collapsible={!isMobile}
      isMobile={isMobile}
      overflowAffordances
      items={items}
      headerContent={
        <AppSidebarHeader
          brandName={t("mail.appName")}
          appId="mail"
          brandHref="/inbox"
          onBrandClick={closeMobile}
        >
          {isMobile && (
            <DialogClose asChild>
              <button
                type="button"
                className="ms-auto flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                aria-label={t("mail.toolbar.closeSidebar")}
              >
                <IconX className="h-4 w-4" />
              </button>
            </DialogClose>
          )}
        </AppSidebarHeader>
      }
      footerContent={
        <>
          {!showCollapsed && (
            <BuilderCreditNotice className="mx-2 mb-2 shrink-0" />
          )}
          <AppSidebarFooter
            collapsible={!isMobile}
            expandLabel={t("sidebar.expandSidebar")}
            collapseLabel={t("sidebar.collapseSidebar")}
            feedback={
              <FeedbackButton
                variant={showCollapsed ? "icon" : "sidebar"}
                side="right"
              />
            }
            orgSwitcher={
              <OrgSwitcher
                compact={showCollapsed}
                hideBuilderCreditNotice
                className={cn(
                  "!bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary",
                  !showCollapsed && "min-w-0 flex-1",
                )}
              />
            }
            footerExtras={<DevDatabaseLink />}
          />
        </>
      }
      className={
        isMobile ? "min-h-0 flex-1 border-e-0" : cn("shrink-0", className)
      }
    >
      {!showCollapsed && (labels.length > 0 || onNewLabel) && (
        <AppSidebarSection title={t("mail.views.labels")}>
          {labels.map((label) => (
            <AppSidebarNavItem
              key={label.id}
              to={label.href}
              active={label.isActive}
              onClick={closeMobile}
              label={
                <span
                  className="flex min-w-0 items-center gap-2"
                  style={{ paddingInlineStart: label.depth * 12 }}
                >
                  {label.color && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                  )}
                  <span
                    data-an-block
                    className="truncate"
                    title={label.fullLabel ?? label.label}
                  >
                    {label.label}
                  </span>
                </span>
              }
              badge={
                label.unread !== undefined && label.unread > 0 ? (
                  <MailCount
                    display={formatNumber(label.unread)}
                    meaning={t("mail.inbox.unreadCount", {
                      count: formatNumber(label.unread),
                    })}
                    className="text-xs text-muted-foreground tabular-nums"
                  />
                ) : undefined
              }
            />
          ))}
          {onNewLabel && (
            <AppSidebarNavItem
              icon={IconPlus}
              label={t("mail.actions.newLabel")}
              onClick={() => {
                closeMobile();
                onNewLabel();
              }}
            />
          )}
        </AppSidebarSection>
      )}
    </AppSidebar>
  );

  if (!isMobile) return sidebar;

  return (
    <Dialog open={mobileOpen} onOpenChange={onMobileOpenChange}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        overlayClassName="bg-background/20 backdrop-blur-none"
        className="inset-y-0 start-0 left-0 right-auto flex h-dvh w-65 max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-e border-border bg-sidebar p-0 shadow-none rtl:left-auto rtl:right-0"
      >
        <DialogTitle className="sr-only">{t("mail.appName")}</DialogTitle>
        {sidebar}
      </DialogContent>
    </Dialog>
  );
}
