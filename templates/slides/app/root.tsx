import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useEffect } from "react";
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
  return (
    <DeckProvider key={DECK_KEY}>
      <AgentSidebar
        position="left"
        defaultOpen
        emptyStateText="Ask me anything about your presentations"
        suggestions={[
          "Create a new deck",
          "Generate slides about AI",
          "Add an image to this slide",
        ]}
      >
        <div className="fixed top-3 left-3 z-50">
          <AgentToggleButton />
        </div>
        <Outlet />
      </AgentSidebar>
    </DeckProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
