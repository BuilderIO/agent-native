import { configureTracking } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { DevOverlay } from "@agent-native/core/client/dev-overlay";
import {
  AppProviders,
  createAgentNativeQueryClient,
  getBrowserTabId,
  useDbSync,
  useSession,
} from "@agent-native/core/client/hooks";
import {
  getLocaleInitScript,
  type LocaleCode,
  type LocaleMessages,
  type LocalizationPreference,
  useT,
} from "@agent-native/core/client/i18n";
import { getThemeInitScript } from "@agent-native/core/client/ui";
import { resolveLocaleFromRequest } from "@agent-native/core/server";
import { IconCheck } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  Link,
  useLoaderData,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";

import { BugReportDialog } from "@/components/bug-report/bug-report-dialog";
import { ClipsCommandMenu } from "@/components/clips-command-menu";
import { LibraryLayout } from "@/components/library/library-layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { buildClipsExtensionBaseUrl } from "@/lib/extension-auth";
import {
  isLegacyRecordingPath,
  isRecordingSharePath,
  isStandalonePublicPath,
} from "@/lib/public-ssr-paths";

import { i18nCatalog, loadI18nMessages } from "./i18n";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-clips",
    app_name: "clips",
    template_name: "clips",
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

const PRIVATE_SHELL_NAVIGATION = [
  ["/library", "library"],
  ["/shared", "sharedWithMe"],
  ["/spaces", "spaces"],
  ["/meetings", "meetings"],
  ["/dictate", "dictate"],
  ["/archive", "archive"],
  ["/trash", "trash"],
] as const;

function ClipsPrivateShellFallback({ messages }: { messages: LocaleMessages }) {
  const navigation = messages.navigation as Record<string, string> | undefined;
  const brand = navigation?.brand ?? "Clips";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="w-64 shrink-0 border-e border-border bg-sidebar p-4">
        <Link
          to="/library"
          className="text-sm font-semibold text-primary"
          aria-label={brand}
        >
          {brand}
        </Link>
        <nav aria-label={brand} className="mt-6 flex flex-col gap-1">
          {PRIVATE_SHELL_NAVIGATION.map(([to, key]) => (
            <Link
              key={to}
              to={to}
              className="rounded px-2 py-1.5 text-sm text-primary hover:bg-accent"
            >
              {navigation?.[key] ?? key}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1" aria-busy="true" />
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData =
    useRouteLoaderData<typeof loader>("root") ?? DEFAULT_LOADER_DATA;
  const localeInitScript = getHydrationStableLocaleInitScript({
    locale: loaderData.locale,
    preference: loaderData.preference,
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

type ExternalChromeRuntime = {
  lastError?: { message?: string };
  sendMessage: (
    extensionId: string,
    message: Record<string, unknown>,
    callback?: (response?: { ok?: boolean; error?: string }) => void,
  ) => void;
};

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
    let removeBridgeListener: (() => void) | null = null;

    const completeExtensionSignIn = () => {
      if (cancelled) return;
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete("clipsExtensionAuth");
      cleaned.searchParams.delete("clipsExtensionId");
      window.history.replaceState(window.history.state, "", cleaned);
      setShowAuthSuccess(true);
    };

    async function sendSessionToExtension() {
      const runtime = (
        window as Window & {
          chrome?: { runtime?: ExternalChromeRuntime };
        }
      ).chrome?.runtime;

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

      const message = {
        source: "clips-auth-bridge",
        kind: "session",
        token: session.token,
        email: session.email,
        clipsBaseUrl: buildClipsExtensionBaseUrl(
          window.location.origin,
          appPath("/"),
        ),
      } as const;
      const sendViaPageBridge = () => {
        const onMessage = (event: MessageEvent) => {
          if (
            event.source !== window ||
            event.origin !== window.location.origin
          ) {
            return;
          }
          const data = event.data as
            | { source?: unknown; kind?: unknown; ok?: unknown }
            | undefined;
          if (
            data?.source !== "clips-auth-bridge" ||
            data.kind !== "session-result"
          ) {
            return;
          }
          removeBridgeListener?.();
          removeBridgeListener = null;
          if (data.ok === true) completeExtensionSignIn();
        };
        removeBridgeListener = () =>
          window.removeEventListener("message", onMessage);
        window.addEventListener("message", onMessage);
        window.postMessage(message, window.location.origin);
      };

      if (!runtime?.sendMessage) {
        sendViaPageBridge();
        return;
      }

      runtime.sendMessage(
        targetExtensionId,
        {
          type: "CLIPS_AUTH_SESSION",
          token: message.token,
          email: message.email,
          clipsBaseUrl: message.clipsBaseUrl,
        },
        (extensionResponse) => {
          if (cancelled) return;
          if (!runtime.lastError && extensionResponse?.ok) {
            completeExtensionSignIn();
            return;
          }
          sendViaPageBridge();
        },
      );
    }

    void sendSessionToExtension();
    return () => {
      cancelled = true;
      removeBridgeListener?.();
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

function PrivateAppContent() {
  const location = useLocation();
  const { status: sessionStatus } = useSession();
  const authenticatedShare =
    typeof window !== "undefined" &&
    isRecordingSharePath(location.pathname) &&
    sessionStatus === "authenticated";
  const standalonePublic =
    isStandalonePublicPath(location.pathname) && !authenticatedShare;
  const [cmdkOpen, setCmdkOpen] = useState(false);

  return (
    <>
      {standalonePublic ? null : <DbSyncSetup />}
      {standalonePublic ? null : <ClipsExtensionAuthBridge />}
      {standalonePublic ? null : (
        <ClipsCommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen} />
      )}
      {standalonePublic ? null : <BugReportDialog />}
      {standalonePublic ? null : <DevOverlay />}
      {authenticatedShare ? (
        <LibraryLayout>
          <Outlet />
        </LibraryLayout>
      ) : (
        <Outlet />
      )}
    </>
  );
}

export default function Root() {
  const location = useLocation();
  const loaderData = useLoaderData<typeof loader>();
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const isPublicPath = isStandalonePublicPath(location.pathname);
  const legacyRecordingPath = isLegacyRecordingPath(location.pathname);
  const publicSharePath = location.pathname.startsWith("/share/");
  return (
    <AppToolkitProvider>
      <AppProviders
        queryClient={queryClient}
        clientOnlyFallback={
          <ClipsPrivateShellFallback messages={loaderData.messages} />
        }
        isPublicPath={isPublicPath}
        sessionBypass={legacyRecordingPath}
        showEnvironmentBadge={isPublicPath && !publicSharePath}
        toaster={
          <Toaster
            richColors
            closeButton
            position="top-center"
            offset={{ top: 16 }}
            mobileOffset={{ top: 12 }}
          />
        }
        i18n={{
          catalog: i18nCatalog,
          initialLocale: loaderData.locale,
          initialPreference: loaderData.preference,
          initialMessages: loaderData.messages,
          persistPreference: !isPublicPath,
        }}
      >
        <PrivateAppContent />
      </AppProviders>
    </AppToolkitProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client/ui";
