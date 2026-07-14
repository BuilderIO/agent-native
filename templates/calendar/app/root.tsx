import {
  AppProviders,
  CommandMenu,
  DefaultSpinner,
  appPath,
  configureTracking,
  createAgentNativeQueryClient,
  getLocaleInitScript,
  getThemeInitScript,
  type LocaleCode,
  type LocaleMessages,
  type LocalizationPreference,
  useCommandMenuShortcut,
  useDbSync,
  useT,
} from "@agent-native/core/client";
import { resolveLocaleFromRequest } from "@agent-native/core/server";
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
  useNavigate,
  useLoaderData,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Toaster } from "sonner";

import { AppToolkitProvider } from "@/components/ui/toolkit-provider";

import changelog from "../CHANGELOG.md?raw";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-calendar",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

interface RootLoaderData {
  locale: LocaleCode;
  preference: LocalizationPreference;
  dir: "ltr" | "rtl";
  messages: LocaleMessages;
}

export async function loader({
  request,
}: LoaderFunctionArgs): Promise<RootLoaderData> {
  const resolved = resolveLocaleFromRequest({ request });
  const messages =
    ((await i18nCatalog.loadMessages?.(resolved.locale)) as
      | LocaleMessages
      | null
      | undefined) ?? i18nCatalog.messages;
  return {
    locale: resolved.locale,
    preference: resolved.preference,
    dir: resolved.dir,
    messages,
  };
}

const THEME_INIT_SCRIPT = getThemeInitScript();

const DEFAULT_LOADER_DATA: RootLoaderData = {
  locale: "en-US",
  preference: { locale: "system" },
  dir: "ltr",
  messages: i18nCatalog.messages,
};

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData =
    useRouteLoaderData<typeof loader>("root") ?? DEFAULT_LOADER_DATA;
  const localeInitScript = getLocaleInitScript({
    locale: loaderData.locale,
    preference: loaderData.preference,
    messages: loaderData.messages,
  });

  return (
    <html
      lang={loaderData.locale}
      dir={loaderData.dir}
      data-locale={loaderData.locale}
      suppressHydrationWarning
    >
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
          dangerouslySetInnerHTML={{ __html: localeInitScript }}
        />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#00B5FF" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Calendar" />
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

const TAB_ID = Math.random().toString(36).slice(2, 10);

function DbSyncSetup() {
  const qc = useQueryClient();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "events",
      "bookings",
      "booking-links",
      "availability",
      "settings",
      "google-status",
      "env-status",
      "integration-status",
      "integration-data",
      "zoom-status",
      "apollo-status",
      "apollo-person",
      "available-slots",
      "available-days",
      "public-settings",
      "public-availability",
      "public-booking-link",
    ],
    ignoreSource: TAB_ID,
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

/**
 * Public booking routes (/book/*, /meet/*, /booking/manage/*) must SSR real
 * content for first-visit signed-out users and crawlers. These paths bypass
 * ClientOnly so entry.server.tsx can stream the actual route markup rather than
 * a bare spinner. Auth/private routes are unaffected.
 */
function isPublicBookingPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return (
    p.startsWith("/book/") ||
    p.startsWith("/meet/") ||
    p.startsWith("/booking/manage/")
  );
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const navigate = useNavigate();
  const t = useT();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <>
      <DbSyncSetup />
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        changelog={changelog}
        changelogKey="calendar"
      >
        <CommandMenu.Group heading={t("root.commandActions")}>
          <CommandMenu.Item onSelect={() => {}}>
            {t("root.commandSearch")}
          </CommandMenu.Item>
          <CommandMenu.Item
            onSelect={() => navigate("/agent")}
            keywords={[
              "agent",
              "context",
              "files",
              "connections",
              "jobs",
              "access",
            ]}
          >
            <IconBrain size={16} />
            {t("settings.openAgentSettings")}
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading={t("root.commandAppearance")}>
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <Outlet />
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() =>
    createAgentNativeQueryClient({
      defaultOptions: {
        queries: {
          // Calendar aggressively refetches on focus because external
          // calendar events can change without a DB sync event (e.g. Google
          // Calendar webhooks with a processing delay).
          // request-storm-allow: one user-driven focus refresh for provider data.
          refetchOnWindowFocus: true,
          // Flat retry: calendar data fetches don't need the auth-aware
          // retry function — auth errors surface through the booking flow.
          retry: 1,
        },
      },
    }),
  );
  const location = useLocation();
  const loaderData = useLoaderData<typeof loader>();
  const isPublicPath = isPublicBookingPath(location.pathname);

  return (
    <AppToolkitProvider>
      <AppProviders
        queryClient={queryClient}
        isPublicPath={isPublicPath}
        clientOnlyFallback={<DefaultSpinner />}
        toaster={<Toaster richColors position="bottom-center" />}
        i18n={{
          catalog: i18nCatalog,
          initialLocale: loaderData.locale,
          initialPreference: loaderData.preference,
          initialMessages: loaderData.messages,
          persistPreference: !isPublicPath,
        }}
      >
        <AppContent />
      </AppProviders>
    </AppToolkitProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
