import { getBrowserTabId, useDbSync } from "@agent-native/core/client";
import {
  AppProviders,
  CommandMenu,
  DevOverlay,
  appPath,
  createAgentNativeQueryClient,
  getLocaleInitScript,
  getThemeInitScript,
  type LocaleCode,
  type LocaleMessages,
  type LocalizationPreference,
  useCommandMenuShortcut,
  useT,
} from "@agent-native/core/client";
import { configureTracking } from "@agent-native/core/client";
import { resolveLocaleFromRequest } from "@agent-native/core/server";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Toaster } from "@agent-native/toolkit/ui/sonner";
import { IconCheck, IconSun, IconMoon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";

import { useNavigationState } from "@/hooks/use-navigation-state";

import { i18nCatalog, loadI18nMessages } from "./i18n";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-clips",
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
    (await loadI18nMessages(resolved.locale)) ?? i18nCatalog.messages;
  return {
    locale: resolved.locale,
    preference: resolved.preference,
    dir: resolved.dir,
    messages,
  };
}

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

function getHydrationStableLocaleInitScript(
  options: Parameters<typeof getLocaleInitScript>[0],
) {
  if (typeof document !== "undefined") {
    const existing = document.querySelector<HTMLScriptElement>(
      LOCALE_INIT_SCRIPT_SELECTOR,
    );
    if (existing?.innerHTML) return existing.innerHTML;
  }
  return getLocaleInitScript(options);
}

const THEME_INIT_SCRIPT = getHydrationStableThemeInitScript();

const DEFAULT_LOADER_DATA: RootLoaderData = {
  locale: "en-US",
  preference: { locale: "system" },
  dir: "ltr",
  messages: i18nCatalog.messages,
};

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData =
    useRouteLoaderData<typeof loader>("root") ?? DEFAULT_LOADER_DATA;
  const localeInitScript = getHydrationStableLocaleInitScript({
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
          data-agent-native-theme-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: localeInitScript }}
        />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#18181B" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Clips" />
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
    queryKeys: [
      "recordings",
      "transcripts",
      "comments",
      "viewers",
      "folders",
      "spaces",
      "workspace",
      "insights",
    ],
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

type ExternalChromeRuntime = {
  lastError?: { message?: string };
  sendMessage: (
    extensionId: string,
    message: Record<string, unknown>,
    callback?: (response?: { ok?: boolean; error?: string }) => void,
  ) => void;
};

const CLIPS_COMMAND_DOCS = [
  {
    title: "Use the Chrome extension for browser logs",
    description:
      "Record a browser tab with redacted console logs, JavaScript exceptions, and fetch/XHR diagnostics.",
    href: "https://www.agent-native.com/docs/template-clips#browser-logs-and-developer-diagnostics",
    keywords: [
      "logs",
      "browser logs",
      "developer logs",
      "console logs",
      "network logs",
      "fetch",
      "xhr",
      "diagnostics",
      "chrome extension",
      "recording",
    ],
  },
] satisfies React.ComponentProps<typeof CommandMenu.DocsGroup>["docs"];

