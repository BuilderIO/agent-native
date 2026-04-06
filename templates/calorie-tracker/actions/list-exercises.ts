import { parseArgs, output } from "./helpers.js";

export const tool = {
  description: "List exercises logged for a specific date",
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
  const res = await fetch(
    `http://localhost:${port}/api/exercises?date=${date}`,
    {
      headers: { "X-Request-Source": "agent" },
    },
  );
  if (!res.ok) {
    const err = await res.text();
    return output({ success: false, error: err });
  }

  const exercises = await res.json();

  const totalBurned = exercises.reduce(
    (sum: number, e: any) => sum + e.calories_burned,
    0,
  );

  return output({ date, exercises, totalBurned, count: exercises.length });
}

export default async function main(args?: string[]) {
  const parsed = parseArgs(args);
  const result = await run(parsed);
  console.log(result);
}
