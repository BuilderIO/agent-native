import type { ContentDatabaseOpenPagesIn } from "@shared/api";
import type { DatabaseFilterMode, DatabaseRowDensity } from "./types";

export function normalizeClientDatabaseRowDensity(
  value: unknown,
): DatabaseRowDensity {
  if (value === "compact" || value === "comfortable") return value;
  return "default";
}

export function normalizeClientDatabaseOpenPagesIn(
  value: unknown,
): ContentDatabaseOpenPagesIn {
  return value === "full_page" ? "full_page" : "preview";
}

export function normalizeClientDatabaseFilterMode(
  value: unknown,
): DatabaseFilterMode {
  return value === "or" ? "or" : "and";
}
