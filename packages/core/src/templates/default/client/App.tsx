import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFileWatcher } from "@agent-native/core";
import "./global.css";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Main />
    </QueryClientProvider>
  );
}

function Main() {
  useFileWatcher({ queryClient });

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Agent-Native App</h1>
        <p className="text-muted-foreground">
          Edit{" "}
          <code className="bg-muted px-2 py-1 rounded">client/App.tsx</code> to
          get started.
        </p>
        <p className="text-sm text-muted-foreground">
          API health: <HealthCheck />
        </p>
      </div>
    </div>
  );
}

function HealthCheck() {
  return (
    <span
      className="text-primary cursor-pointer hover:underline"
      onClick={async () => {
        const res = await fetch("/api/ping");
        const data = await res.json();
        alert(data.message);
      }}
    >
      /api/ping
    </span>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
