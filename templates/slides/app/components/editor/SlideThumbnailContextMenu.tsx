import { useT } from "@agent-native/core/client/i18n";
import type { ReactElement, ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface SlideThumbnailContextMenuProps {
  children: ReactElement;
  canDelete?: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Optional extra items for the owning editor to add later. */
  childrenAfterActions?: ReactNode;
}

/**
 * Keep slide actions discoverable without removing the compact hover buttons.
 * The trigger stays the thumbnail itself, so a right-click works anywhere on
 * the preview and the menu remains usable with a keyboard once the thumbnail
 * has focus.
 */
export function SlideThumbnailContextMenu({
  children,
  canDelete = true,
  onSelect,
  onDuplicate,
  onDelete,
  childrenAfterActions,
}: SlideThumbnailContextMenuProps) {
  const t = useT();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onSelect}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onDuplicate}>
          {t("editorSidebar.duplicateSlide")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {childrenAfterActions}
        <ContextMenuItem
          disabled={!canDelete}
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          {t("editorSidebar.deleteSlide")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
