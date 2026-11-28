import { z } from "zod";

import type {
  DocumentVersionComparison,
  NamedDocumentVersionResult,
} from "../shared/document-history.js";
import { contentOutputContract } from "./_content-output-contracts.js";

const checkpointSchema = z.strictObject({
  id: z.string(),
  documentId: z.string(),
  groupId: z.string(),
  title: z.string(),
  checkpointKind: z.enum(["before", "after", "recovery", "legacy"]),
  createdAt: z.string(),
  name: z.string().nullable(),
  namedBy: z.string().nullable(),
  namedAt: z.string().nullable(),
});

export const namedDocumentVersionOutput =
  contentOutputContract<NamedDocumentVersionResult>(
    z.strictObject({ checkpoint: checkpointSchema, created: z.boolean() }),
  );

const comparisonSideSchema = z.strictObject({
  kind: z.enum(["checkpoint", "current"]),
  id: z.string().nullable(),
  name: z.string().nullable(),
  title: z.string(),
  at: z.string(),
});

const bodyDiffLineSchema = z.strictObject({
  kind: z.enum(["same", "removed", "added"]),
  text: z.string(),
  changedFrom: z.number().int().optional(),
  changedTo: z.number().int().optional(),
});

export const documentVersionComparisonOutput =
  contentOutputContract<DocumentVersionComparison>(
    z.strictObject({
      from: comparisonSideSchema,
      to: comparisonSideSchema,
      identical: z.boolean(),
      title: z
        .strictObject({ before: z.string(), after: z.string() })
        .nullable(),
      body: z
        .strictObject({
          hunks: z.array(
            z.strictObject({
              lines: z.array(bodyDiffLineSchema),
              omittedLineCount: z.number().int().nonnegative(),
            }),
          ),
          omittedHunkCount: z.number().int().nonnegative(),
          addedLineCount: z.number().int().nonnegative(),
          removedLineCount: z.number().int().nonnegative(),
        })
        .nullable(),
    }),
  );
