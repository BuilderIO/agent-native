import {
  IconChevronDown,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMessageCircle,
} from "@tabler/icons-react";
import {
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ComponentType,
  type ElementRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { cn } from "../utils.js";
import {
  usePersistentSidebarCollapsed,
  type PersistentSidebarCollapsedState,
} from "./use-persistent-sidebar-collapsed.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface AppSidebarContextValue {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean | ((current: boolean) => boolean)) => void;
  toggleCollapsed: () => void;
  isMobile: boolean;
}

const AppSidebarContext = createContext<AppSidebarContextValue | null>(null);

export function useAppSidebar(): AppSidebarContextValue {
  const context = useContext(AppSidebarContext);
  if (!context) {
    throw new Error("useAppSidebar must be used within an AppSidebar");
  }
  return context;
}

function renderSidebarIcon(
  icon?: ComponentType<{ className?: string }> | ReactNode,
  className = "size-4 shrink-0 text-primary",
): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) {
    return icon;
  }
  const IconComponent = icon as ComponentType<{ className?: string }>;
  return <IconComponent className={className} />;
}

// ---------------------------------------------------------------------------
// Item Definition Types
// ---------------------------------------------------------------------------

export interface AppSidebarItemDefinition {
  id?: string;
  to?: string;
  href?: string;
  label: string;
  icon?: ComponentType<{ className?: string }> | ReactNode;
  active?: boolean;
  count?: number | string;
  badge?: ReactNode;
  actions?: ReactNode;
  onClick?: (event: MouseEvent) => void;
  children?: ReactNode;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface AppSidebarHeaderProps extends HTMLAttributes<HTMLDivElement> {
  brandName?: ReactNode;
  brandHref?: string;
  brandIcon?: ReactNode;
  brandLink?: ReactNode;
  badge?: ReactNode;
  onBrandClick?: (event: MouseEvent) => void;
}

export const AppSidebarHeader = forwardRef<HTMLDivElement, AppSidebarHeaderProps>(
  (
    {
      brandName,
      brandHref = "/",
      brandIcon,
      brandLink,
      badge,
      onBrandClick,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const { collapsed } = useAppSidebar();

    if (children) {
      return (
        <div
          ref={ref}
          data-sidebar-header
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-border",
            collapsed
              ? "flex-col justify-center gap-0.5 px-2"
              : "gap-2 px-4",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        data-sidebar-header
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border",
          collapsed
            ? "flex-col justify-center gap-0.5 px-2"
            : "gap-2 px-4",
          className,
        )}
        {...props}
      >
        {brandLink ?? (
          <a
            href={brandHref}
            aria-label={typeof brandName === "string" ? brandName : undefined}
            onClick={onBrandClick}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
              collapsed ? "size-8 justify-center" : "shrink-0",
            )}
          >
            {brandIcon}
            {!collapsed && brandName && (
              <span className="truncate text-sm font-semibold text-primary">
                {brandName}
              </span>
            )}
          </a>
        )}
        {badge}
      </div>
    );
  },
);
AppSidebarHeader.displayName = "AppSidebarHeader";

// ---------------------------------------------------------------------------
// Nav Item
// ---------------------------------------------------------------------------

export interface AppSidebarNavItemProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  icon?: ComponentType<{ className?: string }> | ReactNode;
  to?: string;
  href?: string;
  active?: boolean;
  count?: number | string;
  badge?: ReactNode;
  actions?: ReactNode;
  onClick?: (event: MouseEvent) => void;
  asChild?: boolean;
  tooltipSide?: "right" | "top" | "bottom" | "left";
}

