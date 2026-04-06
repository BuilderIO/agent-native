import { parseArgs, output } from "./helpers.js";

export const tool = {
  description: "Delete a meal, exercise, or weight entry by ID",
  parameters: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["meal", "exercise", "weight"],
        description: "Type of item to delete",
      },
      id: { type: "string", description: "ID of the item to delete" },
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

  const res = await fetch(
    `http://localhost:${port}/api/${endpoint}/${args.id}`,
    {
      method: "DELETE",
      headers: { "X-Request-Source": "agent" },
    },
  );

  if (!res.ok) {
    const err = await res.text();
    return output({ success: false, error: err });
  }

  return output({ success: true, deleted: { type: args.type, id: args.id } });
}

export default async function main(args?: string[]) {
  const parsed = parseArgs(args);
  const result = await run(parsed);
  console.log(result);
}
