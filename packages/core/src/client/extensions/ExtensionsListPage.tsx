import {
  IconArrowLeft,
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconPlus,
  IconTool,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Link } from "react-router";

import { extensionPath } from "../../extensions/path.js";
import { sendToAgentChat } from "../agent-chat.js";
import { AgentToggleButton } from "../AgentPanel.js";
import { agentNativePath } from "../api-path.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { PromptComposer } from "../composer/PromptComposer.js";
import { useT } from "../i18n.js";
import { NotificationsBell } from "../notifications/NotificationsBell.js";
import { cn } from "../utils.js";
import {
  deleteOrHideExtension,
  invalidateExtensionRemoval,
} from "./delete-extension.js";
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
  canDelete?: boolean;
  globallyHidden?: boolean;
  source?: {
    mode?: "database" | "local-files";
    entryPath?: string;
  };
}

let lastCreateSubmission: { prompt: string; at: number } | null = null;

function submitCreateTool(
  prompt: string,
  messageForPrompt: (prompt: string) => string,
) {
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
    message: messageForPrompt(trimmed),
    submit: true,
    openSidebar: true,
    newTab: true,
  });
}

function CreateToolInput({ className }: { className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex flex-col gap-2 text-left", className)}>
      <p className="px-1 text-sm font-medium text-foreground">
        {t("extensions.whatShouldItDo")}
      </p>
      <PromptComposer
        autoFocus
        className="text-left"
        placeholder={t("extensions.createPlaceholder")}
        draftScope="extensions:create"
        onSubmit={(text) =>
          submitCreateTool(text, (prompt) =>
            t("extensions.createPrompt", { prompt }),
          )
        }
      />
    </div>
  );
}

export function ExtensionsListPage() {
  const t = useT();
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showGloballyHidden, setShowGloballyHidden] = useState(false);
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
    queryKey: ["extensions", { includeGloballyHidden: showGloballyHidden }],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(
          showGloballyHidden
            ? "/_agent-native/extensions?includeGloballyHidden=true"
            : "/_agent-native/extensions",
        ),
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toolList =
    toolOrderState.length > 0
      ? applyToolsOrder(extensions ?? [], toolOrderState)
      : (extensions ?? []);

  const handleCreate = (text: string) => {
    submitCreateTool(text, (prompt) =>
      t("extensions.createPrompt", { prompt }),
    );
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

  const handleGlobalHideToggle = async (extension: Extension) => {
    setConfirmDeleteId(null);
    const action = extension.globallyHidden ? "global-unhide" : "global-hide";
    try {
      await fetch(
        agentNativePath(`/_agent-native/extensions/${extension.id}/${action}`),
        { method: "POST" },
      );
    } finally {
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
            aria-label={t("extensions.backToApp")}
          >
            <IconArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-sm font-semibold">{t("extensions.title")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowGloballyHidden((prev) => !prev)}
            aria-pressed={showGloballyHidden}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium",
              showGloballyHidden
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {showGloballyHidden ? (
              <IconEye className="h-4 w-4" />
            ) : (
              <IconEyeOff className="h-4 w-4" />
            )}
            {showGloballyHidden
              ? t("extensions.hiddenShown")
              : t("extensions.showHidden")}
          </button>
          <Popover open={showCreate} onOpenChange={setShowCreate}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <IconPlus className="h-4 w-4" />
                {t("extensions.newExtension")}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-[420px] p-3"
            >
              <p className="px-1 pb-2 text-sm font-semibold text-foreground">
                {t("extensions.newExtensionTitle")}
              </p>
              <PromptComposer
                autoFocus
                placeholder={t("extensions.buildPlaceholder")}
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
          <div className="flex min-h-[calc(100vh-9rem)] flex-col items-center justify-start px-2 pb-12 pt-[clamp(5rem,18vh,11rem)] sm:pb-16">
            <div className="mx-auto flex w-full max-w-[34rem] flex-col gap-7">
              <div className="flex flex-col items-center gap-3 text-center">
                <IconTool className="h-10 w-10 text-muted-foreground/40" />
                <div className="space-y-1.5">
                  <p className="text-base font-semibold text-foreground">
                    {t("extensions.emptyTitle")}
                  </p>
                  <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                    {t("extensions.emptyDescription")}
                  </p>
                </div>
              </div>
              <CreateToolInput className="w-full" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {toolList.map((extension) => {
              const isLocalExtension = extension.source?.mode === "local-files";
              return (
                <div
                  key={extension.id}
                  className={cn(
                    "group relative rounded-lg border border-border bg-card",
                    "hover:border-primary/30 hover:shadow-sm",
                    extension.globallyHidden && "opacity-60",
                  )}
                >
                  <Link
                    to={extensionPath(extension.id, extension.name)}
                    className="block p-5 pr-12"
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                      <IconTool className="h-5 w-5" />
                    </div>
                    <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      {extension.globallyHidden && (
                        <IconEyeOff
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          aria-label={t("extensions.hiddenFromEveryone")}
                        />
                      )}
                      <span className="truncate">{extension.name}</span>
                    </h3>
                    {extension.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {extension.description}
                      </p>
                    )}
                    {isLocalExtension && (
                      <p className="mt-3 inline-flex rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("extensions.localFile")}
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
                        aria-label={t("extensions.optionsFor", {
                          name: extension.name,
                        })}
                      >
                        <IconDotsVertical className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      sideOffset={4}
                      className="w-64 p-0"
                    >
                      {!isLocalExtension && extension.canDelete !== false && (
                        <div className="border-b p-1">
                          <button
                            type="button"
                            onClick={() => handleGlobalHideToggle(extension)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent"
                          >
                            {extension.globallyHidden ? (
                              <>
                                <IconEye className="h-3.5 w-3.5" />
                                {t("extensions.unhideEveryone")}
                              </>
                            ) : (
                              <>
                                <IconEyeOff className="h-3.5 w-3.5" />
                                {t("extensions.hideEveryone")}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                      {isLocalExtension ? (
                        <div className="p-3 text-[12px] text-muted-foreground">
                          {t("extensions.localFileDescription", {
                            entryPath:
                              extension.source?.entryPath ?? "local files",
                          })}
                        </div>
                      ) : (
                        <div className="p-3">
                          <p className="text-[12px]">
                            {extension.canDelete === false
                              ? t("extensions.removeQuestion", {
                                  name: extension.name,
                                })
                              : t("extensions.deleteQuestion", {
                                  name: extension.name,
                                })}{" "}
                            {extension.canDelete === false
                              ? t("extensions.hideForYouDescription")
                              : t("extensions.removeEverywhereDescription")}
                          </p>
                          <div className="mt-3 flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-md px-2 py-1 text-[12px] hover:bg-accent"
                            >
                              {t("extensions.cancel")}
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
                                  ? t("extensions.removing")
                                  : t("extensions.deleting")
                                : extension.canDelete === false
                                  ? t("extensions.remove")
                                  : t("extensions.delete")}
                            </button>
                          </div>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
