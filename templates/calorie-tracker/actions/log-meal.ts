import { parseArgs, output } from "./helpers.js";

export const tool = {
  description: "Log a meal with calories and optional macros",
  parameters: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "Meal name" },
      calories: { type: "string", description: "Calories (number)" },
      protein: {
        type: "string",
        description: "Protein in grams (optional)",
      },
      carbs: { type: "string", description: "Carbs in grams (optional)" },
      fat: { type: "string", description: "Fat in grams (optional)" },
      date: {
        type: "string",
        description: "Date in YYYY-MM-DD format (defaults to today)",
      },
    },
    required: ["name", "calories"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const today = new Date();
  const date =
    args.date ||
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const port = process.env.PORT || "8080";
  const res = await fetch(`http://localhost:${port}/api/meals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": "agent",
    },
    body: JSON.stringify({
      name: args.name,
      calories: parseInt(args.calories) || 0,
      protein: args.protein ? parseInt(args.protein) : null,
      carbs: args.carbs ? parseInt(args.carbs) : null,
      fat: args.fat ? parseInt(args.fat) : null,
      date,
    }),
  });

  const data = await res.json();
  return output({ success: true, meal: data });
}

export default async function main() {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
