import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { useDbSync } from "@agent-native/core";
import {
  ClientOnly,
  DefaultSpinner,
  CommandMenu,
  appPath,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { Layout as AppLayout } from "./components/layout/Layout";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

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

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="apple-touch-icon" href={appPath("/icon-180.svg")} />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function AppShell() {
  useDbSync();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  const { theme, setTheme } = useTheme();

  return (
    <TooltipProvider>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Actions">
          <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading="Appearance">
          <CommandMenu.Item
            onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
            keywords={["theme", "dark", "light", "mode"]}
          >
            {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
            Toggle {theme === "dark" ? "light" : "dark"} mode
          </CommandMenu.Item>
        </CommandMenu.Group>
      </CommandMenu>
      <AppLayout>
        <Outlet />
      </AppLayout>
      <Toaster
        richColors
        position="bottom-left"
        className={toasterClassName}
        toastOptions={toastOptions}
      />
    </TooltipProvider>
  );
}

export default function App() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <ClientOnly fallback={<DefaultSpinner />}>
          <AppShell />
        </ClientOnly>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
