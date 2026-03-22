/**
 * Example script — callable via `pnpm script hello`
 *
 * Scripts export a default async function that receives CLI args.
 */

import { parseArgs } from "@agent-native/core";
import { agentChat } from "@agent-native/core";

export default async function hello(args: string[]) {
  const parsed = parseArgs(args);
  const name = parsed.name ?? "world";

  console.log(`Hello, ${name}!`);

  // Example: send a message to agent chat (works in Electron context)
  if (parsed["send-chat"] === "true") {
    agentChat.submit(`Hello from the script system! Name: ${name}`);
  }
}
