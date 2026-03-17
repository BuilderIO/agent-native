// @agent-native/pinpoint — Delete annotation script
// MIT License

import { parseArgs, fail } from "@agent-native/core/scripts";
import { FileStore } from "../storage/file-store.js";

export default async function (args: string[]) {
  const { id } = parseArgs(args) as { id?: string };

  if (!id) fail("--id is required");

  const store = new FileStore();
  await store.delete(id!);
  console.log(`Deleted annotation ${id}`);
}
