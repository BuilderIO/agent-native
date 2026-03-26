import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeckProvider } from "@/context/DeckContext";
import {
  AgentSidebar,
  AgentToggleButton,
  enterStyleEditing as coreEnterStyleEditing,
  enterTextEditing as coreEnterTextEditing,
  exitSelectionMode as coreExitSelectionMode,
} from "@agent-native/core/client";
import "./global.css";

// Key forces DeckProvider remount when code changes (HMR)
const DECK_KEY = 3;

/** Track whether we (the app) put the user into selection mode via a slide click */
let weEnteredSelectionMode = false;

/** Helper to send selection mode messages and track state */
export function enterSelectionMode(
  type: "builder.enterStyleEditing" | "builder.enterTextEditing",
  data: { selector: string },
) {
  weEnteredSelectionMode = true;
  if (type === "builder.enterStyleEditing") {
    coreEnterStyleEditing(data.selector);
  } else {
    coreEnterTextEditing(data.selector);
  }
}

export function exitSelectionMode() {
  weEnteredSelectionMode = false;
  coreExitSelectionMode();
}

function useExitSelectionOnOutsideClick() {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!weEnteredSelectionMode) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(".slide-content") ||
        target.closest(".slide-image-clickable")
      ) {
        return;
      }
      exitSelectionMode();
    };
    window.addEventListener("pointerdown", handler, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", handler, { capture: true });
  }, []);
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="icon"
          type="image/svg+xml"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎴</text></svg>"
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#EC4899" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Slides" />
        <link rel="apple-touch-icon" href="/icon-180.svg" />
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

export default function Root() {
  useExitSelectionOnOutsideClick();
  const [queryClient] = useState(() => new QueryClient());
  // AgentSidebar uses useLayoutEffect internally (via @assistant-ui),
  // which errors during SSR. Only render on client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <QueryClientProvider client={queryClient}>
      <DeckProvider key={DECK_KEY}>
        {mounted ? (
          <AgentSidebar
            position="right"
            defaultOpen
            emptyStateText="Ask me anything about your presentations"
            suggestions={[
              "Create a new deck",
              "Generate slides about AI",
              "Add an image to this slide",
            ]}
          >
            <div className="fixed right-3 top-3 z-50">
              <AgentToggleButton className="h-9 w-9 rounded-xl border border-border/60 bg-background/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75" />
            </div>
            <Outlet />
          </AgentSidebar>
        ) : (
          <Outlet />
        )}
      </DeckProvider>
    </QueryClientProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
