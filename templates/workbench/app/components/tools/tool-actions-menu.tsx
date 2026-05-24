import { useState } from "react";
import {
  IconDotsVertical,
  IconExternalLink,
  IconLoader2,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { sendToAgentChat } from "@agent-native/core/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ToolActionsMenuTarget {
  id: string;
  name: string;
  /** When the user is not the owner, the framework returns canDelete=false
   *  and DELETE falls back to hiding the tool from this user's list. We use
   *  that signal to swap the confirm copy ("Remove" vs "Delete"). */
  canDelete?: boolean | null;
}

interface ToolActionsMenuProps {
  tool: ToolActionsMenuTarget;
  /** Called when the user confirms delete. Should perform optimistic removal
   *  + network call; throw to roll back via toast. */
  onDelete: () => Promise<void> | void;
  /** Optional: render an "Open in new tab" affordance. The detail page
   *  passes the canonical URL so the menu can deep-link out to the bare
   *  iframe view. */
  openInNewTabHref?: string;
  /** Compact variant used inside list cards: smaller hit area, no label. */
  variant?: "compact" | "default";
  /** Called when the menu/dialog open state changes — used by the detail
   *  page to disable iframe pointer-events while overlays are open. */
  onOverlayOpenChange?: (open: boolean) => void;
}

/**
 * Overflow action menu for a Custom Tool. Renders the `Edit`, `Delete`, and
 * (optionally) `Open in new tab` actions. `Share` is rendered separately as
 * its own toolbar button using the framework `ShareButton` so it gets the
 * standard popover layout.
 *
 * Edit delegates to the agent chat — extensions are only editable via the
 * agent (see the `extensions` skill), so the click opens the agent sidebar
 * with a pre-filled `update-extension` prompt.
 *
 * Delete confirms in a shadcn `AlertDialog`, then calls `onDelete()`. The
 * dialog is the right primitive here because deletion is irreversible —
 * a popover confirm is too low-friction for a destructive action.
 */
export function ToolActionsMenu({
  tool,
  onDelete,
  openInNewTabHref,
  variant = "default",
  onOverlayOpenChange,
}: ToolActionsMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Compose overlay-open state across the menu and the confirm dialog so the
  // detail page can disable iframe pointer-events for the whole window during
  // which an overlay is on top of the iframe.
  const notify = (next: boolean) => {
    onOverlayOpenChange?.(next);
  };

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    notify(open || confirmDeleteOpen);
  };

  const handleConfirmOpenChange = (open: boolean) => {
    setConfirmDeleteOpen(open);
    notify(open || menuOpen);
  };

  const handleEdit = () => {
    setMenuOpen(false);
    sendToAgentChat({
      message: `Update this Custom Tool: "${tool.name}" (${tool.id}). `,
      context: [
        `The user is viewing the Custom Tool "${tool.name}" (id: ${tool.id}) inside Workbench and wants to edit it.`,
        "This is an existing sandboxed Alpine.js extension stored in SQL. Call list-extensions / get-extension / update-extension for this extension id.",
        "Do not route this to a source-code change flow — there is no React/route component to edit, only the extension HTML.",
      ].join("\n"),
      submit: false,
      openSidebar: true,
    });
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
      setConfirmDeleteOpen(false);
      notify(menuOpen);
    } finally {
      setDeleting(false);
    }
  };

  const destructiveCopy =
    tool.canDelete === false
      ? {
          title: "Remove from your list",
          description: (
            <>
              This hides{" "}
              <span className="font-medium text-foreground">{tool.name}</span>{" "}
              from your Custom Tools list. It will still be available to anyone
              else it's shared with.
            </>
          ),
          actionLabel: deleting ? "Removing…" : "Remove",
          menuLabel: "Remove from my list",
        }
      : {
          title: `Delete "${tool.name}"?`,
          description: (
            <>
              This removes{" "}
              <span className="font-medium text-foreground">{tool.name}</span>{" "}
              everywhere it's shared. This cannot be undone.
            </>
          ),
          actionLabel: deleting ? "Deleting…" : "Delete",
          menuLabel: "Delete tool",
        };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Options for ${tool.name}`}
            className={cn(
              "inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
              variant === "compact" ? "h-8 w-8" : "h-9 w-9",
            )}
          >
            <IconDotsVertical
              size={variant === "compact" ? 14 : 16}
              aria-hidden
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-52">
          <DropdownMenuItem onSelect={handleEdit}>
            <IconPencil size={14} aria-hidden />
            Edit with agent
          </DropdownMenuItem>
          {openInNewTabHref ? (
            <DropdownMenuItem asChild>
              <a
                href={openInNewTabHref}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center gap-2"
              >
                <IconExternalLink size={14} aria-hidden />
                Open in new tab
              </a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              setConfirmDeleteOpen(true);
              notify(true);
            }}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <IconTrash size={14} aria-hidden />
            {destructiveCopy.menuLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={handleConfirmOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{destructiveCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {destructiveCopy.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              className={cn(
                "cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
            >
              {deleting ? (
                <>
                  <IconLoader2 className="size-4 animate-spin" />
                  {destructiveCopy.actionLabel}
                </>
              ) : (
                <>
                  <IconTrash size={14} />
                  {destructiveCopy.actionLabel}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Convenience for callsites that want the Button shape to match the rest of
// Workbench's room headers. Kept here so the import surface is one file.
export { Button as ToolHeaderButton };
