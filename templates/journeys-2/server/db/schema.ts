import { integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

const stamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const journeys = pgTable("jn_journeys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  kind: text("kind").notNull().default("audience"),
  audienceId: text("audience_id"),
  goal: text("goal").notNull().default(""),
  nodes: jsonb("nodes").notNull().default([]),
  edges: jsonb("edges").notNull().default([]),
  settings: jsonb("settings").notNull().default({}),
  report: jsonb("report").notNull().default({}),
  entered: integer("entered").notNull().default(0),
  exited: integer("exited").notNull().default(0),
  ...stamps,
});

export const emails = pgTable("jn_emails", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull().default(""),
  preheader: text("preheader").notNull().default(""),
  fromName: text("from_name").notNull().default(""),
  fromEmail: text("from_email").notNull().default(""),
  replyTo: text("reply_to").notNull().default(""),
  body: text("body").notNull().default(""),
  kind: text("kind").notNull().default("marketing"),
  status: text("status").notNull().default("draft"),
  trackOpens: integer("track_opens").notNull().default(1),
  trackClicks: integer("track_clicks").notNull().default(1),
  ...stamps,
});

export const audiences = pgTable("jn_audiences", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("dynamic"),
  filter: jsonb("filter").notNull().default({}),
  memberIds: jsonb("member_ids").notNull().default([]),
  ...stamps,
});

export const accounts = pgTable("jn_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull().default(""),
  industry: text("industry").notNull().default(""),
  plan: text("plan").notNull().default(""),
  owner: text("owner").notNull().default(""),
  employees: integer("employees").notNull().default(0),
  renewalDate: text("renewal_date"),
  score: integer("score").notNull().default(0),
  signals: jsonb("signals").notNull().default([]),
  ...stamps,
});

export const contacts = pgTable("jn_contacts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  title: text("title").notNull().default(""),
  accountId: text("account_id"),
  country: text("country").notNull().default(""),
  state: text("state").notNull().default(""),
  lifecycleStage: text("lifecycle_stage").notNull().default("lead"),
  source: text("source").notNull().default(""),
  subscribed: integer("subscribed").notNull().default(1),
  lastActive: text("last_active"),
  activity: jsonb("activity").notNull().default({}),
  lists: jsonb("lists").notNull().default([]),
  ...stamps,
});

export const members = pgTable("jn_members", {
  id: text("id").primaryKey(),
  journeyId: text("journey_id").notNull(),
  contactId: text("contact_id").notNull(),
  status: text("status").notNull().default("active"),
  currentNodeId: text("current_node_id"),
  enteredAt: text("entered_at").notNull(),
  exitedAt: text("exited_at"),
});

export const sends = pgTable("jn_sends", {
  id: text("id").primaryKey(),
  journeyId: text("journey_id").notNull(),
  emailId: text("email_id").notNull(),
  day: text("day").notNull(),
  sent: integer("sent").notNull().default(0),
  delivered: integer("delivered").notNull().default(0),
  opened: integer("opened").notNull().default(0),
  clicked: integer("clicked").notNull().default(0),
  bounced: integer("bounced").notNull().default(0),
  unsubscribed: integer("unsubscribed").notNull().default(0),
});

export const tokens = pgTable("jn_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("text"),
  source: text("source").notNull().default(""),
  fallback: text("fallback").notNull().default(""),
  rules: jsonb("rules").notNull().default([]),
  ...stamps,
});

export const conversions = pgTable("jn_conversions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  eventType: text("event_type").notNull(),
  windowDays: integer("window_days").notNull().default(30),
  journeyId: text("journey_id"),
  count: integer("count").notNull().default(0),
  ...stamps,
});

export const connections = pgTable("jn_connections", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("disconnected"),
  detail: text("detail").notNull().default(""),
  lastSyncAt: text("last_sync_at"),
  config: jsonb("config").notNull().default({}),
});

export const settings = pgTable("jn_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}),
});

export const users = pgTable("jn_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("editor"),
  status: text("status").notNull().default("active"),
  ...stamps,
});
