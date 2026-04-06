import { parseArgs, output } from "./helpers.js";

export const tool = {
  description: "Get calorie and weight analytics/history data",
  parameters: {
    type: "object" as const,
    properties: {
      days: {
        type: "string",
        description: "Number of days to look back (default: 30)",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const days = parseInt(args.days || "30");
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const startDate = fmt(start);
  const endDate = fmt(end);

  const port = process.env.PORT || "8080";

  const [calorieRes, weightRes] = await Promise.all([
    fetch(
      `http://localhost:${port}/api/meals/history?startDate=${startDate}&endDate=${endDate}`,
      { headers: { "X-Request-Source": "agent" } },
    ),
    fetch(
      `http://localhost:${port}/api/weights/history?startDate=${startDate}&endDate=${endDate}`,
      { headers: { "X-Request-Source": "agent" } },
    ),
  ]);

  if (!calorieRes.ok) {
    const err = await calorieRes.text();
    return output({
      success: false,
      error: `Failed to fetch calorie history: ${err}`,
    });
  }
  if (!weightRes.ok) {
    const err = await weightRes.text();
    return output({
      success: false,
      error: `Failed to fetch weight history: ${err}`,
    });
  }

  const calorieHistory = await calorieRes.json();
  const weightHistory = await weightRes.json();

  const avgCalories =
    calorieHistory.length > 0
      ? Math.round(
          calorieHistory.reduce((s: number, d: any) => s + d.netCalories, 0) /
            calorieHistory.length,
        )
      : 0;

  return output({
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
  });
}

export default async function main(args?: string[]) {
  const parsed = parseArgs(args);
  const result = await run(parsed);
  console.log(result);
}
