import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { LoginScreen } from "@/components/auth/LoginScreen";
import Index from "./pages/Index";
import Welcome from "./pages/Welcome";
import QueryExplorer from "./pages/QueryExplorer";
import Settings from "./pages/Settings";
import AdhocRouter from "./pages/adhoc/AdhocRouter";
import NotFound from "./pages/NotFound";
import About from "./pages/About";
import { CommandPalette } from "./components/layout/CommandPalette";

const queryClient = new QueryClient();

function AuthGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <AuthGate>
            <CommandPalette />
            <Routes>
              <Route path="/" element={<Welcome />} />
              <Route path="/overview" element={<Index />} />
              <Route path="/adhoc/:id" element={<AdhocRouter />} />
              <Route path="/query" element={<QueryExplorer />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/about" element={<About />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthGate>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
