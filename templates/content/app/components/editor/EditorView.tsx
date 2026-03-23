import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useFileContent, useProjects, useSaveFile } from "@/hooks/use-projects";
import { VisualEditor } from "./VisualEditor";
import { MonacoMarkdownEditor } from "./MonacoMarkdownEditor";
import { HeroImagePicker } from "./HeroImagePicker";
import { cn } from "@/lib/utils";
import { Loader2, Code, History, Type } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBuilderAuth } from "@/components/builder/BuilderAuthContext";
import { BuilderSidebar } from "@/components/builder/BuilderSidebar";
import { NotionSidebar } from "@/components/notion/NotionSidebar";
import { BuilderLogo } from "@/components/icons/BuilderLogo";
import { parseFrontmatter, updateHeroImage } from "@/lib/frontmatter";
import { useQueryClient } from "@tanstack/react-query";
import { usePresence } from "@/hooks/use-presence";
import { PresenceAvatars } from "./PresenceAvatars";
import { ProjectActionsMenu } from "./ProjectActionsMenu";
import { ProjectHistoryView } from "./ProjectHistoryView";

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

type EditorMode = "visual" | "code" | "history";

interface EditorViewProps {
  projectSlug: string;
  filePath: string;
}

export function EditorView({ projectSlug, filePath }: EditorViewProps) {
  const { data, isLoading } = useFileContent(projectSlug, filePath);
  const { data: projectsData } = useProjects();
  const saveMutation = useSaveFile();
  const queryClient = useQueryClient();
  const { isConnected, auth } = useBuilderAuth();
  const viewers = usePresence(`${projectSlug}/${filePath}`);

  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ["notion-schema"],
      queryFn: () => authFetch("/api/notion/schema").then((r) => r.json()),
      staleTime: 5 * 60 * 1000,
    });

    queryClient.prefetchQuery({
      queryKey: ["notion-pages"],
      queryFn: () => authFetch("/api/notion/pages").then((r) => r.json()),
      staleTime: 5 * 60 * 1000,
    });

    if (auth?.apiKey) {
      queryClient.prefetchQuery({
        queryKey: ["builder-articles", auth.apiKey],
        queryFn: async () => {
          const res = await authFetch("/api/builder/articles", {
            headers: { "x-builder-api-key": auth.apiKey },
          });
          if (!res.ok) throw new Error("Failed to fetch articles");
          const data = await res.json();
          return data.articles;
        },
        staleTime: 2 * 60 * 1000,
      });
    }
  }, [queryClient, auth?.apiKey]);

  const [content, setContent] = useState("");
  const [mode, setMode] = useState<EditorMode>("visual");
  const [isDirty, setIsDirty] = useState(false);
  const hasLoadedRef = useRef(false);
  const [notionSyncStatus, setNotionSyncStatus] = useState<
    "idle" | "syncing" | "synced"
  >("idle");
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Hero image undo/redo stack
  const heroHistoryRef = useRef<{ undo: string[]; redo: string[] }>({
    undo: [],
    redo: [],
  });
  const lastHeroActionRef = useRef<"hero" | "body" | null>(null);

  const projectMeta = projectsData?.projects.find(
    (project) => project.slug === projectSlug,
  );
  const canonicalHandleFallback =
    projectMeta?.canonicalSlug?.split("/").pop() || null;

  // Parse frontmatter
  const { heroImage, frontmatter, contentWithoutFrontmatter, handle } =
    useMemo(() => {
      try {
        const parsed = parseFrontmatter(content);
        // We need to extract just the frontmatter block as a string to pass to VisualEditor
        const fmRegex = /^---\n([\s\S]*?)\n---\n?/;
        const match = content.match(fmRegex);

        return {
          heroImage:
            (parsed.data.builder?.image !== undefined
              ? parsed.data.builder.image
              : parsed.data.hero_image) ?? null,
          frontmatter: match ? match[0] : null,
          contentWithoutFrontmatter: parsed.content,
          handle:
            parsed.data.builder?.handle ||
            parsed.data.handle ||
            canonicalHandleFallback ||
            projectSlug.split("/").pop() ||
            projectSlug,
        };
      } catch (e) {
        // Fallback if parsing fails
        return {
          heroImage: null,
          frontmatter: null,
          contentWithoutFrontmatter: content,
          handle:
            canonicalHandleFallback ||
            projectSlug.split("/").pop() ||
            projectSlug,
        };
      }
    }, [canonicalHandleFallback, content, projectSlug]);

  const contentRef = useRef(content);
  contentRef.current = content;

  // Keep a ref to current frontmatter for the VisualEditor onChange
  const frontmatterRef = useRef(frontmatter);
  frontmatterRef.current = frontmatter;

  const handleHeroImageChange = useCallback((url: string | null) => {
    const prev = contentRef.current;
    // Push current content to hero undo stack
    heroHistoryRef.current.undo.push(prev);
    heroHistoryRef.current.redo = [];
    lastHeroActionRef.current = "hero";

    try {
      const newContent = updateHeroImage(prev, url);
      // We will handle the save/isDirty state by just setting content directly
      // via a setTimeout to ensure handleChange is already defined, or we can just
      // rely on the fact that handleChange will be available.
      setTimeout(() => handleChangeRef.current?.(newContent), 0);
    } catch (e) {
      // Fallback if parsing fails
    }
  }, []);

  // Undo/redo handler for hero image changes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key.toLowerCase() !== "z") return;

      const isRedo = e.shiftKey;
      const history = heroHistoryRef.current;

      if (isRedo && history.redo.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const redoContent = history.redo.pop()!;
        const prev = contentRef.current;
        history.undo.push(prev);
        setTimeout(() => handleChangeRef.current?.(redoContent), 0);
      } else if (
        !isRedo &&
        lastHeroActionRef.current === "hero" &&
        history.undo.length > 0
      ) {
        e.preventDefault();
        e.stopPropagation();
        const undoContent = history.undo.pop()!;
        const prev = contentRef.current;
        history.redo.push(prev);
        setTimeout(() => handleChangeRef.current?.(undoContent), 0);
        if (history.undo.length === 0) {
          lastHeroActionRef.current = null;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);
  const [activeSidebar, setActiveSidebar] = useState<
    "builder" | "notion" | null
  >(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;

  const handleChangeRef = useRef<(c: string) => void>();

  // Reset hasLoaded when switching files
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [projectSlug, filePath]);

  useEffect(() => {
    if (data?.content !== undefined) {
      // Don't overwrite local edits with server data if we have pending changes
      // or if a save is currently in flight
      if (
        !isDirtyRef.current &&
        !saveTimeoutRef.current &&
        !saveMutationRef.current.isPending
      ) {
        // Only update if content actually changed to prevent unnecessary re-renders
        if (data.content !== contentRef.current) {
          setContent(data.content);
          setIsDirty(false);
        }
      }
      hasLoadedRef.current = true;
    }
  }, [data?.content]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const scheduleSave = (newContent: string) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveMutationRef.current.mutate({
        projectSlug,
        filePath,
        content: newContent,
      });
      saveTimeoutRef.current = null;
      setIsDirty(false);
    }, 1000);
  };

  const handleChange = (newContent: string) => {
    // Don't save until we've loaded the initial content from the server
    // This prevents overwriting files with empty content on file switch
    if (!hasLoadedRef.current) return;
    setContent(newContent);
    setIsDirty(true);
    scheduleSave(newContent);
  };

  const handleHistoryVersionSelect = (newContent: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    setContent(newContent);
    setIsDirty(false);
    lastHeroActionRef.current = null;
  };

  handleChangeRef.current = handleChange;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background shrink-0 whitespace-nowrap">
        <div className="flex items-center gap-3 min-w-0 pl-2.5 lg:pl-0">
          <h2 className="text-sm font-medium text-foreground truncate">
            {data?.title || filePath}
          </h2>
          <SaveStatus
            isDirty={isDirty}
            isSaving={saveMutation.isPending}
            notionSyncStatus={notionSyncStatus}
          />
        </div>
        <div className="flex items-center gap-3">
          <PresenceAvatars viewers={viewers} />
          <WordCount count={countWords(contentWithoutFrontmatter)} />
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            <ModeButton
              icon={History}
              tooltip="History"
              isActive={mode === "history"}
              onClick={() => setMode("history")}
            />
            <ModeButton
              icon={Type}
              tooltip="Visual"
              isActive={mode === "visual"}
              onClick={() => setMode("visual")}
            />
            <ModeButton
              icon={Code}
              tooltip="Markdown"
              isActive={mode === "code"}
              onClick={() => setMode("code")}
            />
          </div>
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5 ml-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() =>
                    setActiveSidebar(
                      activeSidebar === "notion" ? null : "notion",
                    )
                  }
                  className={cn(
                    "flex items-center justify-center w-7 h-7 rounded-md transition-all",
                    activeSidebar === "notion"
                      ? "bg-background shadow-sm opacity-100"
                      : "opacity-60 hover:opacity-100 hover:bg-background/50",
                  )}
                >
                  <img
                    src="https://cdn.builder.io/api/v1/image/assets%2FYOUR_API_KEY%2F10a6768c5ce24792b6aedbfd1a2c95c8?format=webp&width=800&height=1200"
                    alt="Notion"
                    className="w-4 h-4 dark:invert"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Notion Sync
              </TooltipContent>
            </Tooltip>
            {isConnected && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() =>
                      setActiveSidebar(
                        activeSidebar === "builder" ? null : "builder",
                      )
                    }
                    className={cn(
                      "flex items-center justify-center w-7 h-7 rounded-md transition-all",
                      activeSidebar === "builder"
                        ? "bg-background shadow-sm opacity-100"
                        : "opacity-60 hover:opacity-100 hover:bg-background/50",
                    )}
                  >
                    <BuilderLogo size={14} className="text-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Builder.io Sync
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <ProjectActionsMenu projectSlug={projectSlug} />
        </div>
      </div>

      {/* Editor + upload sidebar */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0">
          {mode === "history" ? (
            <ProjectHistoryView
              projectSlug={projectSlug}
              filePath={filePath}
              embedded
              onClose={() => setMode("visual")}
              onSelectVersionContent={handleHistoryVersionSelect}
            />
          ) : mode === "visual" ? (
            <div className="h-full overflow-auto">
              <div className="max-w-3xl mx-auto px-6 py-8 lg:px-16">
                <HeroImagePicker
                  heroImage={heroImage}
                  onChange={handleHeroImageChange}
                  projectSlug={projectSlug}
                  articleContent={contentWithoutFrontmatter}
                />
                <VisualEditor
                  content={contentWithoutFrontmatter}
                  onChange={(md) => {
                    lastHeroActionRef.current = "body";
                    const full = frontmatterRef.current
                      ? frontmatterRef.current + md
                      : md;
                    handleChange(full);
                  }}
                  projectSlug={projectSlug}
                  filePath={filePath}
                />
              </div>
            </div>
          ) : (
            <MonacoMarkdownEditor content={content} onChange={handleChange} />
          )}
        </div>

        <div
          className={cn(
            "h-full border-border bg-background flex flex-col shrink-0 transition-[width] duration-200 overflow-hidden",
            activeSidebar ? "w-[340px] border-l" : "w-0 border-l-0",
          )}
        >
          {activeSidebar === "builder" && (
            <BuilderSidebar
              open={true}
              onOpenChange={(open) => setActiveSidebar(open ? "builder" : null)}
              markdown={content}
              onChange={handleChange}
              projectSlug={projectSlug}
              filePath={filePath}
              currentHeroImage={heroImage}
              onHeroImageChange={handleHeroImageChange}
              handle={handle}
              localUpdatedAt={data?.updatedAt}
            />
          )}

          <NotionSidebar
            open={activeSidebar === "notion"}
            onOpenChange={(open) => setActiveSidebar(open ? "notion" : null)}
            markdown={content}
            onChange={handleChange}
            projectSlug={projectSlug}
            filePath={filePath}
            localUpdatedAt={data?.updatedAt}
            onSyncStatusChange={setNotionSyncStatus}
          />
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  icon: Icon,
  tooltip,
  isActive,
  onClick,
}: {
  icon: React.ElementType;
  tooltip: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded-md transition-all",
            isActive
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function WordCount({ count }: { count: number }) {
  return (
    <span className="text-xs text-muted-foreground/60 tabular-nums whitespace-nowrap">
      {count.toLocaleString()} {count === 1 ? "word" : "words"}
    </span>
  );
}

function SaveStatus({
  isDirty,
  isSaving,
  notionSyncStatus = "idle",
}: {
  isDirty: boolean;
  isSaving: boolean;
  notionSyncStatus?: "idle" | "syncing" | "synced";
}) {
  if (notionSyncStatus === "syncing") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Syncing to Notion
      </span>
    );
  }
  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Saving
      </span>
    );
  }
  if (isDirty) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
        Editing
      </span>
    );
  }
  return null;
}