export const AppSidebarNavItem = forwardRef<HTMLDivElement, AppSidebarNavItemProps>(
  (
    {
      label,
      icon,
      to,
      href,
      active = false,
      count,
      badge,
      actions,
      onClick,
      asChild = false,
      tooltipSide = "right",
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const { collapsed } = useAppSidebar();
    const linkHref = to ?? href;

    if (collapsed) {
      const tooltipLabel = typeof label === "string" ? label : undefined;
      const content = asChild ? (
        children
      ) : linkHref ? (
        <a
          href={linkHref}
          aria-label={tooltipLabel}
          onClick={onClick}
          className={cn(
            "flex size-9 items-center justify-center rounded-md text-primary hover:bg-accent/60 hover:text-primary",
            active &&
              "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
            className,
          )}
        >
          {renderSidebarIcon(icon)}
        </a>
      ) : (
        <button
          type="button"
          aria-label={tooltipLabel}
          onClick={onClick}
          className={cn(
            "flex size-9 items-center justify-center rounded-md text-primary hover:bg-accent/60 hover:text-primary",
            active &&
              "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
            className,
          )}
        >
          {renderSidebarIcon(icon)}
        </button>
      );

      return (
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side={tooltipSide}>{label}</TooltipContent>
        </Tooltip>
      );
    }

    if (asChild) {
      return (
        <div
          ref={ref}
          className={cn(
            "group flex items-center rounded",
            active
              ? "bg-primary/10 font-medium text-primary"
              : "text-primary hover:bg-accent/60",
            className,
          )}
          {...props}
        >
          {children}
          {actions}
        </div>
      );
    }

    const innerContent = (
      <>
        {renderSidebarIcon(icon)}
        <span className="flex-1 truncate text-primary">{label}</span>
        {count !== undefined && (typeof count === "number" ? count > 0 : Boolean(count)) && (
          <span className="shrink-0 tabular-nums text-[11px] text-primary/80">
            {count}
          </span>
        )}
        {badge}
      </>
    );

    return (
      <div
        ref={ref}
        className={cn(
          "group flex items-center rounded",
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-primary hover:bg-accent/60",
          className,
        )}
        {...props}
      >
        {linkHref ? (
          <a
            href={linkHref}
            onClick={onClick}
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs text-primary"
          >
            {innerContent}
          </a>
        ) : (
          <button
            type="button"
            onClick={onClick}
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs text-primary"
          >
            {innerContent}
          </button>
        )}
        {actions}
      </div>
    );
  },
);
AppSidebarNavItem.displayName = "AppSidebarNavItem";

// ---------------------------------------------------------------------------
// Nav Group (Collapsible)
// ---------------------------------------------------------------------------

export interface AppSidebarNavGroupProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  icon?: ComponentType<{ className?: string }> | ReactNode;
  to?: string;
  href?: string;
  active?: boolean;
  count?: number | string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}

