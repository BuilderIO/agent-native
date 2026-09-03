/**
 * Drizzle schema for the extension-points slot system.
 *
 * Two tables:
 *
 * - `extension_slots`     — declarations: "extension X can render in slot Y".
 *                           Authored once per extension, regardless of installer.
 *                           Physical SQL name stays `tool_slots` (additive-only).
 * - `extension_slot_installs` — per-user installs: "user U wants extension X in
 *                               slot Y at position N". Always scoped by
 *                               owner_email. Physical SQL name stays
 *                               `tool_slot_installs`.
 *
 * Neither table spreads `ownableColumns()` — they're not first-class shareable
 * resources. Access to the underlying extension flows through the existing
 * `extensions` table sharing model; install rows are personal preferences
 * scoped to the installing user.
 */

import { table, text, integer, now } from "../../db/schema.js";

export const extensionSlots = table("tool_slots", {
  id: text("id").primaryKey(),
  extensionId: text("tool_id").notNull(),
  slotId: text("slot_id").notNull(),
  config: text("config"),
  createdAt: text("created_at").notNull().default(now()),
});

export const extensionSlotInstalls = table("tool_slot_installs", {
  id: text("id").primaryKey(),
  extensionId: text("tool_id").notNull(),
  slotId: text("slot_id").notNull(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  position: integer("position").notNull().default(0),
  config: text("config"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const EXTENSION_SLOTS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS tool_slots (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export const EXTENSION_SLOTS_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS tool_slots (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT now()
)`;

export const EXTENSION_SLOTS_BY_SLOT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tool_slots_by_slot_idx ON tool_slots (slot_id)`;
export const EXTENSION_SLOTS_BY_EXTENSION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tool_slots_by_tool_idx ON tool_slots (tool_id)`;
export const EXTENSION_SLOTS_UNIQUE_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS tool_slots_unique_idx ON tool_slots (tool_id, slot_id)`;

export const EXTENSION_SLOT_INSTALLS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS tool_slot_installs (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export const EXTENSION_SLOT_INSTALLS_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS tool_slot_installs (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
)`;

export const EXTENSION_SLOT_INSTALLS_BY_USER_SLOT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tool_slot_installs_by_user_slot_idx ON tool_slot_installs (owner_email, slot_id)`;
export const EXTENSION_SLOT_INSTALLS_UNIQUE_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS tool_slot_installs_unique_idx ON tool_slot_installs (owner_email, tool_id, slot_id)`;
