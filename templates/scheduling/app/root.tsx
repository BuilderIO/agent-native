import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import {
  useDbSync,
  ClientOnly,
  DefaultSpinner,
  CommandMenu,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-scheduling",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='4' width='18' height='18' rx='2' /><path d='M16 2v4M8 2v4M3 10h18' /></svg>"
        />
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
  const { theme, setTheme } = useTheme();
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <DbSyncSetup />
            <Toaster position="bottom-left" />
            <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
              <CommandMenu.Group heading="Actions">
                <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
              </CommandMenu.Group>
              <CommandMenu.Group heading="Appearance">
                <CommandMenu.Item
                  onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
                  keywords={["theme", "dark", "light", "mode"]}
                >
                  {theme === "dark" ? (
                    <IconSun size={16} />
                  ) : (
                    <IconMoon size={16} />
                  )}
                  Toggle {theme === "dark" ? "light" : "dark"} mode
                </CommandMenu.Item>
              </CommandMenu.Group>
            </CommandMenu>
            <Outlet />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
