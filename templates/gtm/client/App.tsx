import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFileWatcher } from "@agent-native/core/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Workspace } from "./pages/Workspace";
import { Toaster } from "sonner";

const queryClient = new QueryClient();

function FileWatcher() {
  useFileWatcher({
    queryClient,
    queryKeys: ["files", "file"],
  });
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <FileWatcher />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Workspace />} />
          <Route path="/file/*" element={<Workspace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
