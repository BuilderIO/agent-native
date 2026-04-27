import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { IconPlus, IconTool } from "@tabler/icons-react";
import { cn } from "../utils.js";
import { sendToAgentChat } from "../agent-chat.js";

interface Tool {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

function CreateToolInput({
  className,
  inputClassName,
}: {
  className?: string;
  inputClassName?: string;
}) {
  const [prompt, setPrompt] = useState("");

  const handleCreate = () => {
    if (!prompt.trim()) return;
    sendToAgentChat({
      message: `Create a tool called "${prompt.trim()}"`,
      submit: true,
      openSidebar: true,
    });
    setPrompt("");
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. a todo list, API dashboard, calculator..."
        className={cn(
          "flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring",
          inputClassName,
        )}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
        }}
      />
      <button
        type="button"
        onClick={handleCreate}
        disabled={!prompt.trim()}
        className={cn(
          "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer",
          !prompt.trim() && "opacity-60",
        )}
      >
        Create
      </button>
    </div>
  );
}

export function ToolsListPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [createPrompt, setCreatePrompt] = useState("");

  useEffect(() => {
    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { view: "tools" } }),
    }).catch(() => {});
  }, []);

  const { data: tools, isLoading } = useQuery<Tool[]>({
    queryKey: ["tools"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/tools");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toolList = tools ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="relative flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Tools</h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <IconPlus className="h-4 w-4" />
          New Tool
        </button>

        {showCreate && (
          <div className="absolute right-6 top-full z-50 mt-1 w-80 rounded-lg border bg-popover p-3 shadow-lg">
            <input
              autoFocus
              value={createPrompt}
              onChange={(e) => setCreatePrompt(e.target.value)}
              placeholder="What would you like to build?"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter" && createPrompt.trim()) {
                  sendToAgentChat({
                    message: `Create a tool called "${createPrompt.trim()}"`,
                    submit: true,
                    openSidebar: true,
                  });
                  setCreatePrompt("");
                  setShowCreate(false);
                }
                if (e.key === "Escape") setShowCreate(false);
              }}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (createPrompt.trim()) {
                    sendToAgentChat({
                      message: `Create a tool called "${createPrompt.trim()}"`,
                      submit: true,
                      openSidebar: true,
                    });
                    setCreatePrompt("");
                    setShowCreate(false);
                  }
                }}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                Create
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-5"
              >
                <div className="mb-3 h-10 w-10 animate-pulse rounded-lg bg-muted" />
                <div className="mb-2 h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : toolList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <IconTool className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium">No tools yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Describe what you'd like to build
              </p>
            </div>
            <CreateToolInput className="w-full max-w-sm" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {toolList.map((tool) => (
              <Link
                key={tool.id}
                to={`/tools/${tool.id}`}
                className={cn(
                  "group cursor-pointer rounded-lg border border-border bg-card p-5",
                  "hover:border-primary/30 hover:shadow-sm",
                )}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                  <IconTool className="h-5 w-5" />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-foreground">
                  {tool.name}
                </h3>
                {tool.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {tool.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
