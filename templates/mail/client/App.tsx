import "./global.css";
import { createRoot } from "react-dom/client";
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

function FileWatcherSetup() {
  const qc = useQueryClient();
  useFileWatcher({
    queryClient: qc,
    queryKeys: [], // We handle invalidation in onEvent
    onEvent: (data: { type: string; path: string }) => {
      if (data.path?.includes("application-state")) {
        qc.invalidateQueries({ queryKey: ["compose-state"] });
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
