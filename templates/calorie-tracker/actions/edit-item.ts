import { parseArgs, output } from "./helpers.js";

export const tool = {
  description: "Edit an existing meal, exercise, or weight entry",
  parameters: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["meal", "exercise", "weight"],
        description: "Type of item",
      },
      id: { type: "string", description: "ID of the item" },
      name: {
        type: "string",
        description: "New name (meals/exercises only)",
      },
      calories: { type: "string", description: "New calories (meals only)" },
      protein: {
        type: "string",
        description: "New protein in grams (meals only)",
      },
      carbs: {
        type: "string",
        description: "New carbs in grams (meals only)",
      },
      fat: { type: "string", description: "New fat in grams (meals only)" },
      calories_burned: {
        type: "string",
        description: "New calories burned (exercises only)",
      },
      weight: {
        type: "string",
        description: "New weight in lbs (weight entries only)",
      },
      notes: {
        type: "string",
        description: "Notes (weight entries only)",
      },
    },
    required: ["type", "id"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const endpoint =
    args.type === "meal"
      ? "meals"
      : args.type === "exercise"
        ? "exercises"
        : "weights";
  const port = process.env.PORT || "8080";

  const body: Record<string, any> = {};
  if (args.type === "meal") {
    if (args.name) body.name = args.name;
    if (args.calories) body.calories = parseInt(args.calories);
    if (args.protein) body.protein = parseInt(args.protein);
    if (args.carbs) body.carbs = parseInt(args.carbs);
    if (args.fat) body.fat = parseInt(args.fat);
  } else if (args.type === "exercise") {
    if (args.name) body.name = args.name;
    if (args.calories_burned)
      body.calories_burned = parseInt(args.calories_burned);
  } else if (args.type === "weight") {
    if (args.weight) body.weight = parseFloat(args.weight);
    if (args.notes) body.notes = args.notes;
  }

  const res = await fetch(
    `http://localhost:${port}/api/${endpoint}/${args.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Source": "agent",
      },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json();
  return output({ success: true, updated: data });
}

export default async function main() {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
