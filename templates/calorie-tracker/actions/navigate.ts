import { writeAppState } from "@agent-native/core/application-state";
import { parseArgs, output } from "./helpers.js";

export const tool = {
  description: "Navigate the user's UI to a specific view",
  parameters: {
    type: "object" as const,
    properties: {
      view: {
        type: "string",
        enum: ["entry", "analytics"],
        description: "View to navigate to",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const view = args.view || "entry";
  await writeAppState("navigate", { view });
  return output({ success: true, navigatedTo: view });
}

export default async function main(args?: string[]) {
  const parsed = parseArgs(args);
  const result = await run(parsed);
  console.log(result);
}
