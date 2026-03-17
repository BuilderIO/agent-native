import "./global.css";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { InboxPage } from "@/pages/InboxPage";
import { NotFound } from "@/pages/NotFound";
import { useFileWatcher } from "@agent-native/core";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

/** Ensure the app window has focus so keyboard shortcuts work immediately,
 *  even when embedded in an iframe (CLI harness) or Electron webview. */
function AutoFocus() {
  useEffect(() => {
    // Focus on mount
    window.focus();

    // When the page becomes visible (e.g. tab switch), re-focus
    const handleVisibility = () => {
      if (document.visibilityState === "visible") window.focus();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // When user clicks anywhere in the app, ensure window has focus
    // (clicks on iframes inside the app can steal focus)
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
    queryKeys: [], // We handle invalidation in onEvent
    onEvent: (data: { type: string; path: string }) => {
      if (data.path?.includes("application-state")) {
        // Force refetch compose-drafts when a compose file changes
        // (agent may have created/updated a draft — must pick it up immediately)
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
      }
    },
  });
  return null;
}

const App = () => (
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
        <BrowserRouter>
          <AppLayout>
            <Routes>
              <Route path="/" element={<Navigate to="/inbox" replace />} />
              <Route path="/:view" element={<InboxPage />} />
              <Route path="/:view/:threadId" element={<InboxPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppLayout>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
