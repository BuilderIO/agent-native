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
  childrenAfterActions?: ReactNode;
}

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