export const AppSidebarNavGroup = forwardRef<HTMLDivElement, AppSidebarNavGroupProps>(
  (
    {
      label,
      icon,
      to,
      href,
      active = false,
      count,
      open: controlledOpen,
      onOpenChange: controlledOnOpenChange,
      defaultOpen = false,
      actions,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const { collapsed } = useAppSidebar();
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const open = controlledOpen ?? uncontrolledOpen;
    const onOpenChange = controlledOnOpenChange ?? setUncontrolledOpen;
    const linkHref = to ?? href;

    if (collapsed) {
      const tooltipLabel = typeof label === "string" ? label : undefined;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={linkHref ?? "#"}
              aria-label={tooltipLabel}
              className={cn(
                "flex size-9 items-center justify-center rounded-md text-primary hover:bg-accent/60 hover:text-primary",
                active &&
                  "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
                className,
              )}
            >
              {renderSidebarIcon(icon)}
            </a>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      );
    }

    return (
      <Collapsible
        open={open}
        onOpenChange={onOpenChange}
        className={cn("group/sidebar-nav", className)}
        {...props}
      >
        <div
          ref={ref}
          className={cn(
            "group flex items-center rounded",
            active
              ? "bg-primary/10 font-medium text-primary"
              : "text-primary hover:bg-accent/60",
          )}
        >
          {linkHref ? (
            <a
              href={linkHref}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs text-primary"
            >
              {renderSidebarIcon(icon)}
              <span className="flex-1 truncate text-primary">{label}</span>
              {count !== undefined && (typeof count === "number" ? count > 0 : Boolean(count)) && (
                <span className="shrink-0 tabular-nums text-[11px] text-primary/80">
                  {count}
                </span>
              )}
            </a>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs text-primary">
              {renderSidebarIcon(icon)}
              <span className="flex-1 truncate text-primary">{label}</span>
              {count !== undefined && (typeof count === "number" ? count > 0 : Boolean(count)) && (
                <span className="shrink-0 tabular-nums text-[11px] text-primary/80">
                  {count}
                </span>
              )}
            </div>
          )}
          {actions}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={open ? "Collapse" : "Expand"}
              className="me-1 flex size-7 shrink-0 items-center justify-center rounded text-primary hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <IconChevronDown
                className={cn(
                  "size-3.5 transition-transform motion-reduce:transition-none",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="clips-collapsible-content">
          <div className="ms-3.5 border-s border-border/70 ps-2">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  },
);
AppSidebarNavGroup.displayName = "AppSidebarNavGroup";

// ---------------------------------------------------------------------------
// Section / Divider
// ---------------------------------------------------------------------------

export interface AppSidebarSectionProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  divider?: boolean;
}

export const AppSidebarSection = forwardRef<HTMLDivElement, AppSidebarSectionProps>(
  ({ title, divider = true, className, children, ...props }, ref) => {
    const { collapsed } = useAppSidebar();

    return (
      <div
        ref={ref}
        data-sidebar-section
        className={cn(
          divider && "border-t border-border/70",
          collapsed
            ? "mt-2 flex flex-col items-center gap-1 pt-2"
            : "mt-3 space-y-0.5 pt-3",
          className,
        )}
        {...props}
      >
        {!collapsed && title && (
          <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
            {title}
          </p>
        )}
        {children}
      </div>
    );
  },
);
AppSidebarSection.displayName = "AppSidebarSection";

// ---------------------------------------------------------------------------
// Feedback Button
// ---------------------------------------------------------------------------

export interface AppSidebarFeedbackButtonProps {
  label?: string;
  icon?: ComponentType<{ className?: string }> | ReactNode;
  onClick?: (event: MouseEvent) => void;
  className?: string;
  collapsed?: boolean;
}

export function AppSidebarFeedbackButton({
  label = "Report an issue",
  icon,
  onClick,
  className,
  collapsed: propCollapsed,
}: AppSidebarFeedbackButtonProps) {
  let contextCollapsed = false;
  try {
    const context = useAppSidebar();
    contextCollapsed = context.collapsed;
  } catch {
    // coercion-ok: context is optional when AppSidebarFeedbackButton is used standalone
  }
  const isCollapsed = propCollapsed ?? contextCollapsed;

  const button = (
    <button
      type="button"
      aria-label={isCollapsed ? label : undefined}
      onClick={onClick}
      className={cn(
        isCollapsed
          ? "flex size-9 items-center justify-center rounded-md bg-transparent text-primary hover:bg-accent/60 hover:text-primary"
          : "flex h-auto w-full items-center justify-start gap-2 rounded bg-transparent px-2 py-1.5 text-xs font-normal text-primary hover:bg-accent/60 hover:text-primary",
        className,
      )}
    >
      {renderSidebarIcon(icon, "size-4 shrink-0 text-primary") ?? (
        <IconMessageCircle className="size-4 shrink-0 text-primary" />
      )}
      {!isCollapsed && <span>{label}</span>}
    </button>
  );

  if (!isCollapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export interface AppSidebarFooterProps extends HTMLAttributes<HTMLDivElement> {
  feedback?: ReactNode;
  orgSwitcher?: ReactNode;
  footerExtras?: ReactNode;
  collapsible?: boolean;
  expandLabel?: string;
  collapseLabel?: string;
}

export const AppSidebarFooter = forwardRef<HTMLDivElement, AppSidebarFooterProps>(
  (
    {
      feedback,
      orgSwitcher,
      footerExtras,
      collapsible = true,
      expandLabel = "Expand sidebar",
      collapseLabel = "Collapse sidebar",
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const { collapsed, toggleCollapsed } = useAppSidebar();

    if (children) {
      return (
        <div
          ref={ref}
          data-sidebar-footer
          className={cn(
            "shrink-0 border-t border-border p-2",
            collapsed ? "space-y-1" : "space-y-1.5",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      );
    }

    const collapseButton = collapsible ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={collapsed ? expandLabel : collapseLabel}
            onClick={toggleCollapsed}
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-transparent text-primary hover:bg-accent/60 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {collapsed ? (
              <IconLayoutSidebarLeftExpand className="size-4 rtl:-scale-x-100" />
            ) : (
              <IconLayoutSidebarLeftCollapse className="size-4 rtl:-scale-x-100" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {collapsed ? expandLabel : collapseLabel}
        </TooltipContent>
      </Tooltip>
    ) : null;

    return (
      <div
        ref={ref}
        data-sidebar-footer
        className={cn(
          "shrink-0 border-t border-border p-2",
          collapsed ? "space-y-1" : "space-y-1.5",
          className,
        )}
        {...props}
      >
        {feedback}
        <div
          data-sidebar-footer-utilities
          className={cn(
            collapsed
              ? "flex flex-col items-center gap-1"
              : "flex items-center gap-0.5",
          )}
        >
          {orgSwitcher}
          {footerExtras}
          {collapseButton}
        </div>
      </div>
    );
  },
);
AppSidebarFooter.displayName = "AppSidebarFooter";

// ---------------------------------------------------------------------------
// AppSidebar (Main Component)
// ---------------------------------------------------------------------------

export interface AppSidebarProps extends HTMLAttributes<HTMLElement> {
  // Collapse state
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
  storageKey?: string;
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;

  // Header
  brandName?: ReactNode;
  brandHref?: string;
  brandIcon?: ReactNode;
  brandLink?: ReactNode;
  badge?: ReactNode;
  headerContent?: ReactNode;

  // Items
  items?: AppSidebarItemDefinition[];
  secondaryItems?: AppSidebarItemDefinition[];

  // Footer
  feedback?: ReactNode;
  orgSwitcher?: ReactNode;
  footerExtras?: ReactNode;
  footerContent?: ReactNode;
  expandLabel?: string;
  collapseLabel?: string;
}

export const AppSidebar = forwardRef<HTMLElement, AppSidebarProps>(
  (
    {
      collapsed: controlledCollapsed,
      onCollapsedChange: controlledOnCollapsedChange,
      defaultCollapsed = false,
      collapsible = true,
      storageKey,
      isMobile = false,
      mobileOpen = false,
      onMobileOpenChange,

      brandName,
      brandHref = "/",
      brandIcon,
      brandLink,
      badge,
      headerContent,

      items,
      secondaryItems,

      feedback,
      orgSwitcher,
      footerExtras,
      footerContent,
      expandLabel = "Expand sidebar",
      collapseLabel = "Collapse sidebar",

      className,
      children,
      ...props
    },
    ref,
  ) => {
    // Persistence hook if storageKey is provided and not controlled
    const persistent = usePersistentSidebarCollapsed({
      storageKey: storageKey ?? "app-sidebar-default-key",
      defaultCollapsed,
    });

    const isControlled = controlledCollapsed !== undefined;
    const isUsingStorage = !isControlled && Boolean(storageKey);

    const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed);

    const collapsed = isControlled
      ? controlledCollapsed!
      : isUsingStorage
        ? persistent.collapsed
        : uncontrolledCollapsed;

    const setCollapsed = useCallback(
      (value: boolean | ((current: boolean) => boolean)) => {
        const next = typeof value === "function" ? value(collapsed) : value;
        if (controlledOnCollapsedChange) {
          controlledOnCollapsedChange(next);
        }
        if (isUsingStorage) {
          persistent.setCollapsed(next);
        }
        if (!isControlled && !isUsingStorage) {
          setUncontrolledCollapsed(next);
        }
      },
      [collapsed, controlledOnCollapsedChange, isControlled, isUsingStorage, persistent],
    );

    const toggleCollapsed = useCallback(() => {
      setCollapsed((prev) => !prev);
    }, [setCollapsed]);

    const showCollapsedSidebar = collapsed && !isMobile;

    const contextValue = useMemo<AppSidebarContextValue>(
      () => ({
        collapsed: showCollapsedSidebar,
        setCollapsed,
        toggleCollapsed,
        isMobile,
      }),
      [showCollapsedSidebar, setCollapsed, toggleCollapsed, isMobile],
    );

    return (
      <AppSidebarContext.Provider value={contextValue}>
        <TooltipProvider delayDuration={0}>
          <aside
            ref={ref}
            data-collapsed={showCollapsedSidebar ? "true" : "false"}
            className={cn(
              "agent-layout-left-drawer fixed inset-y-0 start-0 z-50 flex h-full w-[260px] flex-col overflow-hidden border-e border-border bg-sidebar transition-[width,transform] duration-200 ease-out md:static md:z-auto",
              showCollapsedSidebar && "md:w-14",
              mobileOpen
                ? "translate-x-0"
                : "-translate-x-full rtl:translate-x-full md:translate-x-0",
              className,
            )}
            {...props}
          >
            {headerContent ?? (
              <AppSidebarHeader
                brandName={brandName}
                brandHref={brandHref}
                brandIcon={brandIcon}
                brandLink={brandLink}
                badge={badge}
              />
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {showCollapsedSidebar ? (
                <nav className="flex flex-col items-center gap-1 px-2 py-3">
                  {items?.map((item) => (
                    <AppSidebarNavItem
                      key={item.id ?? item.to ?? item.href ?? item.label}
                      to={item.to}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      active={item.active}
                      count={item.count}
                      badge={item.badge}
                      onClick={item.onClick}
                    />
                  ))}
                  {children}
                  {secondaryItems && secondaryItems.length > 0 && (
                    <div className="mt-2 flex flex-col items-center gap-1 border-t border-border/70 pt-2">
                      {secondaryItems.map((item) => (
                        <AppSidebarNavItem
                          key={item.id ?? item.to ?? item.href ?? item.label}
                          to={item.to}
                          href={item.href}
                          label={item.label}
                          icon={item.icon}
                          active={item.active}
                          count={item.count}
                          badge={item.badge}
                          onClick={item.onClick}
                        />
                      ))}
                    </div>
                  )}
                </nav>
              ) : (
                <nav className="space-y-0.5 px-2 py-3">
                  {items?.map((item) => {
                    if (item.children) {
                      return (
                        <AppSidebarNavGroup
                          key={item.id ?? item.to ?? item.href ?? item.label}
                          to={item.to}
                          href={item.href}
                          label={item.label}
                          icon={item.icon}
                          active={item.active}
                          count={item.count}
                          actions={item.actions}
                        >
                          {item.children}
                        </AppSidebarNavGroup>
                      );
                    }
                    return (
                      <AppSidebarNavItem
                        key={item.id ?? item.to ?? item.href ?? item.label}
                        to={item.to}
                        href={item.href}
                        label={item.label}
                        icon={item.icon}
                        active={item.active}
                        count={item.count}
                        badge={item.badge}
                        actions={item.actions}
                        onClick={item.onClick}
                      />
                    );
                  })}
                  {children}
                  {secondaryItems && secondaryItems.length > 0 && (
                    <div className="mt-3 space-y-0.5 border-t border-border/70 pt-3">
                      {secondaryItems.map((item) => (
                        <AppSidebarNavItem
                          key={item.id ?? item.to ?? item.href ?? item.label}
                          to={item.to}
                          href={item.href}
                          label={item.label}
                          icon={item.icon}
                          active={item.active}
                          count={item.count}
                          badge={item.badge}
                          actions={item.actions}
                          onClick={item.onClick}
                        />
                      ))}
                    </div>
                  )}
                </nav>
              )}
            </div>

            {footerContent ?? (
              <AppSidebarFooter
                feedback={feedback}
                orgSwitcher={orgSwitcher}
                footerExtras={footerExtras}
                collapsible={collapsible}
                expandLabel={expandLabel}
                collapseLabel={collapseLabel}
              />
            )}
          </aside>
        </TooltipProvider>
      </AppSidebarContext.Provider>
    );
  },
);
AppSidebar.displayName = "AppSidebar";
