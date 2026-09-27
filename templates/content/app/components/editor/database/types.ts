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

export type SortDirection = ContentDatabaseSortDirection;
export type DatabaseSort = ContentDatabaseSort;
export type FilterOperator = ContentDatabaseFilterOperator;
export type DatabaseFilter = ContentDatabaseFilter;
export type DatabaseFilterMode = ContentDatabaseFilterMode;
export type DatabaseColumnCalculation = ContentDatabaseColumnCalculation;
export type DatabaseRowDensity = ContentDatabaseRowDensity;
export type ColumnKey = "name" | (string & {});

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
  "sidebar",
];

export const DATABASE_OPEN_PAGES_IN: ContentDatabaseOpenPagesIn[] = [
  "preview",
  "full_page",
];

export const DATABASE_FILTER_MODES: DatabaseFilterMode[] = ["and", "or"];

export type CreateDatabaseRowHandler = (
  title?: string,
) => Promise<ContentDatabaseItem | null>;

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

export type DatabaseDropSide = "before" | "after";
export type DatabaseDropTargetState = {
  id: string;
  side: DatabaseDropSide;
};

export type DatabaseSettingsPanel =
  | "main"
  | "layout"
  | "property_visibility"
  | "group";

export type DatabasePropertyPickerOption = {
  key: string;
  label: string;
  type: DocumentPropertyType | "name";
};

export type DatabasePreviewNeighborDirection = "prev" | "next";

export type DatabaseViewMoveDirection = "left" | "right";

export type DatabasePropertyMoveDirection = "left" | "right";

export type DatabaseConditionMoveDirection = "up" | "down";

export type DatabaseQuickFilterOperator = Extract<
  FilterOperator,
  "is_empty" | "is_not_empty" | "is_checked" | "is_unchecked"
>;

export const BOARD_UNGROUPED_VALUE = "__ungrouped__";

export interface DatabaseBoardGroup {
  id: string;
  label: string;
  property: DocumentProperty | null;
  value: DocumentPropertyValue;
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
