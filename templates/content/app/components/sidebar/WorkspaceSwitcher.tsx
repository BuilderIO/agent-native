import { useState } from "react";
import { ChevronsUpDown, Plus, FolderOpen, Globe, Lock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Label } from "@/components/ui/label";
import { useCreateProjectGroup } from "@/hooks/use-projects";

interface WorkspaceSwitcherProps {
  workspaces: string[];
  selected: string | null;
  onSelect: (workspace: string) => void;
}

function formatLabel(slug: string) {
  if (slug === "private") return "Private";
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function getWorkspaceIcon(slug: string) {
  if (slug === "shared") return <Globe className="size-4" />;
  if (slug === "private") return <Lock className="size-4" />;
  return <FolderOpen className="size-4" />;
}

export function WorkspaceSwitcher({
  workspaces,
  selected,
  onSelect,
}: WorkspaceSwitcherProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const createWorkspace = useCreateProjectGroup();

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const result = await createWorkspace.mutateAsync({ name });
      onSelect(result.group);
      setDialogOpen(false);
      setNewName("");
    } catch {
      // Error handled by mutation
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 -mx-1 text-left hover:bg-sidebar-accent transition-colors">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-foreground">
              {getWorkspaceIcon(selected ?? "")}
            </div>
            <div className="flex flex-col gap-0.5 leading-none flex-1 min-w-0">
              <span className="font-semibold text-sm truncate">
                {selected ? formatLabel(selected) : "Select workspace"}
              </span>
              <span className="text-xs text-sidebar-foreground/60">
                Workspace
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 shrink-0 text-sidebar-foreground/60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[--radix-dropdown-menu-trigger-width]"
          align="start"
        >
          {/* Show private first, then shared, then others */}
          {["private", "shared"].map((special) =>
            workspaces
              .filter((ws) => ws === special)
              .map((ws) => (
                <DropdownMenuItem
                  key={ws}
                  onSelect={() => onSelect(ws)}
                  className={ws === selected ? "bg-accent" : ""}
                >
                  {ws === "shared" ? (
                    <Globe className="mr-2 size-4" />
                  ) : (
                    <Lock className="mr-2 size-4" />
                  )}
                  {formatLabel(ws)}
                </DropdownMenuItem>
              )),
          )}
          {workspaces
            .filter((ws) => ws !== "shared" && ws !== "private")
            .map((ws) => (
              <DropdownMenuItem
                key={ws}
                onSelect={() => onSelect(ws)}
                className={ws === selected ? "bg-accent" : ""}
              >
                <FolderOpen className="mr-2 size-4" />
                {formatLabel(ws)}
              </DropdownMenuItem>
            ))}
          {workspaces.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" />
            New Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
            <DialogDescription>
              A workspace groups related projects together.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                placeholder="e.g. vishwas"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createWorkspace.isPending}
            >
              {createWorkspace.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
