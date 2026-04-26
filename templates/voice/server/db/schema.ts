import {
  table,
  text,
  integer,
  now,
  ownableColumns,
} from "@agent-native/core/db/schema";

// -----------------------------------------------------------------------------
// Dictations — the core resource
//
// Each row represents one dictation session: the raw transcript from Whisper,
// the polished text after style/context formatting, optional audio reference,
// and metadata (language, duration, app context).
// -----------------------------------------------------------------------------

export const dictations = table("dictations", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  rawText: text("raw_text").notNull(),
  audioPath: text("audio_path"),
  appContext: text("app_context"),
  style: text("style"),
  language: text("language").notNull().default("en"),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

// -----------------------------------------------------------------------------
// Snippets — text expansion shortcuts
//
// Type a trigger (e.g. "@@sig") and it expands to the full text. Supports
// personal and team-shared snippets (isTeam flag + organizationId).
// -----------------------------------------------------------------------------

export const dictationSnippets = table("dictation_snippets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id"),
  trigger: text("trigger").notNull(),
  expansion: text("expansion").notNull(),
  isTeam: integer("is_team", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

// -----------------------------------------------------------------------------
// Dictionary — custom vocabulary and corrections
//
// Terms the transcription model frequently gets wrong. "auto" entries are
// learned from user corrections; "manual" entries are explicitly added.
// -----------------------------------------------------------------------------

export const dictationDictionary = table("dictation_dictionary", {
  id: text("id").primaryKey(),
  term: text("term").notNull(),
  correction: text("correction"),
  source: text("source", { enum: ["auto", "manual"] })
    .notNull()
    .default("manual"),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});

// -----------------------------------------------------------------------------
// Styles — per-category formatting presets
//
// Controls how the agent formats polished text based on context. Each row
// maps a communication category to a tone preset (formal, casual, etc.)
// plus an optional custom prompt override.
// -----------------------------------------------------------------------------

export const dictationStyles = table("dictation_styles", {
  id: text("id").primaryKey(),
  category: text("category", {
    enum: ["personal_messages", "work_messages", "email", "other"],
  }).notNull(),
  preset: text("preset", {
    enum: ["formal", "casual", "very_casual", "excited"],
  })
    .notNull()
    .default("casual"),
  customPrompt: text("custom_prompt"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

// -----------------------------------------------------------------------------
// Stats — daily usage tracking
//
// One row per day per user. Tracks words dictated, session count, and streak.
// -----------------------------------------------------------------------------

export const dictationStats = table("dictation_stats", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  totalWords: integer("total_words").notNull().default(0),
  sessionsCount: integer("sessions_count").notNull().default(0),
  streak: integer("streak").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  ...ownableColumns(),
});
