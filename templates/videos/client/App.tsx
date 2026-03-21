import "./global.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router";
import Studio from "./pages/Index";
import ComponentLibrary from "./pages/ComponentLibrary";
import GitProviderDemo from "./pages/GitProviderDemo";
import ReviewPRDemo from "./pages/ReviewPRDemo";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          {/* Studio routes — compositionId can be "new" or a composition id */}
          <Route path="/" element={<Studio />} />
          <Route path="/c/:compositionId" element={<Studio />} />
          {/* Component Library */}
          <Route path="/components" element={<ComponentLibrary />} />
          {/* Git Providers Demo */}
          <Route path="/git-provider-demo" element={<GitProviderDemo />} />
          {/* Review PR Demo */}
          <Route path="/review-pr-demo" element={<ReviewPRDemo />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

// Prevent multiple createRoot calls during HMR by storing root globally
const container = document.getElementById("root")!;

// Store root reference globally to persist across HMR updates
declare global {
  interface Window {
    __appRoot?: ReturnType<typeof createRoot>;
  }
}

if (!window.__appRoot) {
  window.__appRoot = createRoot(container);
}

window.__appRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
