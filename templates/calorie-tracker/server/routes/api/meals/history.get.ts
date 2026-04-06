import { defineEventHandler, getQuery } from "h3";
import { db } from "../../../db/index.js";
import { schema } from "../../../db/index.js";
import { and, gte, lte, asc } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const { startDate, endDate } = getQuery(event);
  if (!startDate || !endDate)
    return { error: "startDate and endDate required" };

  const mealsData = await db()
    .select()
    .from(schema.meals)
    .where(
      and(
        gte(schema.meals.date, String(startDate)),
        lte(schema.meals.date, String(endDate)),
      ),
    )
    .orderBy(asc(schema.meals.date));

  const exercisesData = await db()
    .select()
    .from(schema.exercises)
    .where(
      and(
        gte(schema.exercises.date, String(startDate)),
        lte(schema.exercises.date, String(endDate)),
      ),
    )
    .orderBy(asc(schema.exercises.date));

  const dataByDate = new Map<string, { meals: number; burned: number }>();

  for (const meal of mealsData) {
    const existing = dataByDate.get(meal.date) || { meals: 0, burned: 0 };
    dataByDate.set(meal.date, {
      ...existing,
      meals: existing.meals + meal.calories,
    });
  }

  for (const exercise of exercisesData) {
    const existing = dataByDate.get(exercise.date) || { meals: 0, burned: 0 };
    dataByDate.set(exercise.date, {
      ...existing,
      burned: existing.burned + exercise.calories_burned,
    });
  }

  const result = Array.from(dataByDate.entries())
    .map(([date, { meals, burned }]) => ({
      date,
      totalCalories: meals,
      burnedCalories: burned,
      netCalories: meals - burned,
      displayDate: new Date(date + "T12:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return result;
});
