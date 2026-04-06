import { readAppState } from "@agent-native/core/application-state";
import { parseArgs, output } from "./helpers.js";

export const tool = {
  description:
    "See what the user is currently viewing - their current date, daily totals, and navigation state",
  parameters: { type: "object" as const, properties: {} },
};

export async function run(): Promise<string> {
  const navigation = await readAppState("navigation");
  return output({
    navigation: navigation || { view: "entry", path: "/" },
    hint: "Use list-meals, list-exercises, or list-weights with the date from navigation to see the user's data",
  });
}

export default async function main() {
  const result = await run();
  console.log(result);
}
