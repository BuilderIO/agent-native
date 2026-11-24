import type { DocumentPropertyType } from "./properties.js";

export const COLUMN_FILL_PROPERTY_TYPES: readonly DocumentPropertyType[] = [
  "text",
  "number",
  "url",
  "select",
  "multi_select",
];

export const COLUMN_FILL_CONCURRENCY = 5;

export const COLUMN_FILL_MAX_CELLS = 500;

export const COLUMN_FILL_INSTRUCTION_MAX_LENGTH = 2_000;

export type ColumnFillStatus = "running" | "stopping" | "stopped" | "done";

export type ColumnFillCellStatus =
  | "waiting"
  | "running"
  | "filled"
  | "kept"
  | "failed"
  | "skipped";

export interface ColumnFillCell {
  documentId: string;
  status: ColumnFillCellStatus;
  agentThreadId: string | null;
  error: string | null;
}

export interface ColumnFill {
  id: string;
  databaseId: string;
  propertyId: string;
  instruction: string;
  rewrite: boolean;
  status: ColumnFillStatus;
  total: number;
  settled: number;
  createdAt: string;
  updatedAt: string;
  cells: ColumnFillCell[];
}

export function isColumnFillPropertyType(type: DocumentPropertyType): boolean {
  return COLUMN_FILL_PROPERTY_TYPES.includes(type);
}

export function isColumnFillActive(
  status: ColumnFillStatus | undefined,
): boolean {
  return status === "running" || status === "stopping";
}

export function isColumnFillCellSettled(status: ColumnFillCellStatus): boolean {
  return status !== "waiting" && status !== "running";
}
