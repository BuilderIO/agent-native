import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  createSource,
  nanoid,
  serializeSource,
  sha256Hex,
} from "../server/lib/brain.js";
import { assertSourceWorkspaceConnectionAvailable } from "../server/lib/source-credentials.js";
import { jsonRecordSchema, sourceProviderSchema } from "./_schemas.js";

export default defineAction({
  description:
    "Create a Brain source for manual imports, generic captures, Slack, Granola, or GitHub.",
  schema: z.object({
    id: z.string().optional().describe("Optional optimistic source ID"),
    title: z.string().min(1).describe("Human-readable source name"),
    provider: sourceProviderSchema.default("manual"),
    config: jsonRecordSchema.describe("Provider configuration stored as JSON"),
    sourceKey: z
      .string()
      .optional()
      .describe("Stable key used by signed webhook payloads"),
    ingestToken: z
      .string()
      .optional()
      .describe("Optional signed-ingest bearer token; stored only as a hash"),
    visibility: z.enum(["private", "org", "public"]).default("org"),
  }),
  run: async (args) => {
    const config = { ...args.config };
    const workspaceConnectionId =
      typeof config.workspaceConnectionId === "string"
        ? config.workspaceConnectionId.trim()
        : "";
    if (workspaceConnectionId) {
      config.workspaceConnectionId = workspaceConnectionId;
      await assertSourceWorkspaceConnectionAvailable({
        provider: args.provider,
        workspaceConnectionId,
      });
    } else {
      delete config.workspaceConnectionId;
    }
    let ingestToken: string | undefined;
    if (args.sourceKey) {
      ingestToken = args.ingestToken ?? `brain_${nanoid(32)}`;
      config.sourceKey = args.sourceKey;
      config.ingestTokenHash = await sha256Hex(ingestToken);
    }
    const source = await createSource({
      id: args.id,
      title: args.title,
      provider: args.provider,
      config,
      visibility: args.visibility,
    });
    return { source: serializeSource(source), ingestToken };
  },
});
