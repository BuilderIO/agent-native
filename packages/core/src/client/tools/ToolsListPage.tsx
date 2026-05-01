import { agentNativePath } from "../api-path.js";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { IconPlus, IconTool } from "@tabler/icons-react";
import { cn } from "../utils.js";
import { AgentToggleButton } from "../AgentPanel.js";
import { sendToAgentChat } from "../agent-chat.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  TOOLS_ORDER_CHANGE_EVENT,
  applyToolsOrder,
  getToolsOrder,
} from "./tool-order.js";

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
      message: `Create a tool: ${prompt.trim()}`,
      submit: true,
      openSidebar: true,
      newTab: true,
    });
    setPrompt("");
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={
          "Describe what you'd like to build...\ne.g. a todo list, API dashboard, calculator"
        }
        className={cn(
          "flex w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 min-h-[100px] resize-y",
          inputClassName,
        )}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleCreate();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px] text-muted-foreground/75">
          {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}+Enter
        </span>
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
    </div>
  );
}

export function ToolsListPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [createPrompt, setCreatePrompt] = useState("");
  const [toolOrderState, setToolOrderState] = useState<string[]>(() =>
    typeof window !== "undefined" ? getToolsOrder() : [],
  );

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { view: "tools" } }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncOrder = () => setToolOrderState(getToolsOrder());
    window.addEventListener(TOOLS_ORDER_CHANGE_EVENT, syncOrder);
    window.addEventListener("storage", syncOrder);
    return () => {
      window.removeEventListener(TOOLS_ORDER_CHANGE_EVENT, syncOrder);
      window.removeEventListener("storage", syncOrder);
    };
  }, []);

  const { data: tools, isLoading } = useQuery<Tool[]>({
    queryKey: ["tools"],
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/tools"));
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toolList =
    toolOrderState.length > 0
      ? applyToolsOrder(tools ?? [], toolOrderState)
      : (tools ?? []);

  const handleCreate = () => {
    if (!createPrompt.trim()) return;
    sendToAgentChat({
      message: `Create a tool: ${createPrompt.trim()}`,
      submit: true,
      openSidebar: true,
      newTab: true,
    });
    setCreatePrompt("");
    setShowCreate(false);
  };

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4 shrink-0">
        <h1 className="text-sm font-semibold">Tools</h1>
        <div className="flex items-center gap-2">
          <Popover open={showCreate} onOpenChange={setShowCreate}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <IconPlus className="h-4 w-4" />
                New Tool
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-80 p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreate();
                }}
              >
                <textarea
                  autoFocus
                  value={createPrompt}
                  onChange={(e) => setCreatePrompt(e.target.value)}
                  placeholder="Describe what you'd like to build..."
                  className="flex w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 min-h-[140px] resize-y"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                />
                <div className="flex items-center justify-end gap-2 mt-3">
                  <span className="text-[11px] text-muted-foreground/75">
                    {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}
                    +Enter
                  </span>
                  <button
                    type="submit"
                    disabled={!createPrompt.trim()}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Create
                  </button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
          <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-5"
              >
                <div className="mb-3 h-10 w-10 rounded-lg bg-muted animate-pulse" />
                <div className="mb-2 h-4 w-2/3 rounded bg-muted animate-pulse" />
                <div className="h-3 w-4/5 rounded bg-muted animate-pulse" />
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
