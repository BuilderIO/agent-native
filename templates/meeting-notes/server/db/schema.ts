import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

// -----------------------------------------------------------------------------
// Meetings — the core resource
// -----------------------------------------------------------------------------

export const meetings = table("meetings", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  title: text("title").notNull().default("Untitled meeting"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  calendarEventId: text("calendar_event_id"),
  calendarProvider: text("calendar_provider", {
    enum: ["google", "microsoft"],
  }),
  status: text("status", {
    enum: ["scheduled", "recording", "enhancing", "done"],
  })
    .notNull()
    .default("scheduled"),
  folderId: text("folder_id"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const meetingShares = createSharesTable("meeting_shares");

// -----------------------------------------------------------------------------
// Transcripts — raw audio-to-text output
// -----------------------------------------------------------------------------

export const meetingTranscripts = table("meeting_transcripts", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  segmentsJson: text("segments_json").notNull().default("[]"),
  fullText: text("full_text").notNull().default(""),
  speakerLabels: text("speaker_labels").notNull().default("{}"),
  status: text("status", {
    enum: ["pending", "streaming", "ready", "failed"],
  })
    .notNull()
    .default("pending"),
  failureReason: text("failure_reason"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Notes — user's raw notes + AI-enhanced version
// -----------------------------------------------------------------------------

export const meetingNotes = table("meeting_notes", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  rawContent: text("raw_content").notNull().default("{}"),
  enhancedContent: text("enhanced_content"),
  templateId: text("template_id"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Templates — reusable note enhancement prompts
// -----------------------------------------------------------------------------

export const meetingTemplates = table("meeting_templates", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  isBuiltIn: integer("is_built_in", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

// -----------------------------------------------------------------------------
// Attendees — who was in each meeting
// -----------------------------------------------------------------------------

export const meetingAttendees = table("meeting_attendees", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  personId: text("person_id"),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role", { enum: ["organizer", "required", "optional"] })
    .notNull()
    .default("required"),
});

// -----------------------------------------------------------------------------
// Folders — organize meetings into groups
// -----------------------------------------------------------------------------

export const meetingFolders = table("meeting_folders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  createdAt: text("created_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// People — contacts built from meeting attendees
// -----------------------------------------------------------------------------

export const people = table("people", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  companyId: text("company_id"),
  title: text("title"),
  avatarUrl: text("avatar_url"),
  lastSeenAt: text("last_seen_at"),
  meetingCount: integer("meeting_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Companies — extracted from email domains
// -----------------------------------------------------------------------------

export const companies = table("companies", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  domain: text("domain"),
  logoUrl: text("logo_url"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Recipes — reusable AI prompts that run over meetings
// -----------------------------------------------------------------------------

export const recipes = table("recipes", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  scope: text("scope", { enum: ["single", "multi"] })
    .notNull()
    .default("single"),
  isPublic: integer("is_public", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});
