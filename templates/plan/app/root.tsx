import { useDbSync } from "@agent-native/core/client";
import {
  AppProviders,
  CommandMenu,
  appPath,
  createAgentNativeQueryClient,
  getLocaleInitScript,
  getThemeInitScript,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
  useCommandMenuShortcut,
  useT,
} from "@agent-native/core/client";
import { configureTracking } from "@agent-native/core/client";
import { Toaster } from "@agent-native/toolkit/ui/sonner";
import {
  IconMoon,
  IconScribble,
  IconShape2,
  IconSun,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "react-router";
import type { LinksFunction } from "react-router";

import { Layout as AppLayout } from "@/components/layout/Layout";
import {
  toggleWireframeStyle,
  useWireframeStyle,
} from "@/components/plan/wireframe/use-wireframe-style";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { APP_TITLE } from "@/lib/app-config";
// Side effect: register Plan's native chat renderers so visual answers render
// their diagram/wireframe/api-spec blocks inline in the agent chat.
import "@/lib/register-chat-renderers";
import { TAB_ID } from "@/lib/tab-id";

import changelog from "../CHANGELOG.md?raw";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "plan",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT_SELECTOR = "script[data-agent-native-theme-init]";
const LOCALE_INIT_SCRIPT_SELECTOR = "script[data-agent-native-locale-init]";

function getHydrationStableThemeInitScript() {
  if (typeof document !== "undefined") {
    const existing = document.querySelector<HTMLScriptElement>(
      THEME_INIT_SCRIPT_SELECTOR,
    );
    if (existing?.innerHTML) return existing.innerHTML;
  }
  return getThemeInitScript();
}

function getHydrationStableLocaleInitScript() {
  if (typeof document !== "undefined") {
    const existing = document.querySelector<HTMLScriptElement>(
      LOCALE_INIT_SCRIPT_SELECTOR,
    );
    if (existing?.innerHTML) return existing.innerHTML;
  }
  return getLocaleInitScript();
}

const THEME_INIT_SCRIPT = getHydrationStableThemeInitScript();
const LOCALE_INIT_SCRIPT = getHydrationStableLocaleInitScript();

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US" dir="ltr" data-locale="en-US" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <script
          data-agent-native-theme-init
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
        <meta name="apple-mobile-web-app-title" content={APP_TITLE} />
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
  useNavigationState();
  useDbSync({
    queryClient: qc,
    ignoreSource: TAB_ID,
  });
  return null;
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const wireframeStyle = useWireframeStyle();
  const t = useT();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  const go = useCallback(
    (path: string) => {
      if (path !== "/") markAgentChatHomeHandoff("plans");
      navigateWithAgentChatViewTransition(navigate, path);
      setCmdkOpen(false);
    },
    [navigate],
  );
  return (
    <>
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        changelog={changelog}
        changelogKey="plan"
      >
        <CommandMenu.Group heading={t("root.commandActions")}>
          <CommandMenu.Item onSelect={() => go("/")}>
            {t("root.askPlan")}
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => go("/plans")}>
            {t("root.openPlans")}
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => go("/recaps")}>
            {t("root.openRecaps")}
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading={t("root.commandAppearance")}>
          <CommandMenu.Item
            onSelect={() => setTheme(isDark ? "light" : "dark")}
            keywords={["theme", "dark", "light", "mode"]}
          >
            {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
            {t("root.toggleTheme")}
          </CommandMenu.Item>
          <CommandMenu.Item
            onSelect={() => toggleWireframeStyle()}
            keywords={[
              "wireframe",
              "wireframes",
              "sketchy",
              "sketch",
              "clean",
              "style",
            ]}
          >
            {wireframeStyle === "sketchy" ? (
              <IconShape2 size={16} />
            ) : (
              <IconScribble size={16} />
            )}
            {wireframeStyle === "sketchy"
              ? t("plansPage.reader.cleanWireframes")
              : t("plansPage.reader.sketchyWireframes")}
          </CommandMenu.Item>
        </CommandMenu.Group>
      </CommandMenu>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    // Pass the plan-specific styled Toaster via `toaster` so only one sonner
    // instance renders (avoids the duplicate that would appear if AppProviders'
    // built-in Toaster AND a children-rendered Toaster both mounted).
    <AppProviders
      queryClient={queryClient}
      toaster={<Toaster richColors position="bottom-left" />}
      i18n={{ catalog: i18nCatalog }}
    >
      <DbSyncSetup />
      <AppContent />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
