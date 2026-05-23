import { IconChevronDown, IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface CodeWorkspaceRow {
  id: string;
  label: string;
  path: string;
}

interface WorkspacePickerProps {
  workspaces: CodeWorkspaceRow[];
  activeWorkspaceId: string | null;
  onWorkspaceChange: (id: string) => void;
  onAddWorkspace: () => void;
}

/**
 * Compact workspace selector at the top of the Code Room sidebar. Shows
 * the active workspace label + a dropdown listing every registered
 * workspace, plus an "Add workspace" footer that swaps the sidebar to
 * the settings panel.
 */
export function WorkspacePicker({
  workspaces,
  activeWorkspaceId,
  onWorkspaceChange,
  onAddWorkspace,
}: WorkspacePickerProps) {
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  return (
    <div className="border-b border-border px-2 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full cursor-pointer justify-between gap-1 px-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {active ? active.label : "Pick a workspace"}
            </span>
            <IconChevronDown size={14} aria-hidden className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No workspaces yet.
            </div>
          ) : (
            workspaces.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onClick={() => onWorkspaceChange(w.id)}
                className={cn(
                  "cursor-pointer flex-col items-start gap-0.5",
                  w.id === activeWorkspaceId && "bg-accent",
                )}
              >
                <span className="truncate text-sm font-medium">{w.label}</span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {w.path}
                </span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onAddWorkspace} className="cursor-pointer">
            <IconPlus size={14} aria-hidden />
            Add workspace…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {active ? (
        <p
          className="mt-1 truncate px-1 font-mono text-[10px] text-muted-foreground"
          title={active.path}
        >
          {active.path}
        </p>
      ) : null}
    </div>
  );
}
