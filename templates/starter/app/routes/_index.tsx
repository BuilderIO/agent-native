import { useState, useRef, useEffect } from "react";
import {
  IconArrowRight,
  IconDatabase,
  IconBolt,
  IconRefresh,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { sendToAgentChat, openAgentSidebar } from "@agent-native/core/client";

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

const FIRST_VISIT_KEY = "agent-native-first-visit";

const FIRST_VISIT_SUGGESTIONS = [
  "Walk me through the project structure",
  "Show me how actions work",
  "What makes Agent Native unique?",
  "Add a new page and route",
];

const RETURNING_SUGGESTIONS = [
  "What makes Agent Native special?",
  "How do the agent and UI stay in sync?",
  "Show me what you can build",
];

const CONCEPT_PILLS = [
  {
    icon: IconDatabase,
    label: "Shared State",
    message:
      "Explain how agent-UI state sync works in Agent Native and show me the relevant code.",
  },
  {
    icon: IconBolt,
    label: "Actions",
    message:
      "Show me the actions/ directory and explain how to add new agent capabilities.",
  },
  {
    icon: IconRefresh,
    label: "Live Sync",
    message:
      "How does useDbSync polling work? Show me the hook and explain jitter prevention.",
  },
];

export default function IndexPage() {
  const { theme, setTheme } = useTheme();
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFirstVisit, setIsFirstVisit] = useState(() => {
    try {
      return !localStorage.getItem(FIRST_VISIT_KEY);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function markVisited() {
    if (!isFirstVisit) return;
    try {
      localStorage.setItem(FIRST_VISIT_KEY, "true");
    } catch {}
    setIsFirstVisit(false);
  }

  function submit() {
    const text = prompt.trim();
    if (!text) return;
    markVisited();
    sendToAgentChat({ message: text });
    setPrompt("");
  }

  const suggestions = isFirstVisit
    ? FIRST_VISIT_SUGGESTIONS
    : RETURNING_SUGGESTIONS;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
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
                className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background disabled:opacity-20 cursor-pointer"
              >
                <IconArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Adaptive suggestion buttons */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => {
                  markVisited();
                  sendToAgentChat({ message: suggestion });
                }}
                className="rounded-full border border-border/60 px-3.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground cursor-pointer"
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
              className="rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 text-left cursor-pointer"
            >
              <p className="text-[13px] font-medium text-foreground">Theme</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Toggle dark / light
              </p>
            </button>
          </div>

          {/* Concept pills */}
          <div className="flex items-center justify-center gap-2">
            {CONCEPT_PILLS.map(({ icon: Icon, label, message }) => (
              <button
                key={label}
                onClick={() => {
                  openAgentSidebar();
                  sendToAgentChat({ message, submit: true });
                }}
                className="flex items-center gap-1.5 rounded-full border border-border/40 px-3 py-1.5 text-xs text-muted-foreground/50 hover:bg-accent/50 hover:text-foreground hover:border-border cursor-pointer"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
