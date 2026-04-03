import { useState, useRef, useEffect } from "react";
import { IconArrowRight } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
} from "@agent-native/core/client";

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
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function submit() {
    const text = prompt.trim();
    if (!text) return;
    sendToAgentChat({ message: text });
    setPrompt("");
  }

  return (
    <div className="flex flex-col h-screen">
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
            <AgentToggleButton />
          </header>

          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="w-full max-w-xl space-y-6">
              <h1 className="text-center text-3xl font-semibold tracking-tight text-foreground">
                What do you want to build?
              </h1>

              <div className="rounded-xl border border-border bg-card shadow-sm">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Describe what you'd like the agent to build..."
                  rows={4}
                  className="w-full resize-none rounded-t-xl bg-transparent px-4 pt-4 pb-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
                />
                <div className="flex items-center justify-between px-4 pb-3">
                  <span className="text-[11px] text-muted-foreground/50">
                    Enter to submit
                  </span>
                  <button
                    onClick={submit}
                    disabled={!prompt.trim()}
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background disabled:opacity-20"
                  >
                    <IconArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                {[
                  "A dashboard with charts",
                  "A todo app",
                  "A blog with markdown",
                  "A chat interface",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      sendToAgentChat({ message: suggestion });
                    }}
                    className="rounded-full border border-border/60 px-3.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              <div className="h-px bg-border" />

              <div className="grid grid-cols-2 gap-3 text-left">
                <a
                  href="https://agent-native.com/docs"
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
            </div>
          </div>
        </div>
      </AgentSidebar>
    </div>
  );
}
