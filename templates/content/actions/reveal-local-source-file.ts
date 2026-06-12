import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  getLocalFileDocument,
  isContentLocalFileMode,
} from "./_local-file-documents.js";

async function revealPath(absolutePath: string) {
  const target = path.resolve(absolutePath);
  await fs.access(target);

  let command: string;
  let args: string[];
  if (process.platform === "darwin") {
    command = "open";
    args = ["-R", target];
  } else if (process.platform === "win32") {
    command = "explorer.exe";
    args = [`/select,${target}`];
  } else {
    command = "xdg-open";
    args = [path.dirname(target)];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export default defineAction({
  description:
    "Reveal a server-backed local source file in the system file manager.",
  agentTool: false,
  schema: z.object({
    id: z.string().describe("Document ID"),
  }),
  run: async ({ id }) => {
    let absolutePath: string | undefined;

    if (await isContentLocalFileMode()) {
      const doc = await getLocalFileDocument(id);
      absolutePath = doc.source?.absolutePath;
    } else {
      const access = await assertAccess("document", id, "viewer");
      const [doc] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, access.resource.id));
      absolutePath = serializeDocumentSource(doc)?.absolutePath;
    }

    if (!absolutePath) {
      throw new Error(
        "This source file does not expose an absolute path in this runtime.",
      );
    }

    await revealPath(absolutePath);
    return { ok: true, absolutePath };
  },
});