function ClipsExtensionAuthBridge() {
  const location = useLocation();
  const t = useT();
  const [showAuthSuccess, setShowAuthSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("clipsExtensionAuth") !== "1") return;
    const extensionId = params.get("clipsExtensionId")?.trim();
    if (!extensionId) return;
    const targetExtensionId = extensionId;

    let cancelled = false;

    async function sendSessionToExtension() {
      const runtime = (
        window as Window & {
          chrome?: { runtime?: ExternalChromeRuntime };
        }
      ).chrome?.runtime;
      if (!runtime?.sendMessage) return;

      const response = await fetch(appPath("/_agent-native/auth/session"), {
        credentials: "include",
        cache: "no-store",
      });
      const session = (await response.json().catch(() => null)) as {
        email?: string;
        token?: string;
      } | null;
      if (cancelled || !response.ok || !session?.email || !session.token) {
        return;
      }

      runtime.sendMessage(
        targetExtensionId,
        {
          type: "CLIPS_AUTH_SESSION",
          token: session.token,
          email: session.email,
          clipsBaseUrl: window.location.origin,
        },
        (extensionResponse) => {
          if (cancelled || runtime.lastError || !extensionResponse?.ok) return;
          const cleaned = new URL(window.location.href);
          cleaned.searchParams.delete("clipsExtensionAuth");
          cleaned.searchParams.delete("clipsExtensionId");
          window.history.replaceState(window.history.state, "", cleaned);
          setShowAuthSuccess(true);
        },
      );
    }

    void sendSessionToExtension();
    return () => {
      cancelled = true;
    };
  }, [location.search]);

  return (
    <Dialog open={showAuthSuccess} onOpenChange={setShowAuthSuccess}>
      <DialogContent className="max-w-sm text-center sm:text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
          <IconCheck className="h-9 w-9" strokeWidth={2.5} />
        </div>
        <DialogHeader className="items-center text-center sm:text-center">
          <DialogTitle>{t("root.extensionSignedInTitle")}</DialogTitle>
          <DialogDescription className="max-w-xs">
            {t("root.extensionSignedInDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button type="button" onClick={() => setShowAuthSuccess(false)}>
            {t("root.gotIt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Paths that are fully public-facing and must SSR real content rather than
 * routing through the authenticated app shell. Kept in one place so both the
 * ClientOnly bypass in Root and the DbSync/CommandMenu skip in AppContent stay
 * in sync.
 */
function isStandalonePublicPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return (
    path === "/download" ||
    path.startsWith("/share/") ||
    path.startsWith("/embed/") ||
    path.startsWith("/invite/")
  );
}

function AppContent() {
  const location = useLocation();
  const t = useT();
  const standalonePublic = isStandalonePublicPath(location.pathname);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(
    useCallback(() => {
      if (!standalonePublic) setCmdkOpen(true);
    }, [standalonePublic]),
  );

  return (
    <>
      {standalonePublic ? null : <DbSyncSetup />}
      {standalonePublic ? null : <ClipsExtensionAuthBridge />}
      {standalonePublic ? null : (
        <CommandMenu
          open={cmdkOpen}
          onOpenChange={setCmdkOpen}
          changelog={t("settings.changelogMarkdown")}
          changelogLabel={t("settings.whatsNew")}
          changelogKey="clips"
        >
          <CommandMenu.Group heading={t("root.commandActions")}>
            <CommandMenu.Item onSelect={() => {}}>
              {t("root.commandSearch")}
            </CommandMenu.Item>
          </CommandMenu.Group>
          <CommandMenu.DocsGroup docs={CLIPS_COMMAND_DOCS} />
          <CommandMenu.Group heading={t("root.commandAppearance")}>
            <ThemeToggleItem />
          </CommandMenu.Group>
        </CommandMenu>
      )}
      {standalonePublic ? null : <DevOverlay />}
      <Outlet />
      <Toaster richColors position="bottom-left" />
    </>
  );
}

/**
 * Public share/embed/download/invite paths must SSR real content for
 * first-visit signed-out users and bots. AppProviders' isPublicPath prop
 * removes the ClientOnly gate for these paths so entry.server.tsx streams
 * actual markup and loader-fed OG meta instead of a bare spinner.
 */
export default function Root() {
  const location = useLocation();
  const loaderData = useLoaderData<typeof loader>();
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppProviders
      queryClient={queryClient}
      isPublicPath={isStandalonePublicPath(location.pathname)}
      i18n={{
        catalog: i18nCatalog,
        initialLocale: loaderData.locale,
        initialPreference: loaderData.preference,
        initialMessages: loaderData.messages,
        persistPreference: !isStandalonePublicPath(location.pathname),
      }}
    >
      <AppContent />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
