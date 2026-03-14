import { useState, useCallback } from "react";
import {
  BookOpen,
  Plus,
  FileText,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResearch, useSaveResearch } from "@/hooks/use-research";
import type { ResearchArticle, ResearchData } from "@shared/api";
import { ArticleCard } from "./ArticleCard";
import { ThemesSection } from "./ThemesSection";
import { AddArticleDialog } from "./AddArticleDialog";

interface ResearchPanelProps {
  projectSlug: string;
  projectName: string;
}

export function ResearchPanel({ projectSlug, projectName }: ResearchPanelProps) {
  const { data: research, isLoading } = useResearch(projectSlug);
  const saveResearch = useSaveResearch(projectSlug);
  const [showAddArticle, setShowAddArticle] = useState(false);

  const getOrCreateResearch = useCallback((): ResearchData => {
    return (
      research ?? {
        topic: projectName,
        updatedAt: new Date().toISOString(),
        articles: [],
        themes: [],
      }
    );
  }, [research, projectName]);

  const handleAddArticle = useCallback(
    (article: ResearchArticle) => {
      const current = getOrCreateResearch();
      saveResearch.mutate({
        ...current,
        articles: [...current.articles, article],
      });
    },
    [getOrCreateResearch, saveResearch]
  );

  const handleDeleteArticle = useCallback(
    (id: string) => {
      const current = getOrCreateResearch();
      saveResearch.mutate({
        ...current,
        articles: current.articles.filter((a) => a.id !== id),
      });
    },
    [getOrCreateResearch, saveResearch]
  );

  const handleThemesChange = useCallback(
    (themes: string[]) => {
      const current = getOrCreateResearch();
      saveResearch.mutate({ ...current, themes });
    },
    [getOrCreateResearch, saveResearch]
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const articles = research?.articles ?? [];
  const themes = research?.themes ?? [];
  const hasContent = articles.length > 0 || themes.length > 0;

  return (
    <div className="flex-1 flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <BookOpen size={16} className="text-muted-foreground" />
          <h1 className="text-sm font-semibold text-foreground">Research</h1>
          <span className="text-xs text-muted-foreground">
            — {projectName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saveResearch.isPending && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" />
              Saving
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddArticle(true)}
            className="h-7 text-xs gap-1.5"
          >
            <Plus size={13} />
            Add Article
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {hasContent ? (
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
            {/* Stats bar */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground pb-2">
              <span>{articles.length} articles</span>
              <span>{themes.length} themes</span>
              {research?.updatedAt && (
                <span>
                  Updated{" "}
                  {new Date(research.updatedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>

            {/* Articles */}
            <div className="space-y-3">
              {articles.map((article, i) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  index={i}
                  onDelete={handleDeleteArticle}
                />
              ))}
            </div>

            {/* Themes */}
            {(themes.length > 0 || articles.length > 0) && (
              <div className="pt-2">
                <ThemesSection
                  themes={themes}
                  onChange={handleThemesChange}
                />
              </div>
            )}
          </div>
        ) : (
          <EmptyResearchState onAddArticle={() => setShowAddArticle(true)} />
        )}
      </div>

      <AddArticleDialog
        open={showAddArticle}
        onOpenChange={setShowAddArticle}
        onAdd={handleAddArticle}
      />
    </div>
  );
}

function EmptyResearchState({
  onAddArticle,
}: {
  onAddArticle: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <FileText size={32} className="mb-3 opacity-30" />
      <p className="text-sm font-medium mb-1">No research yet</p>
      <p className="text-xs mb-4 text-center max-w-xs">
        Add top articles, note why they matter, and capture key insights for
        this project.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onAddArticle}
        className="gap-1.5"
      >
        <Plus size={14} />
        Add First Article
      </Button>
    </div>
  );
}
