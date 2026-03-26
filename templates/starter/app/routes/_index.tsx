import { useState } from "react";
import { useTheme } from "next-themes";
import { AgentTerminal } from "@agent-native/core/terminal";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";

export function meta() {
  return [{ title: "Agent Native App" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function IndexPage() {
  const { theme, setTheme } = useTheme();
  const [showTerminal, setShowTerminal] = useState(false);

  return (
    <div className="flex flex-col h-screen">
      <div className="fixed right-3 top-3 z-50">
        <AgentToggleButton className="h-9 w-9 rounded-xl border border-border/60 bg-background/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75" />
      </div>
      <AgentSidebar
        position="right"
        defaultOpen
        emptyStateText="How can I help?"
        suggestions={[
          "What can you do?",
          "Show me the database schema",
          "Create something cool",
        ]}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between px-4 py-2 border-b border-border">
            <h2 className="text-sm font-medium text-foreground">
              Agent Native
            </h2>
          </header>

          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="max-w-md w-full space-y-8 text-center">
              <div className="space-y-3">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  Your app is running
                </h1>
                <p className="text-[14px] text-muted-foreground leading-relaxed">
                  Start building by editing{" "}
                  <code className="text-[13px] bg-muted px-1.5 py-0.5 rounded font-mono">
                    app/routes/_index.tsx
                  </code>
                </p>
              </div>

              <div className="h-px bg-border" />

              <div className="grid grid-cols-2 gap-3 text-left">
                <a
                  href="https://agent-native.dev/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50"
                >
                  <p className="text-[13px] font-medium text-foreground">
                    Documentation
                  </p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Learn the framework
                  </p>
                </a>
                <button
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  className="rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 text-left"
                >
                  <p className="text-[13px] font-medium text-foreground">
                    Theme
                  </p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Toggle dark / light
                  </p>
                </button>
              </div>

              <button
                onClick={() => setShowTerminal(!showTerminal)}
                className="text-[13px] text-muted-foreground hover:text-foreground"
              >
                {showTerminal ? "Hide" : "Show"} Agent Terminal
              </button>
            </div>
          </div>

          {showTerminal && (
            <div className="h-[350px] border-t border-border">
              <AgentTerminal />
            </div>
          )}
        </div>
      </AgentSidebar>
    </div>
  );
}
