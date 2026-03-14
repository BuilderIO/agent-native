import { useState } from "react";
import { MoreHorizontal, ArrowRightLeft, Lock, LockOpen, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProjects, useUpdateProjectMeta, useDeleteProject } from "@/hooks/use-projects";
import { MoveProjectDialog } from "@/components/sidebar/MoveProjectDialog";

interface ProjectActionsMenuProps {
  projectSlug: string;
  onProjectDeleted?: () => void;
  onProjectMoved?: (newSlug: string) => void;
}

export function ProjectActionsMenu({
  projectSlug,
  onProjectDeleted,
  onProjectMoved,
}: ProjectActionsMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data } = useProjects();
  const updateMeta = useUpdateProjectMeta();
  const deleteProject = useDeleteProject();

  const project = data?.projects.find((p) => p.slug === projectSlug);
  const isOwner = true;

  const handleTogglePrivacy = () => {
    if (!project) return;
    updateMeta.mutate({
      slug: project.slug,
      isPrivate: !project.isPrivate,
      ownerId: currentUid,
    });
    setMenuOpen(false);
  };

  const handleDelete = () => {
    if (!project) return;
    setConfirmOpen(false);
    deleteProject.mutate(
      { slug: project.slug },
      { onSuccess: () => onProjectDeleted?.() }
    );
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center justify-center w-7 h-7 rounded-md opacity-60 hover:opacity-100 hover:bg-muted transition-all -ml-1.5 -mr-2.5"
                title="Project options"
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Project options
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-44">
          {project && (
            <>
              <DropdownMenuItem
                onClick={() => { setMenuOpen(false); setMoveOpen(true); }}
                className="gap-2"
              >
                <ArrowRightLeft size={13} className="shrink-0" />
                <span>Move to...</span>
              </DropdownMenuItem>
              {isOwner && (
                <DropdownMenuItem
                  onClick={handleTogglePrivacy}
                  disabled={updateMeta.isPending}
                  className="gap-2"
                >
                  {project.isPrivate ? (
                    <>
                      <LockOpen size={13} className="shrink-0" />
                      <span>Make Public</span>
                    </>
                  ) : (
                    <>
                      <Lock size={13} className="shrink-0" />
                      <span>Make Private</span>
                    </>
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onClick={() => { setMenuOpen(false); setConfirmOpen(true); }}
              >
                <Trash2 size={13} className="shrink-0" />
                <span>Delete</span>
              </DropdownMenuItem>
            </>
          )}
          {!project && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              Loading...
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {project && (
        <MoveProjectDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          project={project}
          onMoved={(newSlug) => onProjectMoved?.(newSlug)}
        />
      )}

      <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
        <PopoverTrigger asChild>
          <span className="sr-only" />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-56 p-3">
          <p className="text-sm font-medium mb-1">Delete project?</p>
          <p className="text-xs text-muted-foreground mb-3">
            This will permanently delete "{project?.name}" and all its contents.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs"
              onClick={handleDelete}
            >
              Delete
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
