import { useState, useEffect } from "react";
import { BuilderSyncPanel } from "./BuilderSyncPanel";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileContent, useSaveFile, useProjects } from "@/hooks/use-projects";

interface BuilderSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  markdown: string;
  onChange: (newMarkdown: string) => void;
  projectSlug: string;
  filePath: string;
  currentHeroImage?: string | null;
  onHeroImageChange?: (url: string | null) => void;
  handle: string;
  localUpdatedAt?: string;
}

export function BuilderSidebar({
  open,
  onOpenChange,
  markdown,
  onChange,
  projectSlug,
  filePath,
  currentHeroImage,
  onHeroImageChange,
  handle,
  localUpdatedAt
}: BuilderSidebarProps) {
  const { data: projectsData } = useProjects();
  const projectMeta = projectsData?.projects.find(p => p.slug === projectSlug);
  const activeDraft = projectMeta?.activeDraft || "draft.md";

  const isEditingDraft = filePath === activeDraft;
  const { data: draftData, isLoading: isDraftLoading, isError: isDraftError } = useFileContent(projectSlug, activeDraft);
  const saveMutation = useSaveFile();

  const [draftContentState, setDraftContentState] = useState("");

  useEffect(() => {
    if (draftData?.content && !isEditingDraft) {
      setDraftContentState(draftData.content);
    }
  }, [draftData?.content, isEditingDraft]);

  const metadataMarkdown = isEditingDraft ? markdown : (draftContentState || draftData?.content || "");
  const isReady = isEditingDraft || (!isDraftLoading && (draftData || isDraftError));

  const handleMetadataMarkdownChange = (newMetadataMarkdown: string) => {
    if (isEditingDraft) {
      onChange(newMetadataMarkdown);
    } else {
      setDraftContentState(newMetadataMarkdown);
      saveMutation.mutate({
        projectSlug,
        filePath: activeDraft,
        content: newMetadataMarkdown,
      });
    }
  };

  if (!open) return null;

  return (
    <div className="flex flex-col h-full bg-background w-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0 bg-muted/30">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 256 293" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 0H256V73.1429H0V0Z" fill="currentColor"/>
                <path d="M0 109.714H182.857V182.857H0V109.714Z" fill="currentColor"/>
                <path d="M0 219.429H109.714V292.571H0V219.429Z" fill="currentColor"/>
              </svg>
              Builder.io
            </h3>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            {isReady ? (
              <BuilderSyncPanel
                markdown={markdown}
                onChange={onChange}
                metadataMarkdown={metadataMarkdown}
                onMetadataMarkdownChange={handleMetadataMarkdownChange}
                projectSlug={projectSlug}
                currentHeroImage={currentHeroImage}
                onHeroImageChange={onHeroImageChange}
                handle={handle}
                localUpdatedAt={localUpdatedAt}
                embedded={true}
                isEditingDraft={isEditingDraft}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <span className="text-sm text-muted-foreground">Loading metadata...</span>
              </div>
            )}
          </div>
    </div>
  );
}
