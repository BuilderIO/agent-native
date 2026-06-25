import {
  AgentSidebar,
  AppProviders,
  appPath,
  CommandMenu,
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
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useLocation,
  useRouteLoaderData,
  useRouteError,
} from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";

// Styled sonner wrapper — passed via AppProviders `toaster` prop to avoid duplicate.
import { Toaster as Sonner } from "@/components/ui/sonner";
// shadcn useToast-based toaster — separate from sonner, must stay inline.
import { Toaster } from "@/components/ui/toaster";

import changelog from "../CHANGELOG.md?raw";
import { useDbSync } from "./hooks/use-db-sync";
import { useNavigationState } from "./hooks/use-navigation-state";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-content",
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

// Pass args to match content's 3-way theme-cycle UX (no disableTransitionOnChange).
const THEME_INIT_SCRIPT = getThemeInitScript("system", true);

const DEFAULT_LOADER_DATA: RootLoaderData = {
  locale: "en-US",
  preference: { locale: "system" },
  dir: "ltr",
  messages: i18nCatalog.messages,
};

const themeOptions = [
  { value: "system", label: "System", icon: IconDeviceDesktop },
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
] as const;

const THEME_PREFERENCE_STORAGE_KEY = "content-theme-preference";

type ThemeOption = (typeof themeOptions)[number]["value"];

function isThemeOption(value: string | null | undefined): value is ThemeOption {
  return value === "light" || value === "system" || value === "dark";
}

function readStoredThemePreference(): ThemeOption {
  if (typeof window === "undefined") return "system";

  try {
    const storedTheme = window.localStorage.getItem(
      THEME_PREFERENCE_STORAGE_KEY,
    );
    if (storedTheme === "auto") return "system";
    return isThemeOption(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

function writeStoredThemePreference(theme: ThemeOption) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures and still let next-themes update the page.
  }
}

function nextTheme(theme: ThemeOption): ThemeOption {
  const currentIndex = themeOptions.findIndex(
    (option) => option.value === theme,
  );
  return themeOptions[(currentIndex + 1) % themeOptions.length].value;
}

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
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#10B981" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Content" />
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

function AppSetup() {
  useDbSync();
  useNavigationState();
  return null;
}

function ThemeToggleItem() {
  const { theme, setTheme } = useTheme();
  const t = useT();
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption>("system");

  useEffect(() => {
    setSelectedTheme(readStoredThemePreference());
  }, [theme]);

  const activeTheme = selectedTheme;
  const activeOption =
    themeOptions.find((option) => option.value === activeTheme) ??
    themeOptions[0];
  const ActiveIcon = activeOption.icon;
  const handleSelect = () => {
    const next = nextTheme(activeTheme);
    setSelectedTheme(next);
    writeStoredThemePreference(next);
    setTheme(next);
  };

  return (
    <CommandMenu.Item
      onSelect={handleSelect}
      keywords={["theme", "dark", "light", "system", "mode"]}
    >
      <ActiveIcon size={16} />
      {t("root.toggleTheme")}
      <span className="ml-auto text-xs text-muted-foreground">
        {t(`theme.${activeOption.value}`)}
      </span>
    </CommandMenu.Item>
  );
}

function PublicAgentShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const t = useT();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    const id = window.setTimeout(() => {
      window.dispatchEvent(new Event("agent-panel:open"));
    }, 0);
    return () => window.clearTimeout(id);
  }, [mounted]);

  const content = <>{children}</>;

  if (!mounted) {
    return (
      <div className="flex min-w-0 flex-1 h-screen overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-auto">
          {content}
        </div>
      </div>
    );
  }

  return (
    <AgentSidebar
      position="right"
      defaultOpen
      defaultSidebarWidth={420}
      emptyStateText={t("chat.publicEmptyState")}
      suggestions={[
        t("chat.publicSuggestionSummary"),
        t("chat.publicSuggestionTakeaways"),
        t("chat.publicSuggestionActionPlan"),
      ]}
    >
      {content}
    </AgentSidebar>
  );
}

function ContentCommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      changelog={changelog}
      changelogKey="content"
    >
      <CommandMenu.Group heading={t("root.commandContent")}>
        <CommandMenu.Item onSelect={() => {}}>
          {t("root.commandSearchDocuments")}
        </CommandMenu.Item>
      </CommandMenu.Group>
      <CommandMenu.Group heading={t("root.commandAppearance")}>
        <ThemeToggleItem />
      </CommandMenu.Group>
    </CommandMenu>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const location = useLocation();
  const loaderData = useLoaderData<typeof loader>();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));

  // Public document paths (/p/*) SSR real content without the ClientOnly gate
  // so crawlers and unauthenticated visitors receive full markup on first visit.
  const isPublicPath = location.pathname.startsWith("/p/");

  // Content's 3-way theme cycle (system/light/dark) animates the transition;
  // pass disableThemeTransitions={false} to restore that behaviour.
  // The styled Sonner is passed via `toaster` so only one sonner instance
  // renders; the shadcn useToast-based <Toaster /> stays inline because it is
  // a different toasting system.
  const contentToaster = <Sonner closeButton position="bottom-left" />;

  if (isPublicPath) {
    return (
      <AppProviders
        queryClient={queryClient}
        isPublicPath
        disableThemeTransitions={false}
        toaster={contentToaster}
        i18n={{
          catalog: i18nCatalog,
          initialLocale: loaderData.locale,
          initialPreference: loaderData.preference,
          initialMessages: loaderData.messages,
          persistPreference: false,
        }}
      >
        <Toaster />
        <PublicAgentShell>
          <Outlet />
        </PublicAgentShell>
      </AppProviders>
    );
  }

  return (
    <AppProviders
      queryClient={queryClient}
      disableThemeTransitions={false}
      toaster={contentToaster}
      i18n={{
        catalog: i18nCatalog,
        initialLocale: loaderData.locale,
        initialPreference: loaderData.preference,
        initialMessages: loaderData.messages,
      }}
    >
      <AppSetup />
      <Toaster />
      <ContentCommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen} />
      <Outlet />
    </AppProviders>
  );
}

function ContentErrorBoundaryBody() {
  const error = useRouteError();
  let title = "Something went wrong";
  let details = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Page not found";
      details = "We couldn't find this page.";
    } else {
      title = `${error.status} Error`;
      details = error.statusText || details;
    }
  } else if (error instanceof Error && error.message) {
    details = error.message;
  } else if (typeof error === "string" && error) {
    details = error;
  }

  if (typeof console !== "undefined" && error) {
    console.error("[ContentErrorBoundary]", error);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="flex max-w-md flex-col items-center text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{details}</p>
        <a
          href={appPath("/page")}
          className="mt-6 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          Go to page list
        </a>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent"
        >
          Reload
        </button>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  return <ContentErrorBoundaryBody />;
}
