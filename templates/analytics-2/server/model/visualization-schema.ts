import type { PrivateBlobHandle } from "@agent-native/core/private-blob";
import { bigint, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

export const visualizationResults = pgTable(
  "analytics2_visualization_results",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    versionId: text("version_id").notNull(),
    cellId: text("cell_id").notNull(),
    sourceResultId: text("source_result_id").notNull(),
    configDigest: text("config_digest").notNull(),
    artifact: jsonb("artifact").$type<PrivateBlobHandle>().notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
);

export const visualizationReleaseSources = pgTable(
  "analytics2_visualization_release_sources",
  {
    versionId: text("version_id").notNull(),
    cellId: text("cell_id").notNull(),
    resultId: text("result_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.cellId] })],
);

export const visualizationDrills = pgTable(
  "analytics2_visualization_drills",
  {
    actorKey: text("actor_key").notNull(),
    requestId: text("request_id").notNull(),
    resultId: text("result_id").notNull(),
    intent: text("intent").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.actorKey, table.requestId] })],
);

export const visualizationPalettes = pgTable(
  "analytics2_visualization_palettes",
  {
    bindingKey: text("binding_key").primaryKey(),
    categories: jsonb("categories").$type<unknown>().notNull(),
  },
);
