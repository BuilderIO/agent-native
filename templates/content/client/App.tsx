import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import Index from "./pages/Index";
import Settings from "./pages/Settings";
import BlogIndex from "./pages/BlogIndex";
import DocsIndex from "./pages/DocsIndex";
import BuilderCallback from "./pages/BuilderCallback";
import { BuilderAuthProvider } from "@/components/builder/BuilderAuthContext";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { useEffect } from "react";
import { mountPinpoint } from "@agent-native/pinpoint";

const queryClient = new QueryClient();

function FileWatcherSetup() {
  useFileWatcher();
  return null;
}

function PinpointSetup() {
  useEffect(() => {
    const { dispose } = mountPinpoint({
      author: "Vishwas",
      colorScheme: "auto",
      endpoint: "/api/signals",
      autoSubmit: true,
    });
    return dispose;
  }, []);
  return null;
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
    <QueryClientProvider client={queryClient}>
      <FileWatcherSetup />
      <PinpointSetup />
      <BuilderAuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/settings" element={<Settings />} />
              <Route path="/builder-callback" element={<BuilderCallback />} />
              <Route path="/blog" element={<BlogIndex />} />
              <Route path="/docs" element={<DocsIndex />} />
              <Route path="/image-gen" element={<Index />} />
              <Route path="/research-search" element={<Index />} />
              <Route path="/workspace/:workspace/*" element={<Index />} />
              <Route path="/:workspace/*" element={<Index />} />
              <Route path="/" element={<Index />} />
              <Route path="*" element={<Index />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </BuilderAuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
