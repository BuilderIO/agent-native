import { useState, useEffect } from "react";
import { useCreateFile } from "@/hooks/use-projects";
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

interface NewFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  parentPath?: string;
  type: "file" | "directory";
  onCreated: (path: string) => void;
}

export function NewFileDialog({
  open,
  onOpenChange,
  projectSlug,
  parentPath,
  type,
  onCreated,
}: NewFileDialogProps) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const createMutation = useCreateFile();

  const label = type === "directory" ? "folder" : "page";

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setName("");
      setIsCreating(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isCreating) return;

    // Support nested paths like "foo/bar" — split into parent dirs + final name
    let finalName = trimmed;
    let finalParent = parentPath;

    if (trimmed.includes("/")) {
      const parts = trimmed.split("/").filter(Boolean);
      finalName = parts.pop()!;
      if (parts.length > 0) {
        const extraPath = parts.join("/");
        finalParent = finalParent ? `${finalParent}/${extraPath}` : extraPath;
      }
    }

    setIsCreating(true);
    try {
      const result = await createMutation.mutateAsync({
        projectSlug,
        name: finalName,
        type,
        parentPath: finalParent,
      });
      setName("");
      setIsCreating(false);
      onCreated(result.path);
    } catch {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New {label}</DialogTitle>
            <DialogDescription>
              {type === "directory"
                ? "Create a new folder to organize your pages."
                : "Create a new markdown page. Use / to create nested folders (e.g. research/topic)."}
              {parentPath && (
                <span className="block mt-1 text-xs font-mono opacity-70">
                  in {parentPath}/
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              autoFocus
              placeholder={
                type === "directory"
                  ? "Folder name..."
                  : "Page title or path (e.g. notes/ideas)..."
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
              disabled={!name.trim() || isCreating}
            >
              {isCreating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
