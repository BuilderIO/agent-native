import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { and, gte, lte, asc, desc } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Get calorie and weight analytics/history data",
  schema: z.object({
    days: z.coerce
      .number()
      .optional()
      .default(30)
      .describe("Number of days to look back"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const days = args.days!;
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const startDate = fmt(start);
    const endDate = fmt(end);

    // Calorie history
    const mealsData = await db()
      .select()
      .from(schema.meals)
      .where(
        and(gte(schema.meals.date, startDate), lte(schema.meals.date, endDate)),
      )
      .orderBy(asc(schema.meals.date));

    const exercisesData = await db()
      .select()
      .from(schema.exercises)
      .where(
        and(
          gte(schema.exercises.date, startDate),
          lte(schema.exercises.date, endDate),
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
      const existing = dataByDate.get(exercise.date) || {
        meals: 0,
        burned: 0,
      };
      dataByDate.set(exercise.date, {
        ...existing,
        burned: existing.burned + exercise.calories_burned,
      });
    }

    const calorieHistory = Array.from(dataByDate.entries())
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

    // Weight history
    const weightData = await db()
      .select()
      .from(schema.weights)
      .where(
        and(
          gte(schema.weights.date, startDate),
          lte(schema.weights.date, endDate),
        ),
      )
      .orderBy(asc(schema.weights.date), desc(schema.weights.created_at));

    const weightByDate = new Map<string, number>();
    for (const entry of weightData) {
      if (!weightByDate.has(entry.date)) {
        weightByDate.set(entry.date, entry.weight);
      }
    }

    const weightEntries = Array.from(weightByDate.entries())
      .map(([date, weight]) => ({ date, weight }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const weightHistory = weightEntries.map((entry, index) => {
      let trendWeight = entry.weight;
      if (weightEntries.length >= 3) {
        const windowSize = Math.min(7, index + 1);
        const windowEntries = weightEntries.slice(
          Math.max(0, index - windowSize + 1),
          index + 1,
        );
        let weightSum = 0;
        let divisor = 0;
        windowEntries.forEach((e, i) => {
          const w = i + 1;
          weightSum += e.weight * w;
          divisor += w;
        });
        trendWeight = weightSum / divisor;
      }
      return {
        date: entry.date,
        weight: entry.weight,
        trendWeight: Math.round(trendWeight * 10) / 10,
        displayDate: new Date(entry.date + "T12:00:00").toLocaleDateString(
          "en-US",
          { month: "short", day: "numeric" },
        ),
      };
    });

    const avgCalories =
      calorieHistory.length > 0
        ? Math.round(
            calorieHistory.reduce((s, d) => s + d.netCalories, 0) /
              calorieHistory.length,
          )
        : 0;

    return {
      period: { startDate, endDate, days },
      calories: {
        history: calorieHistory,
        average: avgCalories,
        daysTracked: calorieHistory.length,
      },
      weight: {
        history: weightHistory,
        current:
          weightHistory.length > 0
            ? weightHistory[weightHistory.length - 1].weight
            : null,
        entries: weightHistory.length,
      },
    };
  },
});
