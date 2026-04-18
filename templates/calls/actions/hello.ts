/**
 * Example script — callable via `pnpm action hello`
 */

import { parseArgs } from "@agent-native/core";
import { agentChat } from "@agent-native/core";

export default async function hello(args: string[]) {
  const parsed = parseArgs(args);
  const name = parsed.name ?? "world";

  console.log(`Hello, ${name}!`);

  if (parsed["send-chat"] === "true") {
    agentChat.submit(`Hello from the calls script system! Name: ${name}`);
  }
}
