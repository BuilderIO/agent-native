import { getDb } from "./index.js";

export type DbHandle = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "update" | "delete"
>;
