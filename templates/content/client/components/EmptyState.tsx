import { PenLine, FolderOpen, BookOpen } from "lucide-react";

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
          {hasProject ? "Select a file to edit" : "Welcome to Content Workspace"}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-8">
          {hasProject
            ? "Pick a file from the sidebar to start writing, or create a new file in your project."
            : "Create a project to start writing. Each project has a draft for your blog post and a place for research resources."}
        </p>
        <div className="flex items-center justify-center gap-6 text-muted-foreground">
          <div className="flex items-center gap-2 text-xs">
            <FolderOpen size={13} />
            <span>Projects for blog posts</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <BookOpen size={13} />
            <span>Resources for research</span>
          </div>
        </div>
      </div>
    </div>
  );
}
