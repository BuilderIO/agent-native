import "./global.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFileWatcher } from "@agent-native/core/client";
import { Toaster } from "@/components/ui/sonner";
import CalendarView from "./pages/CalendarView";
import Settings from "./pages/Settings";
import AvailabilitySettings from "./pages/AvailabilitySettings";
import BookingsList from "./pages/BookingsList";
import BookingPage from "./pages/BookingPage";
import NotFound from "./pages/NotFound";
import { AppLayout } from "@/components/layout/AppLayout";

const queryClient = new QueryClient();

function FileWatcherSetup() {
  useFileWatcher({
    queryClient,
    queryKeys: [
      "events",
      "bookings",
      "availability",
      "settings",
      "google-status",
    ],
  });
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <FileWatcherSetup />
    <Toaster />
    <BrowserRouter>
      <Routes>
        {/* Public booking page - no app layout */}
        <Route path="/book/:slug" element={<BookingPage />} />
        {/* App routes with layout */}
        <Route
          path="/"
          element={
            <AppLayout>
              <CalendarView />
            </AppLayout>
          }
        />
        <Route
          path="/settings"
          element={
            <AppLayout>
              <Settings />
            </AppLayout>
          }
        />
        <Route
          path="/availability"
          element={
            <AppLayout>
              <AvailabilitySettings />
            </AppLayout>
          }
        />
        <Route
          path="/bookings"
          element={
            <AppLayout>
              <BookingsList />
            </AppLayout>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
