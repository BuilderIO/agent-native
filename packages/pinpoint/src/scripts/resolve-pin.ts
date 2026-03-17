// @agent-native/pinpoint — Resolve annotation script
// MIT License

import { parseArgs, fail } from "@agent-native/core/scripts";
import { FileStore } from "../storage/file-store.js";

export default async function (args: string[]) {
  const { id, message } = parseArgs(args) as {
    id?: string;
    message?: string;
  };

  if (!id) fail("--id is required");

  const store = new FileStore();
  await store.update(id!, {
    status: {
      state: "resolved",
      changedAt: new Date().toISOString(),
      changedBy: "agent",
    },
    ...(message ? { comment: message } : {}),
  });

  console.log(`Resolved annotation ${id}`);
}
