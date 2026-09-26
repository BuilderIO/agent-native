import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
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
  useMemo,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ComponentType,
  type HTMLAttributes,
  type MouseEvent,
  type RefAttributes,
  type ReactNode,
} from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible.js";
import { ScrollBar } from "../ui/scroll-area.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { cn } from "../utils.js";
import { usePersistentSidebarCollapsed } from "./use-persistent-sidebar-collapsed.js";


export interface AppSidebarLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> {
  to?: string;
  href?: string;
}

export type AppSidebarLinkComponent = ComponentType<
  AppSidebarLinkProps & RefAttributes<HTMLAnchorElement>
>;

export interface AppSidebarContextValue {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean | ((current: boolean) => boolean)) => void;
  toggleCollapsed: () => void;
  isMobile: boolean;
  LinkComponent: AppSidebarLinkComponent;
}

const AppSidebarContext = createContext<AppSidebarContextValue | null>(null);

const NativeSidebarLink = forwardRef<HTMLAnchorElement, AppSidebarLinkProps>(
  ({ to, href, children, ...props }, ref) => (
    <a ref={ref} href={to ?? href} {...props}>
      {children}
    </a>
  ),
);
NativeSidebarLink.displayName = "NativeSidebarLink";

const defaultSidebarContextValue: AppSidebarContextValue = {
  collapsed: false,
  setCollapsed: () => {},
  toggleCollapsed: () => {},
  isMobile: false,
  LinkComponent: NativeSidebarLink,
};

export function useAppSidebar(): AppSidebarContextValue {
  const context = useContext(AppSidebarContext);
  return context ?? defaultSidebarContextValue;
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


export interface AppSidebarHeaderProps extends HTMLAttributes<HTMLDivElement> {
  brandName?: ReactNode;
  brandHref?: string;
  brandIcon?: ReactNode;
  brandLink?: ReactNode;
  badge?: ReactNode;
  onBrandClick?: (event: MouseEvent) => void;
  collapsed?: boolean;
}

export const AppSidebarHeader = forwardRef<
  HTMLDivElement,
  AppSidebarHeaderProps
>(
  (
    {
      brandName,
      brandHref = "/",
      brandIcon,
      brandLink,
      badge,
      onBrandClick,
      collapsed: propCollapsed,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const context = useAppSidebar();
    const collapsed = propCollapsed ?? context.collapsed;
    const LinkComponent = context.LinkComponent;

    const brand = brandLink ?? (
      <LinkComponent
        to={brandHref}
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
      </LinkComponent>
    );

    return (
      <div
        ref={ref}
        data-sidebar-header
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border",
          collapsed ? "flex-col justify-center gap-0.5 px-2" : "gap-2 px-4",
          className,
        )}
        {...props}
      >
        {collapsed && brandName && isValidElement(brand) ? (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>{brand}</TooltipTrigger>
              <TooltipContent side="right">{brandName}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          brand
        )}
        {badge}
        {children}
      </div>
    );
  },
);
AppSidebarHeader.displayName = "AppSidebarHeader";


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

export const AppSidebarNavItem = forwardRef<
  HTMLDivElement,
  AppSidebarNavItemProps
