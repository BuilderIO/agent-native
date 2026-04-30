import{i as e,n as t,o as n,r,s as i}from"./schema.mjs";const a=r(`tools`,{id:e(`id`).primaryKey(),name:e(`name`).notNull(),description:e(`description`).notNull().default(``),content:e(`content`).notNull().default(``),icon:e(`icon`),createdAt:e(`created_at`).notNull().default(t()),updatedAt:e(`updated_at`).notNull().default(t()),...i()}),o=n(`tool_shares`),s=`CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,c=`CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now(),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,l=`CREATE TABLE IF NOT EXISTS tool_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,u=`CREATE TABLE IF NOT EXISTS tool_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
)`;r(`tool_data`,{id:e(`id`).primaryKey(),toolId:e(`tool_id`).notNull(),collection:e(`collection`).notNull(),itemId:e(`item_id`),data:e(`data`).notNull(),ownerEmail:e(`owner_email`).notNull().default(`local@localhost`),scope:e(`scope`).notNull().default(`user`),orgId:e(`org_id`),scopeKey:e(`scope_key`).notNull().default(`local@localhost`),createdAt:e(`created_at`).notNull().default(t()),updatedAt:e(`updated_at`).notNull().default(t())});const d=`CREATE TABLE IF NOT EXISTS tool_data (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  item_id TEXT,
  data TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  scope TEXT NOT NULL DEFAULT 'user',
  org_id TEXT,
  scope_key TEXT NOT NULL DEFAULT 'local@localhost',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,f=`CREATE TABLE IF NOT EXISTS tool_data (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  item_id TEXT,
  data TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  scope TEXT NOT NULL DEFAULT 'user',
  org_id TEXT,
  scope_key TEXT NOT NULL DEFAULT 'local@localhost',
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
)`,p=`CREATE UNIQUE INDEX IF NOT EXISTS tool_data_scoped_item_idx
  ON tool_data (tool_id, collection, scope_key, item_id)`,m=`CREATE UNIQUE INDEX IF NOT EXISTS tool_data_scoped_item_idx
  ON tool_data (tool_id, collection, scope_key, item_id)`,h=`DROP INDEX IF EXISTS tool_data_scope_item_idx`,g=`DROP INDEX IF EXISTS tool_data_scope_item_idx`,_=`CREATE INDEX IF NOT EXISTS tools_owner_idx ON tools (owner_email)`,v=`CREATE INDEX IF NOT EXISTS tools_org_idx ON tools (org_id)`,y=`CREATE INDEX IF NOT EXISTS tool_shares_resource_idx ON tool_shares (resource_id)`;export{d as a,g as c,l as d,u as f,a as h,_ as i,p as l,o as m,c as n,f as o,y as p,v as r,h as s,s as t,m as u};