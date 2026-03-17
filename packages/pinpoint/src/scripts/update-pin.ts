// @agent-native/pinpoint — Update annotation script
// MIT License

import { parseArgs, fail } from "@agent-native/core/scripts";
import { FileStore } from "../storage/file-store.js";

export default async function (args: string[]) {
  const { id, comment, status } = parseArgs(args) as {
    id?: string;
    comment?: string;
    status?: string;
  };

  if (!id) fail("--id is required");
  if (!comment && !status) fail("--comment or --status is required");

  const store = new FileStore();
  const patch: Record<string, any> = {};

  if (comment) patch.comment = comment;
  if (status) {
    patch.status = {
      state: status,
      changedAt: new Date().toISOString(),
      changedBy: "agent",
    };
  }

  await store.update(id!, patch);
  console.log(`Updated annotation ${id}`);
}
