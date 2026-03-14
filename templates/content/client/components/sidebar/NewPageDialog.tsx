import { useEffect, useState } from "react";
import { useCreateProject, useProjects } from "@/hooks/use-projects";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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

interface NewPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
  defaultGroup?: string | null;
}

const formatGroupLabel = (slug: string) =>
  slug
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

export function NewPageDialog({
  open,
  onOpenChange,
  onCreated,
  defaultGroup,
}: NewPageDialogProps) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState<string | undefined>(undefined);

  const { data } = useProjects();
  const createMutation = useCreateProject();

  const groups = data?.groups ?? [];
  const showWorkspaceSelect = groups.length > 0 && !defaultGroup;

  useEffect(() => {
    if (!open) return;
    setName("");
    if (defaultGroup) {
      setGroup(defaultGroup);
    } else if (!group && groups.length > 0) {
      setGroup(groups[0]);
    }
  }, [open, defaultGroup, groups, group]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const result = await createMutation.mutateAsync({
      name: name.trim(),
      group,
    });
    setName("");
    onCreated(result.slug);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Page</DialogTitle>
            <DialogDescription>
              Create a new page for your content.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {showWorkspaceSelect && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Workspace
                </label>
                <Select value={group?.split("/")[0] || ""} onValueChange={(ws) => setGroup(ws)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((groupName) => (
                      <SelectItem key={groupName} value={groupName}>
                        {formatGroupLabel(groupName)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Folder path within workspace (optional) */}
            {group && data?.folders?.[group.split("/")[0]]?.length ? (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Folder (optional)
                </label>
                <Select
                  value={group.includes("/") ? group : "__root__"}
                  onValueChange={(v) => {
                    const ws = group.split("/")[0];
                    setGroup(v === "__root__" ? ws : `${ws}/${v}`);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Root" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__root__">Root</SelectItem>
                    {data.folders[group.split("/")[0]].map((folderPath) => (
                      <SelectItem key={folderPath} value={folderPath}>
                        {folderPath.split("/").map(s =>
                          s.split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ")
                        ).join(" / ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Page Title
              </label>
              <Input
                autoFocus
                placeholder="My new page..."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
