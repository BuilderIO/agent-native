import { agentNativePath } from "../api-path.js";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { IconPlus, IconTool } from "@tabler/icons-react";
import { cn } from "../utils.js";
import { AgentToggleButton } from "../AgentPanel.js";
import { NotificationsBell } from "../notifications/NotificationsBell.js";
import { sendToAgentChat } from "../agent-chat.js";
import { PromptComposer } from "../composer/PromptComposer.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  TOOLS_ORDER_CHANGE_EVENT,
  applyToolsOrder,
  getToolsOrder,
} from "./extension-order.js";

interface Extension {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

function submitCreateTool(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  sendToAgentChat({
    message: `Create a extension: ${trimmed}`,
    submit: true,
    openSidebar: true,
    newTab: true,
  });
}

function CreateToolInput({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-sm font-semibold text-foreground">New extension</p>
      <PromptComposer
        autoFocus
        placeholder="Describe what you'd like to build... e.g. a todo list, API dashboard, calculator"
        draftScope="extensions:create"
        onSubmit={(text) => submitCreateTool(text)}
      />
    </div>
  );
}

export function ExtensionsListPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [toolOrderState, setToolOrderState] = useState<string[]>(() =>
    typeof window !== "undefined" ? getToolsOrder() : [],
  );

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { view: "extensions" } }),
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

  const { data: extensions, isLoading } = useQuery<Extension[]>({
    queryKey: ["extensions"],
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/extensions"));
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toolList =
    toolOrderState.length > 0
      ? applyToolsOrder(extensions ?? [], toolOrderState)
      : (extensions ?? []);

  const handleCreate = (text: string) => {
    submitCreateTool(text);
    setShowCreate(false);
  };

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4 shrink-0">
        <h1 className="text-sm font-semibold">Extensions</h1>
        <div className="flex items-center gap-2">
          <Popover open={showCreate} onOpenChange={setShowCreate}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <IconPlus className="h-4 w-4" />
                New Extension
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-[420px] p-3"
            >
              <p className="px-1 pb-2 text-sm font-semibold text-foreground">
                New extension
              </p>
              <PromptComposer
                autoFocus
                placeholder="Describe what you'd like to build..."
                draftScope="extensions:create-popover"
                onSubmit={handleCreate}
              />
            </PopoverContent>
          </Popover>
          <NotificationsBell />
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
              <p className="text-sm font-medium">No extensions yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Describe what you'd like to build
              </p>
            </div>
            <CreateToolInput className="w-full max-w-sm" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {toolList.map((extension) => (
              <Link
                key={extension.id}
                to={`/extensions/${extension.id}`}
                className={cn(
                  "group cursor-pointer rounded-lg border border-border bg-card p-5",
                  "hover:border-primary/30 hover:shadow-sm",
                )}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                  <IconTool className="h-5 w-5" />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-foreground">
                  {extension.name}
                </h3>
                {extension.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {extension.description}
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
