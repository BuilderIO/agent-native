import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useTheme } from "next-themes";
import {
  useDbSync,
  ClientOnly,
  CommandMenu,
  appPath,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
import { getThemeInitScript } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-scheduling",
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
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <meta
          name="theme-color"
          content="#ffffff"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#0e0f11"
          media="(prefers-color-scheme: dark)"
        />
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
      "event-types",
      "bookings",
      "schedules",
      "availability",
      "teams",
      "workflows",
      "routing-forms",
      "calendar-integrations",
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
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider>
          <ClientOnly>
            <DbSyncSetup />
            <Toaster richColors position="bottom-left" />
            <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
              <CommandMenu.Group heading="Actions">
                <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
              </CommandMenu.Group>
              <CommandMenu.Group heading="Appearance">
                <ThemeToggleItem />
              </CommandMenu.Group>
            </CommandMenu>
          </ClientOnly>
          <Outlet />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
