import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import { useCallback, useEffect, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { formsRoutePath } from "@/lib/form-builder-tabs";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { IconSun, IconMoon } from "@tabler/icons-react";
import {
  useDbSync,
  AppProviders,
  CommandMenu,
  appPath,
  createAgentNativeQueryClient,
  useCommandMenuShortcut,
  getThemeInitScript,
  configureTracking,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
  setClientAppState,
} from "@agent-native/core/client";
import type { LinksFunction } from "react-router";
import changelog from "../CHANGELOG.md?raw";
import stylesheet from "./global.css?url";
import { TAB_ID } from "@/lib/tab-id";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-forms",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript();

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#06B6D4" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Forms" />
        <link rel="apple-touch-icon" href={appPath("/icon-180.svg")} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function DbSyncSetup() {
  const qc = useQueryClient();
  useDbSync({
    queryClient: qc,
    queryKeys: ["forms", "responses", "settings", "env-status", "public-form"],
    ignoreSource: TAB_ID,
  });
  return null;
}

function NavigationStateSync() {
  useNavigationState();
  return null;
}

function UrlStateSync() {
  const location = useLocation();

  useEffect(() => {
    const searchParams: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(location.search).entries()) {
      searchParams[key] = value;
    }

    const value = {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      searchParams,
    };
    const options = { keepalive: true, requestSource: TAB_ID };

    setClientAppState(`__url__:${TAB_ID}`, value, options).catch(() => {});
    setClientAppState("__url__", value, options).catch(() => {});
  }, [location.hash, location.pathname, location.search]);

  return null;
}

function safeLocalPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function formsOpenPath(url: URL): string | null {
  if (url.origin !== window.location.origin) return null;
  if (!url.pathname.endsWith("/_agent-native/open")) return null;

  const explicitPath = safeLocalPath(url.searchParams.get("to"));
  if (explicitPath) return explicitPath;

  const view = url.searchParams.get("view");
  const formId = url.searchParams.get("formId") ?? url.searchParams.get("id");
  return formsRoutePath({
    view,
    formId,
    tab: url.searchParams.get("tab") ?? url.searchParams.get("activeTab"),
  });
}

function OpenLinkInterceptor() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const path = formsOpenPath(new URL(anchor.href));
      if (!path) return;

      event.preventDefault();
      if (location.pathname === "/" && path !== "/") {
        markAgentChatHomeHandoff("forms");
      }
      navigateWithAgentChatViewTransition(navigate, path);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [location.pathname, navigate]);

  return null;
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      Toggle theme
    </CommandMenu.Item>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <AppProviders queryClient={queryClient}>
      <DbSyncSetup />
      <NavigationStateSync />
      <UrlStateSync />
      <OpenLinkInterceptor />
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        changelog={changelog}
        changelogKey="forms"
      >
        <CommandMenu.Group heading="Forms">
          <CommandMenu.Item onSelect={() => {}}>Search forms</CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading="Appearance">
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <Outlet />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
