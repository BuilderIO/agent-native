import { Globe, FolderOpen, Lock, Check } from "lucide-react";
import { useProjects, useMoveProject } from "@/hooks/use-projects";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Project } from "@shared/api";

interface MoveProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onMoved: (newSlug: string) => void;
}

function formatLabel(slug: string) {
  if (slug === "private") return "Private";
  if (slug === "shared") return "Shared";
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function getIcon(slug: string) {
  if (slug === "shared") return <Globe size={14} className="shrink-0 text-sidebar-primary" />;
  if (slug === "private") return <Lock size={14} className="shrink-0 text-muted-foreground" />;
  return <FolderOpen size={14} className="shrink-0" />;
}

export function MoveProjectDialog({
  open,
  onOpenChange,
  project,
  onMoved,
}: MoveProjectDialogProps) {
  const { data } = useProjects();
  const moveProject = useMoveProject();
  const groups = data?.groups ?? [];

  const currentGroup = project.group || (project.slug.includes("/") ? project.slug.split("/")[0] : undefined);

  // Build ordered workspace list: private, shared, then others
  const orderedGroups = [
    ...groups.filter((g) => g === "private"),
    ...groups.filter((g) => g === "shared"),
    ...groups.filter((g) => g !== "shared" && g !== "private"),
  ];

  const handleMove = (targetGroup: string) => {
    if (targetGroup === currentGroup) return;

    moveProject.mutate(
      { slug: project.slug, group: targetGroup },
      {
        onSuccess: (data) => {
          onOpenChange(false);
          if (data?.slug) {
            onMoved(data.slug);
          }
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="text-sm">Move "{project.name}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-0.5 py-1">
          {orderedGroups.map((group) => {
            const isCurrent = group === currentGroup;
            return (
              <button
                key={group}
                onClick={() => handleMove(group)}
                disabled={isCurrent || moveProject.isPending}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-[13px] transition-colors disabled:opacity-50 hover:bg-accent disabled:hover:bg-transparent"
              >
                {getIcon(group)}
                <span className="flex-1 text-left truncate">{formatLabel(group)}</span>
                {isCurrent && <Check size={14} className="text-muted-foreground shrink-0" />}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
