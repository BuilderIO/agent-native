import { agentNativePath } from "../api-path.js";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  IconArrowLeft,
  IconDotsVertical,
  IconPlus,
  IconTool,
  IconTrash,
} from "@tabler/icons-react";
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
import {
  deleteOrHideExtension,
  invalidateExtensionRemoval,
} from "./delete-extension.js";

interface Extension {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  canDelete?: boolean;
}

let lastCreateSubmission: { prompt: string; at: number } | null = null;

function submitCreateTool(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  const now = Date.now();
  if (
    lastCreateSubmission &&
    lastCreateSubmission.prompt === trimmed &&
    now - lastCreateSubmission.at < 2_000
  ) {
    return;
  }
  lastCreateSubmission = { prompt: trimmed, at: now };
  sendToAgentChat({
    message: `Create an extension: ${trimmed}`,
    submit: true,
    openSidebar: true,
    newTab: true,
  });
}

function CreateToolInput({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="text-center text-base font-semibold text-foreground">
        New extension
      </p>
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [toolOrderState, setToolOrderState] = useState<string[]>(() =>
    typeof window !== "undefined" ? getToolsOrder() : [],
  );

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: "extensions" }),
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

  const handleDelete = async (extension: Extension) => {
    setDeletingId(extension.id);
    const previous = queryClient.getQueryData<Extension[]>(["extensions"]);
    queryClient.setQueryData<Extension[]>(["extensions"], (old) =>
      (old ?? []).filter((item) => item.id !== extension.id),
    );
    try {
      await deleteOrHideExtension(extension);
      invalidateExtensionRemoval(queryClient, extension.id);
    } catch {
      if (previous) queryClient.setQueryData(["extensions"], previous);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back to app"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-sm font-semibold">Extensions</h1>
        </div>
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
          <AgentToggleButton />
        </div>
      </header>

      <div className="flex-1 overflow-auto px-5 py-8 sm:px-8 sm:py-10">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
          <div className="flex min-h-[calc(100vh-9rem)] flex-col items-center justify-center px-2 py-12 text-center sm:py-16">
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8">
              <div className="flex flex-col items-center gap-4">
                <IconTool className="h-12 w-12 text-muted-foreground/40" />
                <div className="space-y-2">
                  <p className="text-base font-semibold text-foreground">
                    No extensions yet
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Describe what you'd like to build
                  </p>
                </div>
              </div>
              <CreateToolInput className="w-full" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {toolList.map((extension) => (
              <div
                key={extension.id}
                className={cn(
                  "group relative rounded-lg border border-border bg-card",
                  "hover:border-primary/30 hover:shadow-sm",
                )}
              >
                <Link
                  to={`/extensions/${extension.id}`}
                  className="block p-5 pr-12"
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
                <Popover
                  open={confirmDeleteId === extension.id}
                  onOpenChange={(open) =>
                    setConfirmDeleteId(open ? extension.id : null)
                  }
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover:opacity-100"
                      aria-label={`Options for ${extension.name}`}
                    >
                      <IconDotsVertical className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={4}
                    className="w-64 p-0"
                  >
                    <div className="p-3">
                      <p className="text-[12px]">
                        {extension.canDelete === false ? "Remove " : "Delete "}
                        <span className="font-medium">{extension.name}</span>?
                        {extension.canDelete === false
                          ? " This hides it from your Extensions list without deleting it for anyone else."
                          : " This removes it everywhere it is shared."}
                      </p>
                      <div className="mt-3 flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-md px-2 py-1 text-[12px] hover:bg-accent"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(extension)}
                          disabled={deletingId === extension.id}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md bg-destructive px-2 py-1 text-[12px] text-destructive-foreground hover:bg-destructive/90",
                            deletingId === extension.id && "opacity-60",
                          )}
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                          {deletingId === extension.id
                            ? extension.canDelete === false
                              ? "Removing..."
                              : "Deleting..."
                            : extension.canDelete === false
                              ? "Remove"
                              : "Delete"}
                        </button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
