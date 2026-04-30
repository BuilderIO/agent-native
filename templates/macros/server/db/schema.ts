import { table, text, integer, real } from "@agent-native/core/db/schema";

// owner_email is .notNull() at the type level so the action layer is forced
// to provide a real email on insert. The actual DB column remains nullable
// (legacy rows from before per-user scoping may have NULL owner_email);
// every action filters by `eq(owner_email, caller)`, so legacy NULL-owner
// rows are inaccessible to anyone but a future cleanup script.
export const meals = table("meals", {
  id: integer("id").primaryKey(),
  user_id: text("user_id"),
  owner_email: text("owner_email").notNull(),
  name: text("name").notNull(),
  calories: integer("calories").notNull().default(0),
  protein: real("protein"),
  carbs: real("carbs"),
  fat: real("fat"),
  date: text("date").notNull(),
  image_url: text("image_url"),
  notes: text("notes"),
  created_at: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const exercises = table("exercises", {
  id: integer("id").primaryKey(),
  user_id: text("user_id"),
  owner_email: text("owner_email").notNull(),
  name: text("name").notNull(),
  calories_burned: integer("calories_burned").notNull().default(0),
  duration_minutes: integer("duration_minutes"),
  date: text("date").notNull(),
  created_at: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const weights = table("weights", {
  id: integer("id").primaryKey(),
  user_id: text("user_id"),
  owner_email: text("owner_email").notNull(),
  weight: real("weight").notNull(),
  date: text("date").notNull(),
  notes: text("notes"),
  created_at: text("created_at").$defaultFn(() => new Date().toISOString()),
});
