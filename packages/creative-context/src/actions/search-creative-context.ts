import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { performCreativeContextSearch } from "../server/retrieval.js";

const schema = z
  .object({
    query: z.string().trim().min(1).max(1000).optional(),
    imageBlobRef: z.string().min(1).max(20_000).optional(),
    mediaId: z.string().min(1).optional(),
    sourceIds: z.array(z.string().min(1)).max(100).optional(),
    packId: z.string().min(1).optional(),
    contextId: z.string().min(1).optional(),
    kinds: z.array(z.string().min(1)).max(50).optional(),
    tags: z.array(z.string().min(1)).max(100).optional(),
    colors: z.array(z.string().min(1)).max(100).optional(),
    updatedAfter: z.iso.datetime().optional(),
    updatedBefore: z.iso.datetime().optional(),
    statuses: z
      .array(z.enum(["active", "deprecated"]))
      .max(2)
      .optional(),
    matchMode: z
      .enum(["allTerms", "anyTerm", "phrase", "regex"])
      .default("allTerms"),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    maxPerSource: z.coerce.number().int().min(1).max(20).default(5),
    snapshot: z.boolean().default(true),
    contextPackName: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (value) => Boolean(value.query || value.imageBlobRef || value.mediaId),
    {
      message: "Provide query, imageBlobRef, or mediaId",
    },
  )
  .refine((value) => !(value.imageBlobRef && value.mediaId), {
    message: "Provide imageBlobRef or mediaId, not both",
  });

export default defineAction({
  description:
    "Search accessible approved Creative Context evidence, optionally within one named context, through portable lexical, Postgres FTS, and same-database pgvector lanes; fuse and diversify results, collapse revisions, and snapshot exact evidence by default.",
  schema,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: performCreativeContextSearch,
});
