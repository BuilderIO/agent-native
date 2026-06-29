import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const designs = table("designs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  data: text("data").notNull(),
  projectType: text("project_type").notNull().default("prototype"),
  designSystemId: text("design_system_id"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designShares = createSharesTable("design_shares");

export const designSystems = table("design_systems", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  data: text("data").notNull(),
  assets: text("assets"),
  customInstructions: text("custom_instructions").notNull().default(""),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designSystemShares = createSharesTable("design_system_shares");

export const designFiles = table("design_files", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  filename: text("filename").notNull(),
  content: text("content").notNull(),
  fileType: text("file_type").notNull().default("html"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

export const designVersions = table("design_versions", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  label: text("label"),
  snapshot: text("snapshot").notNull(),
  createdAt: text("created_at").default(now()),
});

export const designLocalhostConnections = table(
  "design_localhost_connections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sourceType: text("source_type", { enum: ["localhost"] })
      .notNull()
      .default("localhost"),
    devServerUrl: text("dev_server_url").notNull(),
    bridgeUrl: text("bridge_url"),
    rootPath: text("root_path"),
    routeManifest: text("route_manifest").notNull().default("{}"),
    capabilities: text("capabilities").notNull().default("[]"),
    status: text("status", {
      enum: ["connected", "detected", "manual", "error"],
    })
      .notNull()
      .default("connected"),
    lastSeenAt: text("last_seen_at"),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    createdAt: text("created_at").default(now()),
    updatedAt: text("updated_at").default(now()),
  },
);
