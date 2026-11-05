import { noteObservedWrite, observingWrites } from "../action-frame.js";
import { sqlMayWrite } from "./sql-write-classifier.js";

/**
 * Count the running action call as having written when `sql` may write or is
 * not text that can be told to be a read. Called before the statement is sent.
 */
export function noteSqlStatement(sql: unknown): void {
  if (observingWrites() && sqlMayWrite(sql)) noteObservedWrite("db");
}
