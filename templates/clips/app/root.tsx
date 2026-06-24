import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { useCallback, useEffect, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { useQueryClient } from "@tanstack/react-query";
import { getBrowserTabId, useDbSync } from "@agent-native/core/client";
import {
  AppProviders,
  CommandMenu,
  DevOverlay,
  appPath,
  createAgentNativeQueryClient,
  getThemeInitScript,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { IconCheck, IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import changelog from "../CHANGELOG.md?raw";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-clips",
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
          <DialogTitle>Signed in</DialogTitle>
          <DialogDescription className="max-w-xs">
            Open the Clips extension again to start recording.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button type="button" onClick={() => setShowAuthSuccess(false)}>
            Got it
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
          changelog={changelog}
          changelogKey="clips"
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
          </CommandMenu.Group>
          <CommandMenu.DocsGroup docs={CLIPS_COMMAND_DOCS} />
          <CommandMenu.Group heading="Appearance">
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
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppProviders
      queryClient={queryClient}
      isPublicPath={isStandalonePublicPath(location.pathname)}
    >
      <AppContent />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
