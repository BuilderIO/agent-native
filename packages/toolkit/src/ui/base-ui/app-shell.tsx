import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from "@tabler/icons-react";
import * as React from "react";

import { type ButtonProps, IconButton } from "./button.js";
import { DialogPortal } from "./dialog.js";
import { useToastAnchor } from "./toast.js";

interface ShellContextValue {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  mobile: boolean;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

export function useAppShell(component: string): ShellContextValue {
  const context = React.useContext(ShellContext);
  if (!context) {
    throw new Error(`<${component}> must be used within <AppShell>`);
  }
  return context;
}

function useMediaQuery(host: HTMLElement | null, query: string): boolean {
  const win = host?.ownerDocument.defaultView;
  const list = React.useMemo(() => win?.matchMedia(query), [win, query]);
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!list) return () => {};
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [list],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => list?.matches ?? false,
    () => false,
  );
}

function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange: ((next: T) => void) | undefined,
): [T, (next: T) => void] {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const current = value === undefined ? uncontrolled : value;
  const set = React.useCallback(
    (next: T) => {
      if (value === undefined) setUncontrolled(next);
      onChange?.(next);
    },
    [value, onChange],
  );
  return [current, set];
}

export interface AppShellProps extends useRender.ComponentProps<"div"> {
  /** The sidebar shows only its icons. */
  sidebarCollapsed?: boolean;
  defaultSidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  /** The sidebar's drawer is open, at the mobile width. */
  sidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
  /** Where the sidebar becomes a drawer. */
  mobileQuery?: string;
}

/**
 * The frame every app sits in: navigation on the start side, the canvas, and
 * the agent panel on the end side. It owns the sidebar's state, so a
 * SidebarToggle anywhere inside drives the Sidebar, which is a drawer at the
 * mobile width.
 *
 * @import import { AppShell, AppShellCanvas, AppShellAgent, SidebarToggle } from "@agent-native/toolkit/ui/base-ui/app-shell";
 */
function AppShell({
  render,
  ref,
  sidebarCollapsed,
  defaultSidebarCollapsed = false,
  onSidebarCollapsedChange,
  sidebarOpen,
  onSidebarOpenChange,
  mobileQuery = "(max-width: 767px)",
  ...props
}: AppShellProps) {
  const [collapsed, setCollapsed] = useControllable(
    sidebarCollapsed,
    defaultSidebarCollapsed,
    onSidebarCollapsedChange,
  );
  const [drawerOpen, setDrawerOpen] = useControllable(
    sidebarOpen,
    false,
    onSidebarOpenChange,
  );
  const [host, setHost] = React.useState<HTMLDivElement | null>(null);
  const mobile = useMediaQuery(host, mobileQuery);
  const wasMobile = React.useRef(mobile);
  React.useLayoutEffect(() => {
    const leftMobile = wasMobile.current && !mobile;
    wasMobile.current = mobile;
    if (leftMobile && drawerOpen) setDrawerOpen(false);
  }, [mobile, drawerOpen, setDrawerOpen]);
  const context = React.useMemo(
    () => ({ collapsed, setCollapsed, mobile, drawerOpen, setDrawerOpen }),
    [collapsed, setCollapsed, mobile, drawerOpen, setDrawerOpen],
  );
  const own: React.ComponentProps<"div"> &
    Record<`data-${string}`, string | undefined> = {
    className: "app-shell",
    "data-sidebar-collapsed": collapsed && !mobile ? "" : undefined,
    "data-mobile": mobile ? "" : undefined,
  };
  const element = useRender<Record<string, never>, HTMLDivElement>({
    defaultTagName: "div",
    render,
    ref: ref ? [setHost, ref] : setHost,
    props: mergeProps<"div">(own, props),
  });
  return (
    <ShellContext.Provider value={context}>{element}</ShellContext.Provider>
  );
}

export type AppShellCanvasProps = useRender.ComponentProps<"main">;

/**
 * The page's own content: the `main` landmark, where toasts sit.
 *
 * @import import { AppShellCanvas } from "@agent-native/toolkit/ui/base-ui/app-shell";
 */
function AppShellCanvas({ render, ref, ...props }: AppShellCanvasProps) {
  const toastAnchor = useToastAnchor<HTMLElement>();
  return useRender({
    defaultTagName: "main",
    render,
    ref: ref === undefined ? toastAnchor : [toastAnchor, ref],
    props: mergeProps<"main">({ className: "app-shell-canvas" }, props),
  });
}

export type AppShellAgentProps = useRender.ComponentProps<"aside">;

/**
 * The agent panel on the end side of the shell.
 *
 * @import import { AppShellAgent } from "@agent-native/toolkit/ui/base-ui/app-shell";
 */
function AppShellAgent({ render, ...props }: AppShellAgentProps) {
  return useRender({
    defaultTagName: "aside",
    render,
    props: mergeProps<"aside">({ className: "app-shell-agent" }, props),
  });
}

export interface SidebarToggleProps extends Omit<
  ButtonProps,
  "aria-label" | "children"
> {
  /** Names the toggle; the parts carry no copy of their own. */
  "aria-label": string;
  /** Renders only at the mobile width, to open the drawer from outside it. */
  mobileOnly?: boolean;
}

/**
 * The Icon Button that collapses and expands the sidebar, or opens its
 * drawer at the mobile width. Says which with `aria-expanded`.
 *
 * @import import { SidebarToggle } from "@agent-native/toolkit/ui/base-ui/app-shell";
 */
function SidebarToggle({
  onClick,
  mobileOnly = false,
  ...props
}: SidebarToggleProps) {
  const shell = useAppShell("SidebarToggle");
  if (mobileOnly && !shell.mobile) return null;
  const expanded = shell.mobile ? shell.drawerOpen : !shell.collapsed;
  return (
    <IconButton
      variant="ghost"
      color="gray"
      aria-expanded={expanded}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (shell.mobile) shell.setDrawerOpen(!shell.drawerOpen);
        else shell.setCollapsed(!shell.collapsed);
      }}
      {...props}
    >
      {expanded ? (
        <IconLayoutSidebarLeftCollapse aria-hidden />
      ) : (
        <IconLayoutSidebarLeftExpand aria-hidden />
      )}
    </IconButton>
  );
}

/**
 * The drawer a Sidebar becomes at the mobile width. Sidebar renders it.
 *
 * @import import { SidebarDrawer } from "@agent-native/toolkit/ui/base-ui/app-shell";
 */
function SidebarDrawer({
  children,
  label,
  "aria-labelledby": labelledBy,
}: {
  children: React.ReactNode;
  label?: string;
  "aria-labelledby"?: string;
}) {
  const shell = useAppShell("Sidebar");
  return (
    <BaseDialog.Root
      open={shell.drawerOpen}
      onOpenChange={(open) => shell.setDrawerOpen(open)}
    >
      <DialogPortal>
        <BaseDialog.Backdrop className="sidebar-backdrop" />
        <BaseDialog.Popup
          className="sidebar-drawer"
          aria-label={label}
          aria-labelledby={labelledBy}
        >
          {children}
        </BaseDialog.Popup>
      </DialogPortal>
    </BaseDialog.Root>
  );
}

export {
  AppShell,
  AppShellCanvas,
  AppShellAgent,
  SidebarToggle,
  SidebarDrawer,
};
