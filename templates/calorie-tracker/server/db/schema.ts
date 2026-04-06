import { table, text, integer, real } from "@agent-native/core/db/schema";

export const meals = table("meals", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  calories: integer("calories").notNull().default(0),
  protein: real("protein"),
  carbs: real("carbs"),
  fat: real("fat"),
  date: text("date").notNull(),
  image_url: text("image_url"),
  notes: text("notes"),
  created_at: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
});

export const exercises = table("exercises", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  calories_burned: integer("calories_burned").notNull().default(0),
  duration_minutes: integer("duration_minutes"),
  date: text("date").notNull(),
  created_at: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
});

export const weights = table("weights", {
  id: integer("id").primaryKey(),
  weight: real("weight").notNull(),
  date: text("date").notNull(),
  notes: text("notes"),
  created_at: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
});