>(
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
    const { collapsed, LinkComponent } = useAppSidebar();
    const linkHref = to ?? href;

    if (collapsed) {
      const tooltipLabel = typeof label === "string" ? label : undefined;
      const content = asChild ? (
        children
      ) : linkHref ? (
        <LinkComponent
          to={to}
          href={href ?? to}
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
        </LinkComponent>
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
        {count !== undefined &&
          (typeof count === "number" ? count > 0 : Boolean(count)) && (
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
          <LinkComponent
            to={to}
            href={href ?? to}
            onClick={onClick}
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs text-primary"
          >
            {innerContent}
          </LinkComponent>
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

export const AppSidebarNavGroup = forwardRef<
  HTMLDivElement,
  AppSidebarNavGroupProps
>(
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
    const { collapsed, LinkComponent } = useAppSidebar();
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const open = controlledOpen ?? uncontrolledOpen;
    const onOpenChange = controlledOnOpenChange ?? setUncontrolledOpen;
    const linkHref = to ?? href;

    if (collapsed) {
      const tooltipLabel = typeof label === "string" ? label : undefined;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <LinkComponent
              to={to}
              href={href ?? to ?? "#"}
              aria-label={tooltipLabel}
              className={cn(
                "flex size-9 items-center justify-center rounded-md text-primary hover:bg-accent/60 hover:text-primary",
                active &&
                  "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
                className,
              )}
            >
              {renderSidebarIcon(icon)}
            </LinkComponent>
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
            <LinkComponent
              to={to}
              href={href ?? to}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs text-primary"
            >
              {renderSidebarIcon(icon)}
              <span className="flex-1 truncate text-primary">{label}</span>
              {count !== undefined &&
                (typeof count === "number" ? count > 0 : Boolean(count)) && (
                  <span className="shrink-0 tabular-nums text-[11px] text-primary/80">
                    {count}
                  </span>
                )}
            </LinkComponent>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs text-primary">
              {renderSidebarIcon(icon)}
              <span className="flex-1 truncate text-primary">{label}</span>
              {count !== undefined &&
                (typeof count === "number" ? count > 0 : Boolean(count)) && (
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
          <div className="ms-3.5 border-s border-border/70 ps-2">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  },
);
AppSidebarNavGroup.displayName = "AppSidebarNavGroup";


export interface AppSidebarSectionProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title?: ReactNode;
  divider?: boolean;
}

export const AppSidebarSection = forwardRef<
  HTMLDivElement,
  AppSidebarSectionProps
>(({ title, divider = true, className, children, ...props }, ref) => {
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
});
AppSidebarSection.displayName = "AppSidebarSection";


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


export interface AppSidebarFooterProps extends HTMLAttributes<HTMLDivElement> {
  feedback?: ReactNode;
  orgSwitcher?: ReactNode;
  footerExtras?: ReactNode;
  collapsible?: boolean;
  expandLabel?: string;
  collapseLabel?: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export const AppSidebarFooter = forwardRef<
  HTMLDivElement,
  AppSidebarFooterProps
>(
  (
    {
      feedback,
      orgSwitcher,
      footerExtras,
      collapsible = true,
      expandLabel = "Expand sidebar",
      collapseLabel = "Collapse sidebar",
      collapsed: propCollapsed,
      onToggleCollapsed,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const context = useAppSidebar();
    const collapsed = propCollapsed ?? context.collapsed;
    const toggleCollapsed = onToggleCollapsed ?? context.toggleCollapsed;

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

    const resolvedFeedback =
      feedback !== undefined ? (
        feedback
      ) : (
        <AppSidebarFeedbackButton collapsed={collapsed} />
      );

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
        {resolvedFeedback}
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


export interface AppSidebarProps extends HTMLAttributes<HTMLElement> {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
  storageKey?: string;
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  linkComponent?: AppSidebarLinkComponent;
  overflowAffordances?: boolean;

  brandName?: ReactNode;
  brandHref?: string;
  brandIcon?: ReactNode;
  brandLink?: ReactNode;
  badge?: ReactNode;
  headerContent?: ReactNode;

  items?: AppSidebarItemDefinition[];
  secondaryItems?: AppSidebarItemDefinition[];

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
      mobileOpen,
      onMobileOpenChange,
      linkComponent,
      overflowAffordances = false,

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
    const persistent = usePersistentSidebarCollapsed({
      storageKey: storageKey ?? "app-sidebar-default-key",
      defaultCollapsed,
    });

    const isControlled = controlledCollapsed !== undefined;
    const isUsingStorage = !isControlled && Boolean(storageKey);

    const [uncontrolledCollapsed, setUncontrolledCollapsed] =
      useState(defaultCollapsed);

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
      [
        collapsed,
        controlledOnCollapsedChange,
        isControlled,
        isUsingStorage,
        persistent,
      ],
    );

    const toggleCollapsed = useCallback(() => {
      setCollapsed((prev) => !prev);
    }, [setCollapsed]);

    const showCollapsedSidebar = collapsed && !isMobile;

    const LinkComponent = linkComponent ?? NativeSidebarLink;
    const ownsMobileDrawer = typeof mobileOpen === "boolean";

    const contextValue = useMemo<AppSidebarContextValue>(
      () => ({
        collapsed: showCollapsedSidebar,
        setCollapsed,
        toggleCollapsed,
        isMobile,
        LinkComponent,
      }),
      [
        showCollapsedSidebar,
        setCollapsed,
        toggleCollapsed,
        isMobile,
        LinkComponent,
      ],
    );

    return (
      <AppSidebarContext.Provider value={contextValue}>
        <TooltipProvider delayDuration={0}>
          <aside
            ref={ref}
            data-collapsed={showCollapsedSidebar ? "true" : "false"}
            className={cn(
              "flex h-full w-[260px] flex-col overflow-hidden border-e border-border bg-sidebar transition-[width,transform] duration-200 ease-out",
              ownsMobileDrawer
                ? "agent-layout-left-drawer fixed inset-y-0 start-0 z-50 md:static md:z-auto"
                : "relative md:static",
              showCollapsedSidebar && "md:w-14",
              ownsMobileDrawer &&
                (mobileOpen
                  ? "translate-x-0"
                  : "-translate-x-full rtl:translate-x-full md:translate-x-0"),
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

            <AppSidebarScrollRegion affordances={overflowAffordances}>
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
            </AppSidebarScrollRegion>

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

function AppSidebarScrollRegion({
  affordances,
  children,
}: {
  affordances: boolean;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });

  useEffect(() => {
    if (!affordances) return;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const update = () => {
      const remaining = viewport.scrollHeight - viewport.clientHeight;
      const overflowing = remaining > 1;
      const above = overflowing && viewport.scrollTop > 1;
      const below = overflowing && viewport.scrollTop < remaining - 1;
      setEdges((current) =>
        current.above === above && current.below === below
          ? current
          : { above, below },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", update);
    };
  }, [affordances]);

  if (!affordances) {
    return <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>;
  }

  return (
    <ScrollAreaPrimitive.Root
      type={edges.above || edges.below ? "always" : "auto"}
      className="relative min-h-0 flex-1 overflow-hidden"
      data-app-sidebar-scroll-area
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className="size-full scroll-py-2 [&>div]:!block"
        data-app-sidebar-scroll-viewport
        onFocusCapture={(event) => {
          const viewport = event.currentTarget;
          const target = event.target;
          if (
            !(target instanceof HTMLElement) ||
            target === viewport ||
            !viewport.contains(target)
          )
            return;
          const bounds = viewport.getBoundingClientRect();
          const focused = target.getBoundingClientRect();
          if (focused.top < bounds.top + 8) {
            viewport.scrollTop += focused.top - bounds.top - 8;
          } else if (focused.bottom > bounds.bottom - 8) {
            viewport.scrollTop += focused.bottom - bounds.bottom + 8;
          }
        }}
      >
        <div ref={contentRef}>{children}</div>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar className="z-10 w-1.5 border-none p-px [&>div]:bg-muted-foreground/50" />
      {edges.above && (
        <div
          aria-hidden="true"
          data-scroll-edge="top"
          className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-sidebar to-transparent"
        />
      )}
      {edges.below && (
        <div
          aria-hidden="true"
          data-scroll-edge="bottom"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2 bg-gradient-to-t from-sidebar to-transparent"
        />
      )}
    </ScrollAreaPrimitive.Root>
  );
}
