import { IconCode } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

interface CodeEmptyStateProps {
  onAddWorkspace: () => void;
}

/**
 * Rendered in the Code Room when the user has no registered workspaces.
 * The CTA flips the activity bar to "Settings" so the workspace
 * manager is in view immediately.
 */
export function CodeEmptyState({ onAddWorkspace }: CodeEmptyStateProps) {
  return (
    <div className="mx-auto flex h-full w-full max-w-xl items-center justify-center px-6 py-10">
      <EmptyState
        icon={IconCode}
        title="Add a workspace to get started"
        description="Point Workbench at a local directory and we'll show its file tree, diffs, and changes here. You can edit and open PRs without leaving the room."
        action={
          <Button onClick={onAddWorkspace} className="cursor-pointer">
            Add workspace
          </Button>
        }
      />
    </div>
  );
}
