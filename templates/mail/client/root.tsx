import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import { useEffect } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { useFileWatcher } from "@agent-native/core";
import "./global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="icon"
          type="image/svg+xml"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📧</text></svg>"
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

/** Ensure the app window has focus so keyboard shortcuts work immediately */
function AutoFocus() {
  useEffect(() => {
    window.focus();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") window.focus();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const handleClick = () => window.focus();
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);
  return null;
}

function FileWatcherSetup() {
  const qc = useQueryClient();
  useFileWatcher({
    queryClient: qc,
    queryKeys: [],
    onEvent: (data: { type: string; path: string }) => {
      if (data.path?.includes("application-state")) {
        if (data.path?.includes("compose-")) {
          qc.invalidateQueries({
            queryKey: ["compose-drafts"],
            refetchType: "all",
          });
        }
        qc.invalidateQueries({ queryKey: ["navigate-command"] });
      } else {
        qc.invalidateQueries({ queryKey: ["emails"] });
        qc.invalidateQueries({ queryKey: ["email"] });
        qc.invalidateQueries({ queryKey: ["labels"] });
        qc.invalidateQueries({ queryKey: ["settings"] });
        qc.invalidateQueries({ queryKey: ["aliases"] });
      }
    },
  });
  return null;
}

export default function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
      >
        <TooltipProvider delayDuration={300}>
          <Toaster richColors position="bottom-right" />
          <AutoFocus />
          <FileWatcherSetup />
          <AppLayout>
            <Outlet />
          </AppLayout>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="flex items-center justify-center min-h-screen p-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-2">{message}</h1>
        <p className="text-muted-foreground">{details}</p>
        {stack && (
          <pre className="mt-4 text-left text-xs overflow-auto max-w-lg mx-auto p-4 bg-muted rounded">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
