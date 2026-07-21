import { configureTracking } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import {
  AppProviders,
  createAgentNativeQueryClient,
  useDbSync,
  getBrowserTabId,
  useSession,
} from "@agent-native/core/client/hooks";
import { getLocaleInitScript, useT } from "@agent-native/core/client/i18n";
import {
  CommandMenu,
  useCommandMenuShortcut,
} from "@agent-native/core/client/navigation";
import { getThemeInitScript } from "@agent-native/core/client/ui";
import { IconBrain, IconSun, IconMoon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import type { LinksFunction } from "react-router";

import { Layout as AppLayout } from "@/components/layout/Layout";
import { Toaster } from "@/components/ui/sonner";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";

import changelog from "../CHANGELOG.md?raw";
import { i18nCatalog } from "./i18n";
import { isPublicDesignAppPath } from "./public-routes";

import stylesheet from "./global.css?url";

configureTracking({
  llmConnectionStatus:
    typeof window === "undefined" ||
    !isPublicDesignAppPath(window.location.pathname),
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "design",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript();
const LOCALE_INIT_SCRIPT = getLocaleInitScript();

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
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
        />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#71717A" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Design" />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
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
    queryKeys: ["designs", "design-systems", "design-files"],
    ignoreSource: getBrowserTabId(),
  });
  return null;
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      {t("root.toggleTheme")}
    </CommandMenu.Item>
  );
}

function DesignCommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      changelog={changelog}
      changelogKey="design"
    >
      <CommandMenu.Group heading={t("root.commandActions")}>
        <CommandMenu.Item onSelect={() => navigate("/agent")}>
          <IconBrain size={16} />
          {t("root.openAgent")}
        </CommandMenu.Item>
        <CommandMenu.Item onSelect={() => {}}>
          {t("root.commandSearch")}
        </CommandMenu.Item>
      </CommandMenu.Group>
      <CommandMenu.Group heading={t("root.commandAppearance")}>
        <ThemeToggleItem />
      </CommandMenu.Group>
    </CommandMenu>
  );
}

function RootContent() {
  const location = useLocation();
  const { session } = useSession();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const hasSession = Boolean(session?.email);
  const isPublicVisualEdit = location.pathname === "/visual-edit";
  useCommandMenuShortcut(
    useCallback(() => {
      if (hasSession && !isPublicVisualEdit) setCmdkOpen(true);
    }, [hasSession, isPublicVisualEdit]),
  );

  const content = isPublicVisualEdit ? (
    <Outlet />
  ) : (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );

  return (
    <>
      {hasSession && <DbSyncSetup />}
      <Toaster richColors position="bottom-left" />
      {hasSession && !isPublicVisualEdit && (
        <DesignCommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen} />
      )}
      {content}
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const location = useLocation();
  const isPublicPath = isPublicDesignAppPath(location.pathname);
  return (
    <AppToolkitProvider>
      <AppProviders
        queryClient={queryClient}
        isPublicPath={isPublicPath}
        i18n={{ catalog: i18nCatalog, persistPreference: !isPublicPath }}
      >
        <RootContent />
      </AppProviders>
    </AppToolkitProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client/ui";
