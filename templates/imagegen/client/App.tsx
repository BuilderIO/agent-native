import "./global.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFileWatcher } from "@agent-native/core";
import { Layout } from "@/components/Layout";
import BrandLibrary from "@/pages/BrandLibrary";
import Generate from "@/pages/Generate";
import Gallery from "@/pages/Gallery";

const queryClient = new QueryClient();

function App() {
  useFileWatcher({ queryClient, queryKeys: ["brand", "generations"] });

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<BrandLibrary />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/gallery" element={<Gallery />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
