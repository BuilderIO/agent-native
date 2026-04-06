import { parseArgs, output } from "./helpers.js";

export const tool = {
  description: "Log an exercise with calories burned",
  parameters: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "Exercise name" },
      calories_burned: {
        type: "string",
        description: "Calories burned (number)",
      },
      duration_minutes: {
        type: "string",
        description: "Duration in minutes (optional)",
      },
      date: {
        type: "string",
        description: "Date in YYYY-MM-DD format (defaults to today)",
      },
    },
    required: ["name", "calories_burned"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const today = new Date();
  const date =
    args.date ||
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const port = process.env.PORT || "8080";
  const res = await fetch(`http://localhost:${port}/api/exercises`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": "agent",
    },
    body: JSON.stringify({
      name: args.name,
      calories_burned: parseInt(args.calories_burned) || 0,
      duration_minutes: args.duration_minutes
        ? parseInt(args.duration_minutes)
        : null,
      date,
    }),
  });

  const data = await res.json();
  return output({ success: true, exercise: data });
}

export default async function main() {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
