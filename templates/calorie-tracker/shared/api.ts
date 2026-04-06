import { z } from "zod";

export const mealSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1, "Name is required"),
  calories: z.number().min(0),
  protein: z.number().min(0).optional().nullable(),
  carbs: z.number().min(0).optional().nullable(),
  fat: z.number().min(0).optional().nullable(),
  date: z.string(), // ISO string
  imageUrl: z.string().optional(),
  notes: z.string().optional(),
});

export type Meal = z.infer<typeof mealSchema>;

export interface DailyStats {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  meals: Meal[];
}

export interface AIAnalysisResponse {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  reasoning?: string;
}

export interface DualAIAnalysisResponse {
  haiku: AIAnalysisResponse;
  opus: AIAnalysisResponse;
}

export const weightSchema = z.object({
  id: z.number().optional(),
  weight: z.number().min(0, "Weight must be positive"),
  date: z.string(), // ISO string
  notes: z.string().optional(),
});

export type Weight = z.infer<typeof weightSchema>;
