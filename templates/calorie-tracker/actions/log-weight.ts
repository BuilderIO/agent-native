import { parseArgs, output } from "./helpers.js";

export const tool = {
  description: "Log a weight entry",
  parameters: {
    type: "object" as const,
    properties: {
      weight: {
        type: "string",
        description: "Weight in pounds (number)",
      },
      date: {
        type: "string",
        description: "Date in YYYY-MM-DD format (defaults to today)",
      },
      notes: { type: "string", description: "Optional notes" },
    },
    required: ["weight"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const today = new Date();
  const date =
    args.date ||
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const port = process.env.PORT || "8080";
  const res = await fetch(`http://localhost:${port}/api/weights`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": "agent",
    },
    body: JSON.stringify({
      weight: parseFloat(args.weight),
      date,
      notes: args.notes || null,
    }),
  });

  const data = await res.json();
  return output({ success: true, weight: data });
}

export default async function main() {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
