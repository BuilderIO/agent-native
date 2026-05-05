import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useDbSync } from "@agent-native/core";
import {
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  appPath,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { getThemeInitScript } from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-meeting-notes",
  }),
});

const toasterClassName =
  "toaster group [--width:min(36rem,calc(100vw_-_2rem))]";

const toastOptions = {
  classNames: {
    toast:
      "group toast !w-[var(--width)] !min-w-[min(20rem,calc(100vw_-_2rem))] !max-w-[var(--width)] !gap-3 !break-normal",
    title: "break-words",
    description: "break-words",
    content:
      "!min-w-[min(16rem,calc(100vw_-_14rem))] !flex-1 !basis-auto break-words",
    actionButton: "!shrink-0 !whitespace-nowrap",
    cancelButton: "!shrink-0 !whitespace-nowrap",
  },
};

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
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <meta name="theme-color" content="#18181B" />
        <meta name="apple-mobile-web-app-title" content="Notes" />
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

const TAB_ID = Math.random().toString(36).slice(2, 10);

function DbSyncSetup() {
  const qc = useQueryClient();
  useNavigationState();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "meetings",
      "transcripts",
      "notes",
      "attendees",
      "people",
      "companies",
      "templates",
      "folders",
    ],
    ignoreSource: TAB_ID,
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

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <DbSyncSetup />
            <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
              <CommandMenu.Group heading="Actions">
                <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
              </CommandMenu.Group>
              <CommandMenu.Group heading="Appearance">
                <ThemeToggleItem />
              </CommandMenu.Group>
            </CommandMenu>
            <Outlet />
            <Toaster
              richColors
              position="bottom-left"
              className={toasterClassName}
              toastOptions={toastOptions}
            />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
