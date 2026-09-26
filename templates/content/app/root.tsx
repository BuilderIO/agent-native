import { configureTracking } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import {
  AppProviders,
  createAgentNativeQueryClient,
} from "@agent-native/core/client/hooks";
import {
  getLocaleInitScript,
  type LocaleCode,
  type LocaleMessages,
  type LocalizationPreference,
  useT,
} from "@agent-native/core/client/i18n";
import {
  CommandMenu,
  useCommandMenuShortcut,
} from "@agent-native/core/client/navigation";
import {
  ErrorReportActions,
  RouteTransitionIndicator,
  getThemeInitScript,
} from "@agent-native/core/client/ui";
import { resolveLocaleFromRequest } from "@agent-native/core/server";
import {
  IconDeviceDesktop,
  IconHierarchy2,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteLoaderData,
  useRouteError,
} from "react-router";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";

// Styled sonner wrapper — passed via AppProviders `toaster` prop to avoid duplicate.
import { Toaster as Sonner } from "@/components/ui/sonner";
// shadcn useToast-based toaster — separate from sonner, must stay inline.
import { Toaster } from "@/components/ui/toaster";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";

import changelog from "../CHANGELOG.md?raw";
import { ContentCommandSearchResults } from "./components/ContentCommandSearch";
import { LocalFolderLiveSync } from "./components/LocalFolderLiveSync";
import { useDbSync } from "./hooks/use-db-sync";
import { useNavigationState } from "./hooks/use-navigation-state";
import { i18nCatalog } from "./i18n";
import { CONTENT_COMMAND_MENU_OPEN_EVENT } from "./lib/content-command-menu";

import stylesheet from "./global.css?url";
import katexStylesheet from "katex/dist/katex.min.css?url";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-content",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "stylesheet", href: katexStylesheet },
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

export function shouldRevalidate({
  defaultShouldRevalidate,
  formMethod,
}: ShouldRevalidateFunctionArgs) {
  return formMethod ? defaultShouldRevalidate : false;
}

// Pass args to match content's 3-way theme-cycle UX (no disableTransitionOnChange).
const THEME_INIT_SCRIPT = getThemeInitScript("system", true);

const LazyAgentSidebar = lazy(async () => {
  const { AgentSidebar } =
    await import("@agent-native/core/client/AgentSidebar");
  return { default: AgentSidebar };
});

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
  return <LocalFolderLiveSync />;
}

function ThemeToggleItem({ query }: { query: string }) {
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

  if (
    query.trim() &&
    ![t("root.toggleTheme"), "theme", "dark", "light", "system", "mode"].some(
      (label) => label.toLowerCase().includes(query.trim().toLowerCase()),
    )
  )
    return null;

  return (
    <CommandMenu.Group heading={t("root.commandAppearance")}>
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
    </CommandMenu.Group>
  );
}

function PublicAgentShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const t = useT();

  useEffect(() => setMounted(true), []);

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
    <Suspense
      fallback={
        <div className="flex min-w-0 flex-1 h-screen overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-auto">
            {content}
          </div>
        </div>
      }
    >
      <LazyAgentSidebar
        position="right"
        defaultOpen={false}
        defaultSidebarWidth={420}
        emptyStateText={t("chat.publicEmptyState")}
        suggestions={[
          t("chat.publicSuggestionSummary"),
          t("chat.publicSuggestionTakeaways"),
          t("chat.publicSuggestionActionPlan"),
        ]}
      >
        {content}
      </LazyAgentSidebar>
    </Suspense>
  );
}

function ContentCommandMenu({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      placeholder={t("root.commandSearchPlaceholder")}
      inputLabel={t("root.commandSearchDocuments")}
      className="!top-1/2 h-[min(760px,calc(100vh-2rem))] w-[calc(100vw-1rem)] max-w-5xl !-translate-y-1/2 [&_[cmdk-list]]:min-h-0 [&_[cmdk-list]]:max-h-none [&_[cmdk-list]]:flex-1 [&_[cmdk-root]]:h-full"
      showAgentFallback={false}
      changelog={changelog}
      changelogKey="content"
      renderContent={({ search, renderList }) => (
        <ContentCommandSearchResults
          query={search}
          onOpenChange={onOpenChange}
          renderList={renderList}
          staticItems={<ThemeToggleItem query={search} />}
        />
      )}
    >
      <CommandMenu.Group heading={t("root.commandContent")}>
        <CommandMenu.Item onSelect={() => navigate("/settings/agent")}>
          <IconHierarchy2 size={16} />
          {t("root.openAgent")}
        </CommandMenu.Item>
      </CommandMenu.Group>
    </CommandMenu>
  );
}

function shouldHandleEditorCommandMenuShortcut(event: KeyboardEvent) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target?.closest(".notion-editor")) return true;

  const selection = window.getSelection();
  return (
    !selection || selection.isCollapsed || selection.toString().length === 0
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const commandTrigger = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const loaderData = useLoaderData<typeof loader>();
  useCommandMenuShortcut(
    useCallback(() => {
      commandTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setCmdkOpen(true);
    }, []),
    {
      allowContentEditable: true,
      shouldHandleContentEditable: shouldHandleEditorCommandMenuShortcut,
    },
  );
  useEffect(() => {
    const handleOpen = (event: Event) => {
      commandTrigger.current =
        (event as CustomEvent<{ returnFocusTo?: HTMLElement }>).detail
          ?.returnFocusTo ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      setCmdkOpen(true);
    };
    window.addEventListener(CONTENT_COMMAND_MENU_OPEN_EVENT, handleOpen);
    return () =>
      window.removeEventListener(CONTENT_COMMAND_MENU_OPEN_EVENT, handleOpen);
  }, []);
  const handleCommandMenuCloseAutoFocus = useCallback((event: Event) => {
    const target = commandTrigger.current;
    if (!target?.isConnected) return;
    event.preventDefault();
    commandTrigger.current = null;
    target.focus();
  }, []);

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
      <AppToolkitProvider>
        <AppProviders
          queryClient={queryClient}
          isPublicPath={isPublicPath}
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
          {isPublicPath ? (
            <PublicAgentShell>
              <Outlet />
            </PublicAgentShell>
          ) : (
            <Outlet />
          )}
        </AppProviders>
      </AppToolkitProvider>
    );
  }

  return (
    <AppToolkitProvider>
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
        <RouteTransitionIndicator />
        <ContentCommandMenu
          open={cmdkOpen}
          onOpenChange={setCmdkOpen}
          onCloseAutoFocus={handleCommandMenuCloseAutoFocus}
        />
        <Outlet />
      </AppProviders>
    </AppToolkitProvider>
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
        <ErrorReportActions
          appName="Content"
          title={title}
          details={details}
          issueTitle={`Content error: ${title}`}
          className="mt-4"
          align="center"
        />
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  return <ContentErrorBoundaryBody />;
}
