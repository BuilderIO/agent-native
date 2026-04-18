import { useMemo, useState } from "react";
import {
  IconChevronDown,
  IconCheck,
  IconPlus,
  IconBuilding,
} from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface WorkspaceItem {
  id: string;
  name: string;
  brandColor?: string | null;
}

interface WorkspaceSwitcherProps {
  className?: string;
  compact?: boolean;
}

interface WorkspaceStateResponse {
  workspaces?: WorkspaceItem[];
  currentId?: string | null;
  currentWorkspace?: WorkspaceItem | null;
}

export function WorkspaceSwitcher({
  className,
  compact,
}: WorkspaceSwitcherProps) {
  const qc = useQueryClient();
  const { data } = useActionQuery<WorkspaceStateResponse>(
    "list-workspace-state",
    undefined,
    {},
  );

  const workspaces: WorkspaceItem[] = data?.workspaces ?? [];
  const currentId =
    data?.currentId ?? data?.currentWorkspace?.id ?? workspaces[0]?.id ?? null;
  const current = useMemo(
    () => workspaces.find((w) => w.id === currentId) ?? workspaces[0] ?? null,
    [workspaces, currentId],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const setCurrent = useActionMutation<any, { id: string }>(
    "set-current-workspace",
  );
  const createWorkspace = useActionMutation<any, { name: string }>(
    "create-workspace",
  );

  async function handleSelect(id: string) {
    if (id === currentId) return;
    try {
      await setCurrent.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: ["action", "list-workspace-state"] });
      qc.invalidateQueries({ queryKey: ["action", "list-calls"] });
      toast.success("Switched workspace");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Switch failed");
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await createWorkspace.mutateAsync({ name });
      toast.success(`Created workspace "${name}"`);
      qc.invalidateQueries({ queryKey: ["action", "list-workspace-state"] });
      setCreateOpen(false);
      setNewName("");
      if (res?.id) {
        await setCurrent.mutateAsync({ id: res.id }).catch(() => {});
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left",
              "hover:bg-accent",
              className,
            )}
          >
            <div
              className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-semibold text-background shrink-0"
              style={{ background: current?.brandColor ?? "hsl(var(--foreground))" }}
            >
              {(current?.name ?? "W").slice(0, 1).toUpperCase()}
            </div>
            {!compact && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-foreground truncate">
                  {current?.name ?? "No workspace"}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {workspaces.length} workspace
                  {workspaces.length === 1 ? "" : "s"}
                </div>
              </div>
            )}
            <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.length === 0 && (
            <DropdownMenuItem disabled>
              <IconBuilding className="h-3.5 w-3.5 mr-2" />
              <span className="text-xs">No workspaces yet</span>
            </DropdownMenuItem>
          )}
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => handleSelect(w.id)}
              className="flex items-center"
            >
              <div
                className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold text-background mr-2"
                style={{ background: w.brandColor ?? "hsl(var(--foreground))" }}
              >
                {w.name.slice(0, 1).toUpperCase()}
              </div>
              <span className="flex-1 truncate text-xs">{w.name}</span>
              {w.id === currentId && <IconCheck className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <IconPlus className="h-3.5 w-3.5 mr-2" />
            <span className="text-xs">New workspace</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={createOpen} onOpenChange={setCreateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create workspace</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Workspace name"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreate}>Create</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
