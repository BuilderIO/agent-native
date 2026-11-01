import { useT } from "@agent-native/core/client/i18n";
import { createContext, useContext, type ReactNode } from "react";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export interface DatabaseColumnPresentationValue {
  wrapCells: boolean;
  columnWrapOverrides: Record<string, boolean>;
  frozenThroughColumnId?: string | null;
  onWrapColumn: (id: string, wrapped: boolean) => void;
  onFreezeThrough: (id: string | null) => void;
  canEdit: boolean;
  renderColumnActions?: (columnId: string) => ReactNode;
}

export const DatabaseColumnPresentation =
  createContext<DatabaseColumnPresentationValue | null>(null);

export function useDatabaseColumnPresentation() {
  return useContext(DatabaseColumnPresentation);
}

export function databaseColumnWraps(
  presentation: Pick<
    DatabaseColumnPresentationValue,
    "wrapCells" | "columnWrapOverrides"
  >,
  columnId: string,
) {
  return presentation.columnWrapOverrides[columnId] ?? presentation.wrapCells;
}

export function ColumnPresentationMenuItems({
  columnId,
}: {
  columnId: string;
}) {
  const t = useT();
  const presentation = useDatabaseColumnPresentation();
  if (!presentation) return null;

  const wraps = databaseColumnWraps(presentation, columnId);

  return (
    <>
      {presentation.renderColumnActions?.(columnId)}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={!presentation.canEdit}
        onSelect={() => presentation.onFreezeThrough(columnId)}
      >
        {t("database.freezeThroughColumn")}
      </DropdownMenuItem>
      {presentation.frozenThroughColumnId !== null ? (
        <DropdownMenuItem
          disabled={!presentation.canEdit}
          onSelect={() => presentation.onFreezeThrough(null)}
        >
          {t("database.unfreezeColumns")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuCheckboxItem
        checked={wraps}
        disabled={!presentation.canEdit}
        onCheckedChange={(checked) =>
          presentation.onWrapColumn(columnId, checked === true)
        }
        onSelect={(event) => event.preventDefault()}
      >
        {t("database.wrapContent")}
      </DropdownMenuCheckboxItem>
    </>
  );
}
