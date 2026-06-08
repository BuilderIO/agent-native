import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  IconClipboardCheck,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlus,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import {
  agentNativePath,
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  useSession,
} from "@agent-native/core/client";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { APP_TITLE } from "@/lib/app-config";
import { usePlans } from "@/hooks/use-plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [{ icon: IconClipboardCheck, label: "Plan", href: "/plans" }];

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function formatPlanAge(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function signInForPlanCreate() {
  window.location.href = `${agentNativePath(
    "/_agent-native/sign-in",
  )}?return=${encodeURIComponent("/plans?create=1")}`;
}

function PlansSidebarSection({ collapsed }: { collapsed: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, isLoading: sessionLoading } = useSession();
  const plansQuery = usePlans({
    enabled: Boolean(session),
  });
  const selectedPlanId = location.pathname.match(/^\/plans\/([^/]+)/)?.[1];
  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);

  if (collapsed) return null;

  const requestCreatePlan = () => {
    if (sessionLoading) return;
    if (!session) {
      signInForPlanCreate();
      return;
    }
    navigate("/plans?create=1");
  };

  return (
    <div className="mt-2 border-l border-sidebar-border/70 pl-3">
      <div className="mb-1 flex h-7 items-center gap-2 pr-1">
        <div className="min-w-0 flex-1 text-xs font-medium text-sidebar-foreground/70">
          Plan
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={requestCreatePlan}
              disabled={sessionLoading}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-label={session ? "New plan" : "Sign in to create a plan"}
            >
              <IconPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {session ? "New plan" : "Sign in to create"}
          </TooltipContent>
        </Tooltip>
      </div>

      {sessionLoading ? (
        <div className="grid gap-1">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-8 rounded-md bg-sidebar-accent" />
          ))}
        </div>
      ) : !session ? (
        <button
          type="button"
          onClick={signInForPlanCreate}
          className="rounded-md px-2 py-1.5 text-left text-xs leading-5 text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground"
        >
          Sign in to create and keep plans.
        </button>
      ) : plansQuery.isLoading ? (
        <div className="grid gap-1">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-8 rounded-md bg-sidebar-accent" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <p className="px-2 py-1.5 text-xs leading-5 text-sidebar-foreground/55">
          No plans yet.
        </p>
      ) : (
        <div className="grid gap-0.5">
          {plans.map((plan) => {
            const isActive = plan.id === selectedPlanId;
            return (
              <Link
                key={plan.id}
                to={`/plans/${plan.id}`}
                className={cn(
                  "group flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{plan.title}</span>
                {plan.openCommentCount > 0 ? (
                  <Badge
                    variant="secondary"
                    className="h-5 shrink-0 rounded-full px-1.5 text-[10px]"
                  >
                    {plan.openCommentCount}
                  </Badge>
                ) : (
                  <span className="shrink-0 text-[11px] text-sidebar-foreground/45">
                    {formatPlanAge(plan.updatedAt)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: SidebarProps) {
  const location = useLocation();
  const ToggleIcon = collapsed
    ? IconLayoutSidebarLeftExpand
    : IconLayoutSidebarLeftCollapse;

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-150",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-0" : "gap-2 px-3",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            collapsed ? "justify-center" : "flex-1",
          )}
        >
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            className="block h-4 w-auto max-w-7 shrink-0 dark:hidden"
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="hidden h-4 w-auto max-w-7 shrink-0 dark:block"
          />
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">
              {APP_TITLE}
            </span>
          )}
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/plans"
              ? location.pathname === "/" ||
                location.pathname.startsWith("/plans")
              : location.pathname.startsWith(item.href);
          return (
            <div key={item.href}>
              <Link
                to={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                  collapsed && "justify-center gap-0 px-0",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {collapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  item.label
                )}
              </Link>
              {item.href === "/plans" && isActive ? (
                <PlansSidebarSection collapsed={collapsed} />
              ) : null}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <>
          <div className="border-t border-border px-2 py-2">
            <ExtensionsSidebarSection />
          </div>

          <div className="space-y-2 border-t border-border px-3 py-2">
            <DevDatabaseLink />
            <FeedbackButton />
            <OrgSwitcher />
          </div>
        </>
      )}

      {collapsible && (
        <div
          className={cn(
            "border-t border-border px-2 py-2",
            collapsed ? "flex justify-center" : "flex justify-end",
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 text-muted-foreground"
                onClick={() => onCollapsedChange?.(!collapsed)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <ToggleIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "Expand sidebar" : "Collapse sidebar"}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </aside>
  );
}
