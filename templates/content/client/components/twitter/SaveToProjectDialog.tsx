import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FolderPlus, FolderOpen } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { useSaveTwitterResults } from "@/hooks/use-twitter";
import type { TwitterTweet } from "@shared/api";

interface SaveToProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tweets: TwitterTweet[];
  query: string;
  onSaved?: (projectSlug: string) => void;
  defaultGroup?: string;
}

export function SaveToProjectDialog({
  open,
  onOpenChange,
  tweets,
  query,
  onSaved,
  defaultGroup,
}: SaveToProjectDialogProps) {
  const { data: projectsData } = useProjects();
  const save = useSaveTwitterResults();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedProject, setSelectedProject] = useState("");
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState("");

  const projects = projectsData?.projects ?? [];
  const groups = projectsData?.groups ?? [];

  const handleSave = () => {
    if (mode === "existing" && selectedProject) {
      save.mutate(
        { projectSlug: selectedProject, query, tweets },
        {
          onSuccess: (res) => {
            onOpenChange(false);
            onSaved?.(res.projectSlug);
          },
        },
      );
    } else if (mode === "new" && newName.trim()) {
      save.mutate(
        {
          newProjectName: newName.trim(),
          newProjectGroup: newGroup || defaultGroup || groups[0] || "",
          query,
          tweets,
        },
        {
          onSuccess: (res) => {
            onOpenChange(false);
            onSaved?.(res.projectSlug);
          },
        },
      );
    }
  };

  const canSave =
    (mode === "existing" && selectedProject) ||
    (mode === "new" && newName.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save Twitter Research</DialogTitle>
          <DialogDescription>
            Save {tweets.length} tweet{tweets.length !== 1 ? "s" : ""} from "
            {query}" to a project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setMode("existing")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                mode === "existing"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              <FolderOpen size={13} />
              Existing Project
            </button>
            <button
              onClick={() => setMode("new")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                mode === "new"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              <FolderPlus size={13} />
              New Project
            </button>
          </div>

          {mode === "existing" ? (
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger>
                <SelectValue placeholder="Select a project..." />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="space-y-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name..."
              />
              {groups.length > 1 && (
                <Select
                  value={newGroup || defaultGroup || groups[0]}
                  onValueChange={setNewGroup}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || save.isPending}>
            {save.isPending && (
              <Loader2 size={14} className="animate-spin mr-1.5" />
            )}
            Save to Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
