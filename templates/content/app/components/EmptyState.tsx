import { PenLine, FileText, BookOpen } from "lucide-react";

interface EmptyStateProps {
  hasProject: boolean;
}

export function EmptyState({ hasProject }: EmptyStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-background pl-12 lg:pl-0">
      <div className="text-center max-w-md px-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-muted mb-6">
          <PenLine size={24} className="text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          {hasProject
            ? "Select a page to edit"
            : "Welcome to Content Workspace"}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-8">
          {hasProject
            ? "Pick a page from the sidebar to start writing, or create a new subpage."
            : "Create a page to start writing. Each page can have subpages for organizing your content."}
        </p>
        <div className="flex items-center justify-center gap-6 text-muted-foreground">
          <div className="flex items-center gap-2 text-xs">
            <FileText size={13} />
            <span>Pages for your content</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <BookOpen size={13} />
            <span>Subpages for details</span>
          </div>
        </div>
      </div>
    </div>
  );
}
