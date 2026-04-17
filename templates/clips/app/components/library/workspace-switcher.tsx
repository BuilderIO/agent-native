import { useMemo, useState } from "react";
import {
  IconChevronDown,
  IconCheck,
  IconPlus,
  IconBuilding,
} from "@tabler/icons-react";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { sendToAgentChat } from "@agent-native/core/client";

export interface WorkspaceData {
  id: string;
  name: string;
  brandColor?: string;
}

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceData[];
  currentId?: string | null;
  onChange?: (id: string) => void;
  onCreate?: (name: string) => void;
  className?: string;
}

export function WorkspaceSwitcher({
  workspaces,
  currentId,
  onChange,
  onCreate,
  className,
}: WorkspaceSwitcherProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const current = useMemo(
    () => workspaces.find((w) => w.id === currentId) ?? workspaces[0],
    [workspaces, currentId],
  );

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
              className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-semibold text-white shrink-0"
              style={{ background: current?.brandColor ?? "#625DF5" }}
            >
              {(current?.name ?? "W").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground truncate">
                {current?.name ?? "No workspace"}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {workspaces.length} workspace
                {workspaces.length === 1 ? "" : "s"}
              </div>
            </div>
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
              onSelect={() => onChange?.(w.id)}
              className="flex items-center"
            >
              <div
                className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold text-white mr-2"
                style={{ background: w.brandColor ?? "#625DF5" }}
              >
                {w.name.slice(0, 1).toUpperCase()}
              </div>
              <span className="flex-1 truncate text-xs">{w.name}</span>
              {w.id === currentId && (
                <IconCheck className="h-3.5 w-3.5 text-[#625DF5]" />
              )}
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
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Workspace name"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#625DF5]/30"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const name = newName.trim();
                if (!name) return;
                if (onCreate) {
                  onCreate(name);
                } else {
                  // Fall through — delegate to the agent so it can wire workspace
                  // creation (Workspace team owns that action).
                  sendToAgentChat({
                    message: `Create a workspace called "${name}"`,
                  });
                  toast.info(
                    "Asking the agent to create that workspace for you.",
                  );
                }
                setCreateOpen(false);
                setNewName("");
              }}
            >
              Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
