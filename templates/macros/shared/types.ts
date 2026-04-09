import { z } from "zod";

export const mealSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1, "Name is required"),
  calories: z.number().min(0),
  protein: z.number().min(0).optional().nullable(),
  carbs: z.number().min(0).optional().nullable(),
  fat: z.number().min(0).optional().nullable(),
  date: z.string(),
  image_url: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type Meal = z.infer<typeof mealSchema>;

export const exerciseSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  calories_burned: z.number().min(0),
  duration_minutes: z.number().min(1).optional().nullable(),
  date: z.string(),
});

export type Exercise = z.infer<typeof exerciseSchema>;

export const weightSchema = z.object({
  id: z.number().optional(),
  weight: z.number().min(0, "Weight must be positive"),
  date: z.string(),
  notes: z.string().optional().nullable(),
});

export type Weight = z.infer<typeof weightSchema>;

export interface DailyCalories {
  date: string;
  totalCalories: number;
  burnedCalories: number;
  netCalories: number;
  displayDate: string;
}

export interface WeightHistoryEntry {
  date: string;
  weight: number;
  trendWeight: number;
  displayDate: string;
}
