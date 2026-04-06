import { parseArgs, output } from "./helpers.js";

export const tool = {
  description: "List meals logged for a specific date",
  parameters: {
    type: "object" as const,
    properties: {
      date: {
        type: "string",
        description: "Date in YYYY-MM-DD format (defaults to today)",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const today = new Date();
  const date =
    args.date ||
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const port = process.env.PORT || "8080";
  const res = await fetch(`http://localhost:${port}/api/meals?date=${date}`, {
    headers: { "X-Request-Source": "agent" },
  });
  const meals = await res.json();

  const totalCalories = meals.reduce(
    (sum: number, m: any) => sum + m.calories,
    0,
  );
  const totalProtein = meals.reduce(
    (sum: number, m: any) => sum + (m.protein || 0),
    0,
  );
  const totalCarbs = meals.reduce(
    (sum: number, m: any) => sum + (m.carbs || 0),
    0,
  );
  const totalFat = meals.reduce(
    (sum: number, m: any) => sum + (m.fat || 0),
    0,
  );

  return output({
    date,
    meals,
    totals: {
      calories: totalCalories,
      protein: totalProtein,
      carbs: totalCarbs,
      fat: totalFat,
    },
    count: meals.length,
  });
}

export default async function main() {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
