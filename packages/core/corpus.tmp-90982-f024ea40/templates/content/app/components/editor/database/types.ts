// Shared types and constants for the database module.
import type {
  ContentDatabaseColumnCalculation,
  ContentDatabaseFilter,
  ContentDatabaseFilterMode,
  ContentDatabaseFilterOperator,
  ContentDatabaseItem,
  ContentDatabaseOpenPagesIn,
  ContentDatabaseRowDensity,
  ContentDatabaseSort,
  ContentDatabaseSortDirection,
  ContentDatabaseViewType,
  DocumentProperty,
  DocumentPropertyType,
  DocumentPropertyValue,
} from "@shared/api";

// Re-exported type aliases used across modules and by consumers.
export type SortDirection = ContentDatabaseSortDirection;
export type DatabaseSort = ContentDatabaseSort;
export type FilterOperator = ContentDatabaseFilterOperator;
export type DatabaseFilter = ContentDatabaseFilter;
export type DatabaseFilterMode = ContentDatabaseFilterMode;
export type DatabaseColumnCalculation = ContentDatabaseColumnCalculation;
export type DatabaseRowDensity = ContentDatabaseRowDensity;
export type ColumnKey = "name" | string;

// Column dimension constants (used by views, grid, and table modules).
export const DEFAULT_NAME_COLUMN_WIDTH = 240;
export const DEFAULT_PROPERTY_COLUMN_WIDTH = 180;
export const MIN_COLUMN_WIDTH = 96;
export const MAX_COLUMN_WIDTH = 640;
export const ACTION_COLUMN_WIDTH = 48;
export const EMPTY_DEFAULT_ADD_PROPERTY_COLUMN_WIDTH = 220;
export const EMPTY_DEFAULT_BLANK_ROW_COUNT = 5;
export const DATABASE_DRAG_THRESHOLD = 6;

export const DATABASE_VIEW_TYPES: ContentDatabaseViewType[] = [
  "table",
  "board",
  "gallery",
  "list",
  "timeline",
  "calendar",
];

export const DATABASE_OPEN_PAGES_IN: ContentDatabaseOpenPagesIn[] = [
  "preview",
  "full_page",
];

export const DATABASE_FILTER_MODES: DatabaseFilterMode[] = ["and", "or"];

// Handler type used by all "new row/card" components.
export type CreateDatabaseRowHandler = (
  title?: string,
) => Promise<ContentDatabaseItem | null>;

// Drag preview overlay state.
export type DatabaseDragPreviewState =
  | {
      kind: "view";
      label: string;
      type: ContentDatabaseViewType;
      x: number;
      y: number;
      width: number;
    }
  | {
      kind: "property";
      label: string;
      type: DocumentPropertyType;
      x: number;
      y: number;
      width: number;
    };

// Drop target helpers.
export type DatabaseDropSide = "before" | "after";
export type DatabaseDropTargetState = {
  id: string;
  side: DatabaseDropSide;
};

// Settings panel navigation.
export type DatabaseSettingsPanel =
  | "main"
  | "layout"
  | "property_visibility"
  | "group";

// Property picker option used by sort/filter/group pickers.
export type DatabasePropertyPickerOption = {
  key: string;
  label: string;
  type: DocumentPropertyType | "name";
};

// Preview neighbor direction.
export type DatabasePreviewNeighborDirection = "prev" | "next";

// View move direction.
export type DatabaseViewMoveDirection = "left" | "right";

// Property move direction.
export type DatabasePropertyMoveDirection = "left" | "right";

// Condition (sort/filter) move direction.
export type DatabaseConditionMoveDirection = "up" | "down";

// Quick-filter operators (subset of FilterOperator).
export type DatabaseQuickFilterOperator = Extract<
  FilterOperator,
  "is_empty" | "is_not_empty" | "is_checked" | "is_unchecked"
>;

// Board group structure (exported to consumers via DocumentDatabase.tsx).
export const BOARD_UNGROUPED_VALUE = "__ungrouped__";

export interface DatabaseBoardGroup {
  id: string;
  label: string;
  property: DocumentProperty | null;
  value: DocumentPropertyValue | typeof BOARD_UNGROUPED_VALUE;
  items: ContentDatabaseItem[];
}

export interface DatabaseTimelineSpan {
  item: ContentDatabaseItem;
  startKey: string;
  endKey: string;
  label: string;
  startIndex: number;
  endIndex: number;
}

export interface DatabaseDateViewRange {
  start: string;
  end: string;
  label: string;
}
